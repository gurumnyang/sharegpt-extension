// background.js

// 호출 간격 (10초)
const CHECK_INTERVAL_MS = 5 * 1000;

let lastCheckedTime = 0;
let myAppId = null; // 이 확장 프로그램(이 기기)의 고유 ID

// 확장 프로그램 설치/업데이트 시 appId 생성/저장
chrome.runtime.onInstalled.addListener(async () => {
  const storedAppId = await getAppIdFromStorage();
  if (!storedAppId) {
    myAppId = generateUUID();
    await chrome.storage.local.set({ appId: myAppId });
    console.log("[Extension] Generated new appId:", myAppId);
  } else {
    myAppId = storedAppId;
    console.log("[Extension] Loaded existing appId:", myAppId);
  }
});

let lastTabId = null;

setInterval(() => {
  console.log("24행 감지")
  if (lastTabId) {
    handleTabChange(lastTabId);
  }
}, CHECK_INTERVAL_MS);

// 탭 활성화/URL 변경 시 → checkAndFetchViewStatus
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log("24행 감지")
  const tab = chrome.tabs.get(activeInfo.tabId, (tab) => {
    if(tab.url.includes("chat.openai.com") || tab.url.includes("chatgpt.com")) {
      console.log("[Extension] Tab activated:", activeInfo.tabId);
      lastTabId = activeInfo.tabId;
      handleTabChange(activeInfo.tabId);
    }
  });
  handleTabChange(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete"  && tab.url && (tab.url.includes("chat.openai.com") || tab.url.includes("chatgpt.com"))) {
    console.log("[Extension] Tab updated:", tabId, tab.url);
    lastTabId = tabId;
    handleTabChange(tabId);
  }
});

/**
 * @function handleTabChange
 * - 활성 탭이 chat.openai.com 또는 chatgpt.com이면 10초 간격으로 /api/view 호출
 *   → 응답을 content script에 전달
 */
async function handleTabChange(tabId) {
  if(!tabId) return;
  const tab = await chrome.tabs.get(tabId);
  if (!tab || !tab.url) return;

  // chat.openai.com 혹은 chatgpt.com 도메인인지 확인
  if (
    tab.url.includes("chat.openai.com") ||
    tab.url.includes("chatgpt.com")
  ) {
    try {
      
    chrome.windows.get(tab.windowId, async (windowInfo) => {
      const now = Date.now();
      if (now - lastCheckedTime >= CHECK_INTERVAL_MS) {
        lastCheckedTime = now;

        // appId가 없으면 불러오기
        if (!myAppId) {
          myAppId = await getAppIdFromStorage();
        }

        // /api/view POST
        try {
          const data = await fetchViewStatus(myAppId);
          console.log("[Extension] /api/view response:", data);

          // Content Script로 전달
          let message = {
            type: "VIEW_STATUS",
            payload: {
              ...data,
              myAppId
            }
          }
          chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
              console.warn("[Extension] 메시지 전달 실패 (content script 없음)", chrome.runtime.lastError.message);
            } else {
              console.log("[Extension] 메시지 전달 성공", response);
            }
          });
        
        } catch (err) {
          console.error("[Extension] Failed to fetch /api/view:", err);
        }
      }
    });
    } catch (err) {
      console.log(err);
    }
  }
}


/**
 * @function fetchViewStatus
 * @param {String} appId
 */
async function fetchViewStatus(appId) {
  const res = await fetch("http://sharegpt.gurum.cat/api/view", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ app_id: appId })
  });
  if (!res.ok) {
    throw new Error("Request to /api/view failed");
  }
  return res.json();
}

/**
 * @function getAppIdFromStorage
 */
async function getAppIdFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["appId"], (result) => {
      resolve(result.appId || null);
    });
  });
}

/**
 * @function generateUUID
 * - 간단한 UUID 생성 예시
 */
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

  chrome.webRequest.onCompleted.addListener(
    (details) => {
      console.log("[webRequest] 감지된 conversation 요청:", details.url);
      // 요청이 완료되었음을 감지하면, 메시지 전송 이벤트로 로그 기록하도록 알림
      reportActivityToServer()
        .then(() => {
          console.log("[Extension] Logged usage to /api/activity");
        })
        .catch((err) => {
          console.error("[Extension] Failed to log usage:", err);
        });
    },
    {
      urls: [
        "*://chat.openai.com/backend-api/conversation",
        "*://chatgpt.com/backend-api/conversation"
      ]
    }
  );

/**
 * @function reportActivityToServer
 * - 사용자가 실제로 ChatGPT 메시지를 전송했음을 알림
 */
async function reportActivityToServer() {
  if (!myAppId) {
    myAppId = await getAppIdFromStorage();
  }

  const res = await fetch("http://sharegpt.gurum.cat/api/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: myAppId,
      timestamp: new Date().toISOString()
    })
  });
  if (!res.ok) {
    throw new Error("Failed to POST /api/activity");
  }
  return res.json();
}
