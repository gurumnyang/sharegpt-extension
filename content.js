// content.js

/****************************************************
 * 1) /api/view 응답 처리: 최근 10분 이내 사용 상태를
 *    textarea placeholder에만 표시
 ****************************************************/
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "VIEW_STATUS") {
    console.log("[Content] /api/view response:", message.payload);
    handleViewStatus(message.payload);
    sendResponse({ status: "success" });

  } else if (message.type === "REFRESH") {
    console.log("[Content] Refresh event received");
    changePlaceHolderMessage("로드 중...");
    sendResponse({ status: "success" });
  }
});

/**
 * @function handleViewStatus
 * @param {Object} payload - 서버 /api/view 응답 + myAppId
 *   예: { status: "success", devices: [...], myAppId: "..." }
 */
function handleViewStatus(payload) {
  if (!payload || payload.status !== "success") return;

  const { devices = [], myAppId } = payload;
  const otherDevices = devices.filter((d) => d.app_id !== myAppId);

  const now = Date.now();
  const TEN_MIN = 10 * 60 * 1000;
  const recentOthers = otherDevices.filter((dev) => {
    const t = new Date(dev.timestamp).getTime();
    return now - t <= TEN_MIN;
  });

  // 현재 시각(시:분:초)
  const time2 = new Date().toLocaleTimeString("ko-KR", {
    hour12: false,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });

  // 최근 10분 내 다른 기기가 있다면, 그 중 가장 최근을 찾아 placeholder에 표시
  if (recentOthers.length > 0) {
    const lastUsed = getMostRecent(recentOthers);
    if (lastUsed) {
      const diffMs = now - new Date(lastUsed.timestamp).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      changePlaceHolderMessage(`${diffSec}초 전에 다른 ${recentOthers.length}개의 기기에서 사용됨`);
    }
  } else {
    changePlaceHolderMessage(`최근 10분 내 다른 기기에서 사용된 적 없음. (${time2})`);
  }
}

/**
 * @function getMostRecent
 * - timestamp가 가장 최신인 device 정보 반환
 */
function getMostRecent(devices) {
  if (!devices.length) return null;
  return devices.reduce((acc, cur) => {
    return new Date(acc.timestamp) > new Date(cur.timestamp) ? acc : cur;
  });
}

/**
 * @function changePlaceHolderMessage
 * - .placeholder 클래스에 동적으로 "content"를 넣어주는 함수
 */
function changePlaceHolderMessage(message) {
  let style = document.getElementById("sharegpt-placeholder");
  if (!style) {
    style = document.createElement("style");
    style.id = "sharegpt-placeholder";
  }
  style.innerHTML = `
    .placeholder::after {
      content: "${message}" !important
    }
  `;
  document.head.appendChild(style);
}


/****************************************************
 * 2) 우측 하단 실시간 채팅방 UI & 소켓 연결 예시
 ****************************************************/

/** 채팅 소켓 */
let chatSocket = null;

/**
 * HTML 요소(채팅창 UI) 생성
 */
function createChatRoomUI() {
  let chatContainer = document.getElementById('chat-room-container');
  if (!chatContainer) {
    chatContainer = document.createElement('div');
    chatContainer.id = 'chat-room-container';
    Object.assign(chatContainer.style, {
      position: 'fixed',
      bottom: '10px',
      right: '10px',
      width: '300px',
      maxHeight: '400px',
      backgroundColor: 'rgba(176,176,176,0.6)',
      border: '1px solid #000',
      borderRadius: '6px',
      zIndex: 10000,
      display: 'flex',
      flexDirection: 'column',
      fontSize: '14px'
    });

    // 메시지 표시 영역
    const messageArea = document.createElement('div');
    messageArea.id = 'chat-message-area';
    Object.assign(messageArea.style, {
      flex: '1',
      padding: '10px',
      overflowY: 'auto'
    });

    // 입력 영역
    const inputContainer = document.createElement('div');
    inputContainer.id = 'chat-input-container';
    Object.assign(inputContainer.style, {
      display: 'flex',
      borderTop: '1px solid #000'
    });

    const inputField = document.createElement('input');
    inputField.type = 'text';
    inputField.id = 'chat-input-field';
    inputField.placeholder = '메시지를 입력하세요...';
    Object.assign(inputField.style, {
      flex: '1',
      padding: '8px',
      border: 'none',
      outline: 'none',
      backgroundColor: 'rgba(255, 255, 255, 0)',
      color: '#000',
      opacity: '1',
      placeholderColor: 'black',
    });


    const sendButton = document.createElement('button');
    sendButton.id = 'chat-send-button';
    sendButton.textContent = '전송';
    Object.assign(sendButton.style, {
      padding: '8px',
      cursor: 'pointer',
      borderLeft: '1px solid #000',
      color: '#000',
    });

    const style = document.createElement('style');
    style.textContent = `
      #chat-input-field::placeholder {
        color: black;
      }
    `;

    // 버튼 클릭 시 메시지 전송
    sendButton.addEventListener('click', () => {
      sendMessage(inputField.value);
      inputField.value = '';
    });

    // Enter 키로 메시지 전송
    inputField.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        sendButton.click();
      }
    });

    // 요소 연결
    inputContainer.appendChild(inputField);
    inputContainer.appendChild(sendButton);
    chatContainer.appendChild(messageArea);
    chatContainer.appendChild(inputContainer);
    document.head.appendChild(style);
    document.body.appendChild(chatContainer);
  }
}

