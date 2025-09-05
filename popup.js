// popup.js

const els = {
  host: document.getElementById('proxyHost'),
  port: document.getElementById('proxyPort'),
  user: document.getElementById('proxyUsername'),
  pass: document.getElementById('proxyPassword'),
  saveBtn: document.getElementById('saveBtn'),
  enableBtn: document.getElementById('enableBtn'),
  disableBtn: document.getElementById('disableBtn'),
  status: document.getElementById('status'),
  diagSummary: document.getElementById('diag-summary'),
  diagLog: document.getElementById('diag-log'),
  refreshDiag: document.getElementById('refreshDiag'),
  resetDiag: document.getElementById('resetDiag'),
  openMyIp: document.getElementById('openMyIp'),
};

init();

function init() {
  chrome.storage.local.get(
    [
      'proxyHost', 'proxyPort',
      'proxyUsername', 'proxyPassword', 'proxyEnabled'
    ],
    (cfg) => {
      els.host.value = cfg.proxyHost || '';
      els.port.value = cfg.proxyPort || '';
      els.user.value = cfg.proxyUsername || '';
      els.pass.value = cfg.proxyPassword || '';
      updateStatus(Boolean(cfg.proxyEnabled));
      requestDiag();
    }
  );

  els.saveBtn.addEventListener('click', onSave);
  els.enableBtn.addEventListener('click', onEnable);
  els.disableBtn.addEventListener('click', onDisable);
  els.refreshDiag?.addEventListener('click', requestDiag);
  els.resetDiag?.addEventListener('click', resetDiag);
  els.openMyIp?.addEventListener('click', () => chrome.tabs.create({ url: 'https://www.myip.com/' }));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.proxyDiagnostics) {
      const diag = changes.proxyDiagnostics.newValue;
      if (diag) renderDiag(diag);
    }
  });
}

function onSave() {
  const cfg = collect();
  console.log('[Popup] Save proxy config', maskCfg(cfg));
  chrome.storage.local.set(cfg, () => {
    updateStatus(false);
  });
}

function onEnable() {
  const cfg = collect();
  console.log('[Popup] Enable proxy with config', maskCfg(cfg));
  chrome.storage.local.set({ ...cfg, proxyEnabled: true }, () => {
    chrome.runtime.sendMessage({ type: 'APPLY_PROXY' }, (res) => {
      updateStatus(true);
    });
  });
}

function onDisable() {
  console.log('[Popup] Disable proxy');
  chrome.storage.local.set({ proxyEnabled: false }, () => {
    chrome.runtime.sendMessage({ type: 'DISABLE_PROXY' }, (res) => {
      updateStatus(false);
    });
  });
}

function collect() {
  return {
    proxyHost: els.host.value.trim(),
    proxyPort: els.port.value.trim(),
    proxyUsername: els.user.value,
    proxyPassword: els.pass.value,
  };
}

function updateStatus(enabled) {
  els.status.textContent = enabled ? '프록시 활성화' : '프록시 비활성화';
  els.status.classList.toggle('on', enabled);
  els.status.classList.toggle('off', !enabled);
}

function maskCfg(cfg) {
  const c = { ...cfg };
  if (c.proxyPassword) {
    const len = c.proxyPassword.length;
    c.proxyPassword = len <= 2 ? '*'.repeat(len) : c.proxyPassword[0] + '*'.repeat(len - 2) + c.proxyPassword[len - 1];
  }
  return c;
}

function requestDiag() {
  chrome.runtime.sendMessage({ type: 'GET_PROXY_STATUS' }, (res) => {
    if (res && res.ok && res.data) renderDiag(res.data);
  });
}

function resetDiag() {
  chrome.runtime.sendMessage({ type: 'RESET_PROXY_STATS' }, () => requestDiag());
}

function renderDiag(diag) {
  // Update badge too
  updateStatus(Boolean(diag.enabled));
  const summary = [
    `상태: ${diag.pacMode === 'pac_script' ? '활성(PAC)' : '비활성(DIRECT)'}`,
    `엔드포인트: ${diag.host || '-'}${diag.port ? ':' + diag.port : ''}`,
    `적용시각: ${formatTs(diag.appliedAt)}`,
    `요청: 총 ${diag.sumRequests}건 · 성공 ${diag.sumOK}건 · 실패 ${diag.sumFailed}건`,
    `데이터: 수신 ${fmtBytes(diag.sumBytesIn)} · 송신 ${fmtBytes(diag.sumBytesOut)} (대략)`
  ].join('\n');
  if (els.diagSummary) els.diagSummary.textContent = summary;

  // Log render
  if (els.diagLog) {
    const logs = (diag.recent || []).slice().reverse();
    els.diagLog.innerHTML = logs.map(entry => renderLogLine(entry)).join('');
  }
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
