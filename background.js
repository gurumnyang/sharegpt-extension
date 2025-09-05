// background.js

// ===== Proxy config (popup ↔ background) ===== //
const PROXY_TARGETS = [
  'chatgpt.com',
  'chat.openai.com',
  'www.myip.com',
];

// ===== Diagnostics state ===== //
const MAX_LOG = 50;
const diag = {
  enabled: false,
  pacMode: 'direct',
  appliedAt: null,
  host: '',
  port: 0,
  sumRequests: 0,
  sumOK: 0,
  sumFailed: 0,
  sumBytesIn: 0,
  sumBytesOut: 0,
  lastError: null,
  lastAuth: null,
  recent: [],
};

const reqOutBytes = new Map(); // requestId -> bytes (approx)

function snapshotDiag() {
  return JSON.parse(JSON.stringify(diag));
}

function pushLog(entry) {
  diag.recent.push({ ts: new Date().toISOString(), ...entry });
  if (diag.recent.length > MAX_LOG) diag.recent.splice(0, diag.recent.length - MAX_LOG);
  chrome.storage.local.set({ proxyDiagnostics: snapshotDiag() });
}

function setDiag(patch, logEntry) {
  Object.assign(diag, patch);
  chrome.storage.local.set({ proxyDiagnostics: snapshotDiag() });
  if (logEntry) pushLog(logEntry);
}

function getHeader(headers, name) {
  if (!headers) return null;
  const n = name.toLowerCase();
  const h = headers.find(h => (h.name || '').toLowerCase() === n);
  return h ? h.value : null;
}

function maskSecret(s) {
  if (!s) return '';
  const len = String(s).length;
  if (len <= 2) return '*'.repeat(len);
  return s[0] + '*'.repeat(Math.max(1, len - 2)) + s[len - 1];
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'APPLY_PROXY') {
    console.log('[Proxy] APPLY_PROXY message received');
    applyProxyFromStorage();
    sendResponse({ ok: true });
  } else if (message?.type === 'DISABLE_PROXY') {
    console.log('[Proxy] DISABLE_PROXY message received');
    clearProxy();
    sendResponse({ ok: true });
  } else if (message?.type === 'GET_PROXY_STATUS') {
    sendResponse({ ok: true, data: snapshotDiag() });
  } else if (message?.type === 'RESET_PROXY_STATS') {
    diag.sumRequests = 0; diag.sumOK = 0; diag.sumFailed = 0; diag.sumBytesIn = 0; diag.sumBytesOut = 0; diag.recent = [];
    chrome.storage.local.set({ proxyDiagnostics: snapshotDiag() });
    sendResponse({ ok: true });
  }
});

chrome.runtime.onStartup.addListener(() => {
  // Re-apply proxy on browser startup if enabled
  console.log('[Proxy] onStartup: attempting to re-apply proxy if enabled');
  applyProxyFromStorage();
});

async function applyProxyFromStorage() {
  const cfg = await chrome.storage.local.get([
    'proxyHost', 'proxyPort', 'proxyEnabled'
  ]);
  if (!cfg.proxyEnabled) return;
  if (!cfg.proxyHost || !cfg.proxyPort) return;

  const scheme = 'PROXY'; // HTTP 고정
  const host = cfg.proxyHost;
  const port = parseInt(cfg.proxyPort, 10) || 0;
  if (!port) return;

  const pac = buildPacScript({ scheme, host, port, targets: PROXY_TARGETS });

  console.log('[Proxy] Applying PAC with config:', {
    enabled: cfg.proxyEnabled,
    host,
    port,
    scheme,
  });
  console.log('[Proxy] PAC script:\n' + pac);

  chrome.proxy.settings.set({
    value: {
      mode: 'pac_script',
      pacScript: { data: pac }
    },
    scope: 'regular'
  }, () => {
    console.log('[Proxy] PAC applied for targets:', PROXY_TARGETS.join(', '));
    chrome.proxy.settings.get({ incognito: false }, (res) => {
      try {
        console.log('[Proxy] current setting mode:', res?.value?.mode);
      } catch {}
    });
    setDiag({ enabled: true, pacMode: 'pac_script', appliedAt: new Date().toISOString(), host, port }, { level: 'info', msg: 'PAC applied', host, port });
  });
}

function clearProxy() {
  chrome.proxy.settings.set({ value: { mode: 'direct' }, scope: 'regular' }, () => {
    console.log('[Proxy] Cleared (DIRECT).');
    setDiag({ enabled: false, pacMode: 'direct', appliedAt: new Date().toISOString() }, { level: 'info', msg: 'PAC cleared' });
  });
}

function buildPacScript({ scheme, host, port, targets }) {
  // HTTP(프로토콜) 고정 → PAC 토큰은 항상 PROXY
  let token = 'PROXY';

  const lines = [];
  lines.push('function FindProxyForURL(url, host) {');
  // helper: check subdomain or exact match
  lines.push('  function isMatch(h, d) {');
  lines.push('    return (h === d) || dnsDomainIs(h, "." + d);');
  lines.push('  }');
  // build condition
  const cond = targets.map(d => `isMatch(host, "${d}")`).join(' || ');
  lines.push(`  if (${cond}) { return "${token} ${host}:${port}; DIRECT"; }`);
  lines.push('  return "DIRECT";');
  lines.push('}');
  return lines.join('\n');
}

