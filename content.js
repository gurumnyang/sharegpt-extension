// content.js

// --------------------------------------------------
// 1) /api/view 응답 처리: 차단/알림 로직
// --------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "VIEW_STATUS") {
    console.log("[Content] /api/view response:", message.payload);
    handleViewStatus(message.payload);
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

  // 나의 appId 제외
  const otherDevices = devices.filter((d) => d.app_id !== myAppId);

  // 최근 10분 내(600초 이내) 사용 필터otherDevices
  const now = Date.now();
  const TEN_MIN = 10 * 60 * 1000;
  const recentOthers = otherDevices.filter((dev) => {
    const t = new Date(dev.timestamp).getTime();
    return now - t <= TEN_MIN;
  });

  if (recentOthers.length > 0) {
    // 다른 사람이 사용 중 → 차단
    blockChatInput(`다른 사용자가 사용 중입니다 (${recentOthers.length}명)`);
  } else {
    // 차단 해제
    unblockChatInput();
  }

  // 가장 최근 사용 시각 모달 표시
  const lastUsed = getMostRecent(recentOthers);

  const time = new Date().toLocaleTimeString();
  //HH:MM:SS 형식으로 시간을 표시
  const time2 = new Date().toLocaleTimeString("ko-KR", {
    hour12: false,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });

  if (lastUsed) {
    const diffMs = now - new Date(lastUsed.timestamp).getTime();
    const diffMin = Math.floor(diffMs / 1000 / 60);
    const diffSec = Math.floor(diffMs / 1000);
    showNotification(`${diffSec}초 전에 다른 ${recentOthers.length}개의 기기에서 사용됨`, "#ff8888");
  } else {
    showNotification(`최근 10분 내 다른 기기에서 사용된 적 없음. (${time2})`, "#d6ffd1");
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
 * @function blockChatInput
 */
function blockChatInput(msg) {
  const textarea = document.querySelector("textarea");
  if (textarea) {
    textarea.disabled = true;
    textarea.style.backgroundColor = "#ffdddd";
  }
  showNotification(msg);
}

/**
 * @function unblockChatInput
 */
function unblockChatInput() {
  const textarea = document.querySelector("textarea");
  if (textarea) {
    textarea.disabled = false;
    textarea.style.backgroundColor = "";
  }
  removeNotification();
}

/**
 * 간단한 화면 우상단 알림 박스
 */
function showNotification(msg, bgColor = "#fffbe8") {
  let box = document.getElementById("my-extension-noti");
  if (!box) {
    box = document.createElement("div");
    box.id = "my-extension-noti";
    Object.assign(box.style, {
      position: "fixed",
      bottom: "10px",
      right: "10px",
      zIndex: 9999,
      background: bgColor,
      border: "1px solid #ccc",
      padding: "10px",
      borderRadius: "6px",
      fontSize: "14px",
      color: "black",
      maxWidth: "250px",
      boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
      opacity: 0.7, // 반투명도 설정
      pointerEvents: "none" // 박스 아래의 요소를 클릭할 수 있게 설정
    });
    document.body.appendChild(box);
  }
  box.innerHTML = msg;
}

function removeNotification() {
  const box = document.getElementById("my-extension-noti");
  if (box) {
    box.remove();
  }
}

