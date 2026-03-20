// popup.js

const EXPECTED_IPS = ['211.108.115.121', '175.200.147.89', '119.195.74.230'];
const ALERT_PRIORITY = { error: 3, warn: 2, info: 1 };
const ALERT_CLASS = { error: 'alert--error', warn: 'alert--warn', info: 'alert--info' };
const INPUT_ALERT_COLOR = { error: '#fca5a5', warn: '#fcd34d', info: '#93c5fd' };

const alerts = { user: null, ip: null };
let statusOverride = null; // { text, isError }

const els = {
  host: document.getElementById('proxyHost'),
  port: document.getElementById('proxyPort'),
  user: document.getElementById('proxyUsername'),
  pass: document.getElementById('proxyPassword'),
  toggle: document.getElementById('proxyToggle'),
  toggleText: document.getElementById('toggleText'),
  applyBtn: document.getElementById('applyBtn'),
  status: document.getElementById('status'),
  alertBanner: document.getElementById('alertBanner'),
  inputAlert: document.getElementById('inputAlert'),
  ipValue: document.getElementById('ipValue'),
  refreshIp: document.getElementById('refreshIp'),
  diagSummary: document.getElementById('diag-summary'),
  diagLog: document.getElementById('diag-log'),
  refreshDiag: document.getElementById('refreshDiag'),
  resetDiag: document.getElementById('resetDiag'),
  openMyIp: document.getElementById('openMyIp'),
};

init();

function init() {
  els.applyBtn?.addEventListener('click', onApply);
  els.toggle?.addEventListener('change', onToggle);
  els.refreshIp?.addEventListener('click', refreshIpInfo);
  els.refreshDiag?.addEventListener('click', requestDiag);
  els.resetDiag?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_PROXY_STATS' }, () => requestDiag());
  });
  els.openMyIp?.addEventListener('click', () => chrome.tabs.create({ url: 'https://www.myip.com/' }));

  chrome.storage.local.get(
    ['proxyHost', 'proxyPort', 'proxyUsername', 'proxyPassword', 'proxyEnabled'],
    (cfg) => {
      els.host.value = cfg.proxyHost || '';
      els.port.value = cfg.proxyPort || '';
      els.user.value = cfg.proxyUsername || '';
      els.pass.value = cfg.proxyPassword || '';
      const enabled = Boolean(cfg.proxyEnabled);
      updateStatus(enabled);
      updateToggleText(enabled);
      renderAlerts();
      requestDiag();
    }
  );

  refreshIpInfo();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.proxyDiagnostics) {
      const diag = changes.proxyDiagnostics.newValue;
      if (diag) renderDiag(diag);
    }
  });
}

function onApply() {
  const cfg = collect();
  const enabled = Boolean(els.toggle?.checked);
  setUserAlert(null);

  if (enabled) {
    if (!cfg.proxyHost) {
      setUserAlert('프록시 호스트를 입력해주세요.', 'error');
      return;
    }
    const port = parseInt(cfg.proxyPort, 10);
    if (!port || port <= 0 || port > 65535) {
      setUserAlert('1~65535 범위의 올바른 포트를 입력해주세요.', 'error');
      return;
    }
  }

  const payload = { ...cfg, proxyEnabled: enabled };
  console.log('[Popup] Apply proxy config', maskCfg(payload));

  toggleApplyButton(true);
  chrome.storage.local.set(payload, () => {
    if (chrome.runtime.lastError) {
      setUserAlert(`설정 저장 실패: ${chrome.runtime.lastError.message}`, 'error');
      toggleApplyButton(false);
      return;
    }

    const messageType = enabled ? 'APPLY_PROXY' : 'DISABLE_PROXY';
    chrome.runtime.sendMessage({ type: messageType }, () => {
      if (chrome.runtime.lastError) {
        setUserAlert(`백그라운드 통신 실패: ${chrome.runtime.lastError.message}`, 'error');
      } else {
        setUserAlert(`설정을 적용했습니다. (${enabled ? '프록시 활성화' : '프록시 비활성화'})`, 'info');
      }
      updateStatus(enabled);
      requestDiag();
      toggleApplyButton(false);
      if (enabled) verifyProxyNow();
    });
  });
}