// Provide proxy auth credentials if required (asyncBlocking via callback)
chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    (async () => {
      try {
        const urlHost = safeHost(details.url);
        const challengerHost = details?.challenger?.host || '';
        const scheme = details?.scheme || '';
        const realm = details?.realm || '';
        const isProxy = Boolean(details.isProxy);

        console.log('[ProxyAuth] event', {
          isProxy, urlHost, challengerHost, scheme, realm
        });

        const cfg = await chrome.storage.local.get([
          'proxyUsername', 'proxyPassword', 'proxyEnabled', 'proxyHost'
        ]);

        if (!cfg.proxyEnabled) return; // no callback → no creds
        if (!cfg.proxyUsername || !cfg.proxyPassword) return;

        const proxyHostLc = (cfg.proxyHost || '').toLowerCase();
        const shouldHandle = isProxy && (
          PROXY_TARGETS.some(d => hostMatches(urlHost, d)) ||
          (challengerHost && challengerHost.toLowerCase().includes(proxyHostLc))
        );

        if (!shouldHandle) return;

        console.log('[ProxyAuth] providing credentials for proxy', {
          username: cfg.proxyUsername,
          password: maskSecret(cfg.proxyPassword)
        });
        setDiag({ lastAuth: { ts: new Date().toISOString(), isProxy, urlHost, challengerHost, scheme, realm, provided: true } });
        callback({
          authCredentials: {
            username: cfg.proxyUsername,
            password: cfg.proxyPassword
          }
        });
      } catch (e) {
        console.warn('[Proxy] onAuthRequired error:', e);
        setDiag({ lastAuth: { ts: new Date().toISOString(), error: String(e) } });
      }
    })();
  },
  { urls: ["<all_urls>"] },
  ['asyncBlocking']
);

function safeHost(url) {
  try { return new URL(url).host.toLowerCase(); } catch { return ''; }
}

function hostMatches(host, domain) {
  if (!host || !domain) return false;
  const d = domain.toLowerCase();
  const h = host.toLowerCase();
  return h === d || h.endsWith('.' + d);
}

// Proxy errors (e.g., auth failures, PAC issues)
chrome.proxy.onProxyError.addListener((details) => {
  console.warn('[ProxyError]', details);
  setDiag({ lastError: details?.error || 'proxy_error' }, { level: 'error', msg: 'Proxy error', detail: details });
});

// Log request completion and errors for target hosts
const targetUrlFilters = {
  urls: [
    '*://chatgpt.com/*', '*://*.chatgpt.com/*',
    '*://chat.openai.com/*',
    '*://www.myip.com/*',
  ]
};

// Capture outgoing content-length if present
chrome.webRequest.onBeforeSendHeaders.addListener((details) => {
  const cl = getHeader(details.requestHeaders || [], 'content-length');
  if (cl) {
    const v = parseInt(cl, 10);
    if (!Number.isNaN(v)) reqOutBytes.set(details.requestId, v);
  }
}, targetUrlFilters, ['requestHeaders']);

chrome.webRequest.onCompleted.addListener((details) => {
  const inCl = getHeader(details.responseHeaders || [], 'content-length');
  const inBytes = inCl && !Number.isNaN(parseInt(inCl, 10)) ? parseInt(inCl, 10) : 0;
  const outBytes = reqOutBytes.get(details.requestId) || 0;
  reqOutBytes.delete(details.requestId);

  diag.sumRequests += 1;
  if (details.statusCode >= 200 && details.statusCode < 400) diag.sumOK += 1; else diag.sumFailed += 1;
  diag.sumBytesIn += inBytes;
  diag.sumBytesOut += outBytes;
  chrome.storage.local.set({ proxyDiagnostics: snapshotDiag() });

  console.log('[RequestCompleted]', {
    url: details.url,
    statusCode: details.statusCode,
    ip: details.ip,
    fromCache: details.fromCache,
    method: details.method,
    type: details.type,
    inBytes,
    outBytes,
  });
  pushLog({ level: 'info', msg: 'Request completed', url: details.url, statusCode: details.statusCode, inBytes, outBytes });
}, targetUrlFilters, ['responseHeaders']);

chrome.webRequest.onErrorOccurred.addListener((details) => {
  console.warn('[RequestError]', {
    url: details.url,
    error: details.error,
    method: details.method,
    type: details.type,
  });
  diag.sumRequests += 1;
  diag.sumFailed += 1;
  chrome.storage.local.set({ proxyDiagnostics: snapshotDiag() });
  pushLog({ level: 'error', msg: 'Request error', url: details.url, error: details.error });
}, targetUrlFilters);

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

    chrome.tabs.sendMessage(tabId, { type: "REFRESH" }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[Extension] 메시지 전달 실패 (content script 없음)", chrome.runtime.lastError.message);
      } else {
        console.log("[Extension] REFRESH 메시지 전달 성공", response);
      }
    });

    handleTabChange(tabId, true);
  }
});

/**
 * @function handleTabChange
 * - 활성 탭이 chat.openai.com 또는 chatgpt.com이면 10초 간격으로 /api/view 호출
 *   → 응답을 content script에 전달
 */
async function handleTabChange(tabId, ignoreInterval = false) {
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
        if (now - lastCheckedTime >= CHECK_INTERVAL_MS || ignoreInterval) {
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
  const res = await fetch("https://sharegpt.gurum.cat/api/view", {
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
        "*://chatgpt.com/backend-api/conversation",
        "*://chatgpt.com/backend-api/f/conversation",
        "*://chatgpt.com/backend-anon/f/conversation",
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

  const res = await fetch("https://sharegpt.gurum.cat/api/activity", {
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