/**
 * 서버에서 받은 or 자신이 전송한 메시지를 채팅 UI에 표시 (최대 5개)
 */
function addChatMessage(message, timestamp = null) {
  const messageArea = document.getElementById('chat-message-area');
  if (!messageArea) return;

  // 새 메시지 엘리먼트 생성
  const msgDiv = document.createElement('div');

  let time = '시간미상';
  if (timestamp) {
    const msgTime = new Date(timestamp);
    time = msgTime.toLocaleTimeString("ko-KR", {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  msgDiv.textContent = `[${time}] ${message}`;
  msgDiv.style.marginBottom = '4px';

  // 메시지 영역에 추가
  messageArea.appendChild(msgDiv);

  // 최대 5개 유지 → 오래된 것부터 제거
  while (messageArea.childNodes.length > 5) {
    messageArea.removeChild(messageArea.firstChild);
  }

  // 스크롤 하단 고정
  messageArea.scrollTop = messageArea.scrollHeight;
}

/**
 * 소켓 연결 초기화
 * (ws:// 예시 URL, 서버 환경에 따라 수정)
 */
function initChatSocket() {
  // 실제 소켓 URL로 교체 필요
  chatSocket = new WebSocket("wss://sharegpt.gurum.cat/chat");

  chatSocket.addEventListener('open', () => {
    console.log("[ChatSocket] 연결 성공");
    // 접속 시, 최근 채팅 기록 불러오기
    fetchChatHistory();
  });

  chatSocket.addEventListener('message', (event) => {
    console.log("[ChatSocket] 메시지 수신:", event.data);
    // 받은 메시지를 채팅 영역에 추가
    let data = JSON.parse(event.data);
    addChatMessage(data.text, data.timestamp);
  });

  chatSocket.addEventListener('error', (err) => {
    console.error("[ChatSocket] 오류:", err);
  });

  chatSocket.addEventListener('close', () => {
    console.log("[ChatSocket] 연결 종료");
    // 필요시 재연결 로직 추가 가능
  });
}

/**
 * 10분 이내 채팅 히스토리 가져오기
 * 실제 API 엔드포인트에 맞춰 수정
 */
async function fetchChatHistory() {
  try {
    const res = await fetch("https://sharegpt.gurum.cat/api/chat/history", {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) {
      console.error("채팅 히스토리 API 오류");
      return;
    }
    const history = await res.json();
    // 예: [{ text: "...", timestamp: "..." }, ...] 형태라고 가정
    history.forEach(msg => {
      addChatMessage(msg.text, msg.timestamp);
    });
  } catch (err) {
    console.error("채팅 히스토리 불러오기 실패:", err);
  }
}

/**
 * 사용자가 메시지를 전송할 때 호출
 */
function sendMessage(text) {
  if (!text || text.trim() === "") return;
  const messagePayload = JSON.stringify({
    text: text,
    timestamp: new Date().toISOString()
  });

  if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
    chatSocket.send(messagePayload);
  } else {
    console.warn("소켓 연결이 준비되지 않았습니다.");
  }
}


/****************************************************
 * 3) 페이지 로드시 실행: 채팅 UI 생성 & 소켓 연결
 ****************************************************/
(function init() {
  console.log("[Content] init() 실행");
  createChatRoomUI();
  initChatSocket();
})();