function onToggle() {
  const enabled = Boolean(els.toggle?.checked);
  updateToggleText(enabled);
  setUserAlert(null);
  if (enabled) {
    // When enabling, persist the toggle state and apply immediately.
    chrome.storage.local.get(['proxyHost', 'proxyPort', 'proxyUsername', 'proxyPassword'], (cfg) => {
      els.host.value = cfg.proxyHost || els.host.value;
      els.port.value = cfg.proxyPort || els.port.value;
      els.user.value = cfg.proxyUsername || els.user.value;
      els.pass.value = cfg.proxyPassword || els.pass.value;
      onApply();
    });
  } else {
    chrome.storage.local.set({ proxyEnabled: false }, () => {
      chrome.runtime.sendMessage({ type: 'DISABLE_PROXY' }, () => {
        if (chrome.runtime.lastError) {
          setUserAlert(`프록시 비활성화 실패: ${chrome.runtime.lastError.message}`, 'error');
        } else {
          setUserAlert('프록시를 비활성화했습니다.', 'info');
        }
        updateStatus(false);
        requestDiag();
      });
    });
  }
}

function toggleApplyButton(disabled) {
  if (!els.applyBtn) return;
  els.applyBtn.disabled = disabled;
  els.applyBtn.textContent = disabled ? '적용 중...' : '설정 적용';
}

function collect() {
  return {
    proxyHost: (els.host.value || '').trim(),
    proxyPort: (els.port.value || '').trim(),
    proxyUsername: els.user.value,
    proxyPassword: els.pass.value,
  };
}

function updateStatus(enabled) {
  if (!els.status) return;
  els.status.textContent = enabled ? '프록시 활성화' : '프록시 비활성화';
  els.status.classList.toggle('on', enabled);
  els.status.classList.toggle('off', !enabled);
  if (statusOverride) {
    applyStatusOverride();
  } else {
    els.status.classList.remove('err');
  }
  if (els.toggle) els.toggle.checked = enabled;
  updateToggleText(enabled);
}

function setStatusError(text) {
  if (!els.status) return;
  statusOverride = { text: text || '프록시 오류', isError: true };
  applyStatusOverride();
}

function applyStatusOverride() {
  if (!statusOverride || !els.status) return;
  els.status.textContent = statusOverride.text;
  els.status.classList.add('err');
}

function clearStatusOverride() {
  statusOverride = null;
  if (els.status) els.status.classList.remove('err');
}

function updateToggleText(enabled) {
  if (!els.toggleText) return;
  els.toggleText.textContent = enabled ? '활성화됨' : '비활성화됨';
}

async function refreshIpInfo() {
  if (!els.ipValue) return;
  els.ipValue.textContent = '확인 중...';
  if (els.refreshIp) els.refreshIp.disabled = true;

  try {
    const res = await fetch('https://api.myip.com', { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    const ip = data?.ip || '';
    els.ipValue.textContent = ip || '알 수 없음';

    if (!ip) {
      setIpAlert('IP 정보를 확인할 수 없습니다.', 'warn');
    } else if (!EXPECTED_IPS.includes(ip)) {
      setIpAlert(`경고: 현재 IP(${ip})가 허용된 IP(${EXPECTED_IPS.join(', ')})와 다릅니다.`, 'warn');
    } else {
      setIpAlert(null);
    }
  } catch (err) {
    els.ipValue.textContent = '불러오기 실패';
    setIpAlert(`IP 조회 실패: ${err.message || err}`, 'error');
  } finally {
    if (els.refreshIp) els.refreshIp.disabled = false;
  }
}

async function verifyProxyNow() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://api.myip.com', { cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`IP 확인 실패(HTTP ${res.status})`);
    }
    const data = await res.json();
    const ip = data?.ip || '';
    if (!ip) throw new Error('IP 응답이 비었습니다.');
    if (!EXPECTED_IPS.includes(ip)) {
      const msg = `프록시 연결 오류: 현재 IP(${ip}) ≠ 기대 IP(${EXPECTED_IPS.join(', ')})`;
      setUserAlert(msg, 'error');
      setStatusError('프록시 오류');
      notifyContentStatus(false, msg);
      return false;
    }
    // success
    clearStatusOverride();
    updateStatus(true);
    setUserAlert(`프록시 연결 확인: ${ip}`, 'info');
    notifyContentStatus(true, `프록시 연결 확인: ${ip}`);
    return true;
  } catch (e) {
    const msg = `프록시 연결 오류: ${e.message || e}`;
    setUserAlert(msg, 'error');
    setStatusError('프록시 오류');
    notifyContentStatus(false, msg);
    return false;
  }
}

