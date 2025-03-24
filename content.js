// content.js

// --------------------------------------------------
// 1) /api/view 응답 처리: 차단/알림 로직
// --------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "VIEW_STATUS") {
    handleViewStatus(message.payload);
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

  // 최근 10분 내(600초 이내) 사용 필터
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
  if (lastUsed) {
    const diffMs = now - new Date(lastUsed.timestamp).getTime();
    const diffMin = Math.floor(diffMs / 1000 / 60);
    showNotification(`가장 최근 사용은 ${diffMin}분 전`);
  } else {
    showNotification("최근 10분 내 다른 사용자 없음");
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
function showNotification(msg) {
  let box = document.getElementById("my-extension-noti");
  if (!box) {
    box = document.createElement("div");
    box.id = "my-extension-noti";
    Object.assign(box.style, {
      position: "fixed",
      top: "10px",
      right: "10px",
      zIndex: 9999,
      background: "#fffbe8",
      border: "1px solid #ccc",
      padding: "10px",
      borderRadius: "6px",
      fontSize: "14px",
      maxWidth: "250px",
      boxShadow: "0 2px 6px rgba(0,0,0,0.2)"
    });
    document.body.appendChild(box);
  }
  box.textContent = msg;
}

function removeNotification() {
  const box = document.getElementById("my-extension-noti");
  if (box) {
    box.remove();
  }
}

// --------------------------------------------------
// 2) 사용자 메시지 전송 감지
//    => /backend-api/conversation 을 호출 시 background에 알림
// --------------------------------------------------
(function interceptFetchForChat() {
  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const [url] = args;

    // URL이 문자열이고, "/backend-api/conversation" 포함 시
    if (typeof url === "string" && url.includes("/backend-api/conversation")) {
      // background에 전송 - 메시지가 전송됐음을 알림
      chrome.runtime.sendMessage({ type: "CHATGPT_MESSAGE_SENT" });
    }

    // 원래 fetch 진행
    return originalFetch.apply(this, args);
  };
})();