function notifyContentStatus(ok, message) {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) return;
      chrome.tabs.sendMessage(tab.id, { type: 'PROXY_STATUS', payload: { ok, message } }, () => {});
    });
  } catch {}
}

function requestDiag() {
  chrome.runtime.sendMessage({ type: 'GET_PROXY_STATUS' }, (res) => {
    if (res && res.ok && res.data) renderDiag(res.data);
  });
}

function renderDiag(diag) {
  updateStatus(Boolean(diag.enabled));
  const summary = [
    `상태: ${diag.pacMode === 'pac_script' ? '활성(PAC)' : '비활성(DIRECT)'}`,
    `제어권: ${diag.levelOfControl || '-'}`,
    `엔드포인트: ${diag.host || '-'}${diag.port ? ':' + diag.port : ''}`,
    `적용시각: ${formatTs(diag.appliedAt)}`,
    `요청: 총 ${diag.sumRequests}건 · 성공 ${diag.sumOK}건 · 실패 ${diag.sumFailed}건`,
    `데이터: 수신 ${fmtBytes(diag.sumBytesIn)} · 송신 ${fmtBytes(diag.sumBytesOut)} (대략)`
  ].join('\n');
  if (els.diagSummary) els.diagSummary.textContent = summary;

  if (els.diagLog) {
    const logs = (diag.recent || []).slice().reverse();
    els.diagLog.innerHTML = logs.map(entry => renderLogLine(entry)).join('');
  }
  if (statusOverride) {
    applyStatusOverride();
  }
}

function setAlert(source, message, level) {
  if (!(source in alerts)) return;
  if (!message) {
    alerts[source] = null;
  } else {
    const lvl = level || 'info';
    alerts[source] = { message, level: lvl };
  }
  renderAlerts();
}

function setUserAlert(message, level) {
  setAlert('user', message, level);
}

function setIpAlert(message, level) {
  setAlert('ip', message, level);
}

function renderAlerts() {
  const banner = els.alertBanner;
  const input = els.inputAlert;
  if (!banner || !input) return;

  banner.classList.remove('alert--error', 'alert--warn', 'alert--info');

  const active = Object.values(alerts).filter(Boolean);
  if (!active.length) {
    banner.textContent = '';
    input.textContent = '';
    input.style.color = '';
    return;
  }

  const highest = active.reduce((acc, cur) => {
    if (!acc) return cur;
    return ALERT_PRIORITY[cur.level] > ALERT_PRIORITY[acc.level] ? cur : acc;
  }, null);

  const messages = active.map(entry => entry.message).join('\n');
  banner.textContent = messages;
  const cls = ALERT_CLASS[highest.level] || 'alert--info';
  banner.classList.add(cls);

  input.textContent = messages;
  input.style.color = INPUT_ALERT_COLOR[highest.level] || '#93c5fd';
}

function renderLogLine(e) {
  const ts = formatTs(e.ts);
  const color = e.level === 'error' ? '#ef4444' : e.level === 'warn' ? '#f59e0b' : '#9ca3af';
  const msg = e.msg || '';
  const url = e.url ? `<span style="color:#60a5fa">${escapeHtml(e.url)}</span>` : '';
  const sc = e.statusCode ? ` <span style="color:#22c55e">${e.statusCode}</span>` : '';
  const err = e.error ? ` <span style="color:#ef4444">${escapeHtml(e.error)}</span>` : '';
  const bytes = (e.inBytes || e.outBytes) ? ` <span style="color:#a78bfa">${fmtBytes(e.inBytes||0)}/${fmtBytes(e.outBytes||0)}</span>` : '';
  return `<div style="font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; color:${color}; margin-bottom:4px">[${ts}] ${escapeHtml(msg)} ${url}${sc}${err}${bytes}</div>`;
}

function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const units = ['B','KB','MB','GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length-1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i>0 ? 1 : 0)} ${units[i]}`;
}

function formatTs(ts) {
  if (!ts) return '-';
  try { const d = new Date(ts); return d.toLocaleString(); } catch { return String(ts); }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c]));
}

function maskCfg(cfg) {
  const c = { ...cfg };
  if (c.proxyPassword) {
    const len = c.proxyPassword.length;
    c.proxyPassword = len <= 2 ? '*'.repeat(len) : c.proxyPassword[0] + '*'.repeat(len - 2) + c.proxyPassword[len - 1];
  }
  return c;
}
