'use strict';
// 酷狗概念版（Lite）前端模块：扫码登录、今日 VIP 畅听权益领取。
// 登录走 Electron 主进程 IPC（window.desktopWindow.kugouLite），
// 登录成功后由主进程账户管理器把 session 写入 bridge，server.js 转为酷狗 cookie。

var kugouLiteQrTimer = null;
var kugouLiteQrKey = '';
var kugouLiteQrBusy = false;
var kugouVipClaimBusy = false;
var kugouVipClaimStatus = null;

function getKugouLiteBridge() {
  var bridge = window.desktopWindow && window.desktopWindow.kugouLite;
  return bridge && typeof bridge.getStatus === 'function' ? bridge : null;
}

function stopKugouLiteQrPoll() {
  if (kugouLiteQrTimer) {
    clearInterval(kugouLiteQrTimer);
    clearTimeout(kugouLiteQrTimer);
  }
  kugouLiteQrTimer = null;
  kugouLiteQrKey = '';
}

function setKugouLiteQrStatus(text, kind) {
  var status = document.getElementById('qr-status');
  if (!status) return;
  status.textContent = text || '';
  status.className = kind || 'preview';
}

function setKugouLiteQrImage(src) {
  var image = document.getElementById('qr-img');
  if (image) image.src = src || '';
}

async function pollKugouLiteQr() {
  var bridge = getKugouLiteBridge();
  if (!bridge || !kugouLiteQrKey || kugouLiteQrBusy) return;
  kugouLiteQrBusy = true;
  try {
    var result = await bridge.checkQr(kugouLiteQrKey);
    if (!result || result.ok === false) {
      throw new Error((result && (result.message || result.error)) || '二维码状态读取失败');
    }
    if (result.state === 'scanned') {
      setKugouLiteQrStatus('已扫码，请在酷狗概念版 App 中确认登录。');
      return;
    }
    if (result.state === 'expired') {
      stopKugouLiteQrPoll();
      setKugouLiteQrStatus('二维码已过期，请刷新。', 'fail');
      return;
    }
    if (result.state !== 'authorized') return;
    stopKugouLiteQrPoll();
    setKugouLiteQrStatus('登录成功，正在同步歌单…', 'scan');
    var status = await refreshKugouLoginStatus();
    activeAccountProvider = 'kugou';
    loginProvider = 'kugou';
    markLoginWorkflowConnected('kugou');
    renderUserBtn();
    refreshUserPlaylists(true);
    showToast('酷狗概念版登录成功' + (status && status.nickname ? (': ' + status.nickname) : ''));
    setTimeout(function () { closeLoginModal(); }, 550);
  } catch (error) {
    stopKugouLiteQrPoll();
    setKugouLiteQrStatus((error && error.message) || '二维码登录失败，请重试。', 'fail');
  } finally {
    kugouLiteQrBusy = false;
  }
}

async function startKugouLiteQrLogin() {
  var bridge = getKugouLiteBridge();
  if (!bridge) {
    setKugouLiteQrStatus('当前环境不支持概念版安全登录，请使用 Mineradio 桌面版。', 'fail');
    return;
  }
  if (kugouLiteQrBusy) return;
  stopKugouLiteQrPoll();
  kugouLiteQrBusy = true;
  kugouWebLoginBusy = true;
  setKugouLiteQrStatus('正在生成二维码…');
  setKugouLiteQrImage('');
  try {
    var result = await bridge.startQr();
    if (!result || result.ok === false) {
      throw new Error((result && (result.message || result.error)) || '二维码生成失败');
    }
    kugouLiteQrKey = result.key || '';
    qrKey = kugouLiteQrKey;
    setKugouLiteQrImage(result.image || '');
    setKugouLiteQrStatus('请使用酷狗概念版 App 扫码并确认。');
    kugouLiteQrTimer = setInterval(pollKugouLiteQr, 1800);
    qrPollTimer = kugouLiteQrTimer;
  } catch (error) {
    setKugouLiteQrStatus((error && error.message) || '二维码生成失败，请重试。', 'fail');
  } finally {
    kugouLiteQrBusy = false;
    kugouWebLoginBusy = false;
  }
}

function kugouVipClaimPanelVisible() {
  return !!(kugouLoginStatus && kugouLoginStatus.loggedIn && activeAccountProvider === 'kugou');
}

// 登录面板 MR/扫码/Cookie 列表中的「自动插件」节点：
// 选中酷狗概念版且已登录时显示，点击弹出信息面板。
function kugouClaimNodeVisible() {
  return typeof loginProvider !== 'undefined' && loginProvider === 'kugou' &&
    !!(kugouLoginStatus && kugouLoginStatus.loggedIn);
}

function renderKugouClaimNode() {
  var node = document.getElementById('login-kugou-claim-node');
  if (!node) return;
  var visible = kugouClaimNodeVisible();
  node.style.display = visible ? '' : 'none';
  if (!visible) return;
  var hint = document.getElementById('login-kugou-claim-hint');
  if (hint) {
    hint.textContent = kugouVipClaimBusy
      ? '领取中…'
      : (kugouVipClaimStatus && kugouVipClaimStatus.claimedToday ? '今日已领取' : '每日自动领取');
  }
  renderKugouClaimModal();
}

function openKugouClaimModal() {
  var modal = document.getElementById('kugou-claim-modal');
  if (!modal) return;
  modal.classList.add('show');
  renderKugouAutoControls();
  renderKugouAutoLog();
  renderKugouClaimModal();
  if (kugouLoginStatus && kugouLoginStatus.loggedIn && typeof refreshKugouVipClaimStatus === 'function') {
    refreshKugouVipClaimStatus();
  }
}

function closeKugouClaimModal() {
  var modal = document.getElementById('kugou-claim-modal');
  if (modal) modal.classList.remove('show');
}

function renderKugouClaimModal() {
  var modal = document.getElementById('kugou-claim-modal');
  if (!modal || !modal.classList.contains('show')) return;
  var nickname = (kugouLoginStatus && (kugouLoginStatus.nickname || kugouLoginStatus.username)) || '酷狗概念版用户';
  var nameEl = document.getElementById('lkcp-nickname');
  if (nameEl) nameEl.textContent = nickname;

  var avatar = document.getElementById('lkcp-avatar');
  if (avatar) {
    var pic = kugouLoginStatus && kugouLoginStatus.avatar;
    if (pic) {
      if (avatar.firstChild && avatar.firstChild.tagName === 'IMG') {
        avatar.firstChild.src = pic;
      } else {
        avatar.innerHTML = '';
        var img = document.createElement('img');
        img.src = pic;
        img.alt = '';
        avatar.appendChild(img);
      }
    } else if (!avatar.firstChild || avatar.firstChild.tagName !== 'IMG') {
      avatar.textContent = nickname.slice(0, 1).toUpperCase();
    }
  }

  var vipEl = document.getElementById('lkcp-vip-badge');
  if (vipEl) {
    var vipLabel = kugouVipClaimStatus && kugouVipClaimStatus.vipLabel;
    if (!vipLabel && kugouLoginStatus) {
      vipLabel = kugouLoginStatus.isSvip ? 'SVIP' : (kugouLoginStatus.isVip ? 'VIP' : '');
    }
    vipEl.textContent = vipLabel || 'VIP';
    vipEl.style.display = vipLabel ? '' : 'none';
  }

  var stateEl = document.getElementById('lkcp-state-badge');
  if (stateEl) {
    var claimed = !!(kugouVipClaimStatus && kugouVipClaimStatus.claimedToday);
    stateEl.textContent = kugouVipClaimBusy ? '领取中…' : (claimed ? '今日已领取' : '今日待领取');
    stateEl.className = 'lkcp-badge lkcp-badge-state ' + (claimed ? 'done' : 'pending');
  }

  var subEl = document.getElementById('lkcp-sub');
  if (subEl) {
    var expire = kugouVipClaimStatus && kugouVipClaimStatus.vipExpireTime;
    var days = kugouVipClaimStatus && kugouVipClaimStatus.vipRemainingDays;
    if (expire) {
      subEl.textContent = 'VIP 到期 ' + expire + (days > 0 ? ' · 剩余 ' + days + ' 天' : '') + ' · 打开应用自动领取';
    } else {
      subEl.textContent = '打开应用后自动领取今日权益';
    }
  }

  var btn = document.getElementById('lkcp-claim-btn');
  if (btn) {
    var claimedToday = !!(kugouVipClaimStatus && kugouVipClaimStatus.claimedToday);
    btn.disabled = kugouVipClaimBusy || claimedToday;
    btn.textContent = kugouVipClaimBusy ? '领取中…' : (claimedToday ? '今日已领取' : '领取今日 VIP');
  }
}

function kugouLocalDateStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 自动签到助手设置（localStorage 持久化，参考 EchoMusic auto_check_in 插件）
var KUGOU_AUTO_SETTINGS_KEY = 'mineradio_kugou_auto_plugin_v1';
var KUGOU_AUTO_LOG_KEY = 'mineradio_kugou_auto_log_v1';

function loadKugouAutoSettings() {
  var defaults = { autoOnStartup: true, silent: false, enableAd: true, adCount: 8, adIntervalSec: 3, enableGrade: true, gradeMinutes: 30 };
  try {
    var raw = window.localStorage.getItem(KUGOU_AUTO_SETTINGS_KEY);
    return Object.assign({}, defaults, raw ? JSON.parse(raw) : {});
  } catch (error) {
    return defaults;
  }
}

function saveKugouAutoSettings() {
  var readNum = function (id, def, min, max) {
    var el = document.getElementById(id);
    if (!el) return def;
    var v = Number(el.value);
    if (isNaN(v)) v = def;
    return Math.max(min, Math.min(max, v));
  };
  var settings = {
    autoOnStartup: !!(document.getElementById('lkcp-auto-enable') || {}).checked,
    silent: !!(document.getElementById('lkcp-silent') || {}).checked,
    enableAd: !!(document.getElementById('lkcp-ad-enable') || {}).checked,
    adCount: readNum('lkcp-ad-count', 8, 1, 16),
    adIntervalSec: readNum('lkcp-ad-interval', 3, 1, 10),
    enableGrade: !!(document.getElementById('lkcp-grade-enable') || {}).checked,
    gradeMinutes: readNum('lkcp-grade-minutes', 30, 5, 120),
  };
  try { window.localStorage.setItem(KUGOU_AUTO_SETTINGS_KEY, JSON.stringify(settings)); } catch (error) { }
  renderKugouAutoControls(settings);
  return settings;
}

function renderKugouAutoControls(settings) {
  settings = settings || loadKugouAutoSettings();
  var bindCheck = function (id, value) {
    var el = document.getElementById(id);
    if (el) el.checked = !!value;
  };
  var bindRange = function (id, valueId, value) {
    var el = document.getElementById(id);
    var label = document.getElementById(valueId);
    if (el) el.value = value;
    if (label) label.textContent = value;
  };
  bindCheck('lkcp-auto-enable', settings.autoOnStartup);
  bindCheck('lkcp-silent', settings.silent);
  bindCheck('lkcp-ad-enable', settings.enableAd);
  bindCheck('lkcp-grade-enable', settings.enableGrade);
  bindRange('lkcp-ad-count', 'lkcp-ad-count-val', settings.adCount);
  bindRange('lkcp-ad-interval', 'lkcp-ad-interval-val', settings.adIntervalSec);
  bindRange('lkcp-grade-minutes', 'lkcp-grade-minutes-val', settings.gradeMinutes);
  var adSliders = document.getElementById('lkcp-ad-sliders');
  if (adSliders) adSliders.style.display = settings.enableAd ? '' : 'none';
  var gradeSliders = document.getElementById('lkcp-grade-sliders');
  if (gradeSliders) gradeSliders.style.display = settings.enableGrade ? '' : 'none';
}

function appendKugouAutoLog(text, ok) {
  var entry = {
    time: new Date().toTimeString().slice(0, 8),
    text: String(text || ''),
    ok: ok !== false,
  };
  var list = [];
  try {
    list = JSON.parse(window.localStorage.getItem(KUGOU_AUTO_LOG_KEY) || '[]');
    if (!Array.isArray(list)) list = [];
  } catch (error) { list = []; }
  list.unshift(entry);
  if (list.length > 30) list.length = 30;
  try { window.localStorage.setItem(KUGOU_AUTO_LOG_KEY, JSON.stringify(list)); } catch (error) { }
  renderKugouAutoLog();
}

function renderKugouAutoLog() {
  var box = document.getElementById('lkcp-log');
  if (!box) return;
  var list = [];
  try {
    list = JSON.parse(window.localStorage.getItem(KUGOU_AUTO_LOG_KEY) || '[]');
    if (!Array.isArray(list)) list = [];
  } catch (error) { list = []; }
  if (!list.length) {
    box.innerHTML = '<div class="lkcp-log-empty">暂无运行日志</div>';
    return;
  }
  box.innerHTML = list.map(function (item) {
    var kind = item.ok === false ? 'fail' : 'ok';
    return '<div class="lkcp-log-item ' + kind + '"><span class="lkcp-log-time">' +
      escHtml(item.time) + '</span>' + escHtml(item.text) + '</div>';
  }).join('');
}

function clearKugouAutoLog() {
  try { window.localStorage.removeItem(KUGOU_AUTO_LOG_KEY); } catch (error) { }
  renderKugouAutoLog();
}

// 全量签到流水线：每日权益（每日VIP+升级+听歌打卡）→ 广告任务 → 听歌时长上报
var kugouAutoBusy = false;

async function runKugouFullCheckin(options) {
  var silent = !!(options && options.silent);
  if (kugouAutoBusy) return { ok: false, message: '签到进行中' };
  if (!kugouLoginStatus || !kugouLoginStatus.loggedIn) {
    if (!silent) openProviderLogin('kugou');
    return { ok: false, message: '未登录' };
  }
  var settings = loadKugouAutoSettings();
  kugouAutoBusy = true;
  var progress = document.getElementById('lkcp-progress');
  var fullBtn = document.getElementById('lkcp-full-btn');
  var claimBtn = document.getElementById('lkcp-claim-btn');
  var setProgress = function (text) { if (progress) progress.textContent = text || ''; };
  var okCount = 0;
  var failCount = 0;
  var summary = [];
  try {
    if (fullBtn) fullBtn.disabled = true;
    if (claimBtn) claimBtn.disabled = true;

    // Step 1: 每日权益（每日 VIP + 升级奖励 + 听歌打卡）
    setProgress('正在领取每日权益…');
    var claim;
    try {
      claim = await apiJson('/api/kugou/vip/claim-day', { method: 'POST', timeoutMs: 30000 });
    } catch (error) {
      claim = { ok: false, message: String((error && error.message) || error) };
    }
    if (claim && claim.ok) {
      okCount++;
      summary.push(claim.message || '每日权益领取成功');
      appendKugouAutoLog('每日权益：' + (claim.message || '领取成功'), true);
    } else {
      failCount++;
      appendKugouAutoLog('每日权益：' + ((claim && claim.message) || '领取失败'), false);
    }
    setProgress('');

    // Step 2: 广告任务奖励
    if (settings.enableAd) {
      var got = 0;
      var stopped = '';
      for (var i = 1; i <= settings.adCount; i++) {
        setProgress('广告任务 ' + i + '/' + settings.adCount + '…');
        var r;
        try {
          r = await apiJson('/api/kugou/vip/ad-watch', { method: 'POST', timeoutMs: 20000 });
        } catch (error) {
          r = { ok: false, message: String((error && error.message) || error) };
        }
        if (r && r.ok) {
          if (r.maxReached) { stopped = '已达上限'; break; }
          got++;
          if (i < settings.adCount) {
            await new Promise(function (resolve) { setTimeout(resolve, (settings.adIntervalSec || 3) * 1000); });
          }
        } else {
          stopped = (r && r.message) || '失败';
          break;
        }
      }
      if (got > 0) {
        okCount++;
        summary.push('广告任务 +' + got + ' 次');
        appendKugouAutoLog('广告任务：完成 ' + got + '/' + settings.adCount + (stopped ? '（' + stopped + '）' : ''), true);
      } else {
        appendKugouAutoLog('广告任务：' + (stopped || '无完成次数'), stopped === '已达上限');
      }
    }
    setProgress('');

    // Step 3: 听歌时长上报
    if (settings.enableGrade) {
      setProgress('正在上报听歌时长…');
      var g;
      try {
        g = await apiJson('/api/kugou/vip/grade-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minutes: settings.gradeMinutes }),
          timeoutMs: 20000,
        });
      } catch (error) {
        g = { ok: false, message: String((error && error.message) || error) };
      }
      if (g && g.ok) {
        okCount++;
        summary.push('时长上报 +' + settings.gradeMinutes + ' 分钟');
        appendKugouAutoLog('听歌时长：' + (g.message || '上报成功'), true);
      } else {
        failCount++;
        appendKugouAutoLog('听歌时长：' + ((g && g.message) || '上报失败'), false);
      }
    }
    setProgress('');

    var message = summary.length ? summary.join('，') : '本次没有可执行的任务';
    appendKugouAutoLog('签到完成：成功 ' + okCount + ' 项' + (failCount ? '，失败 ' + failCount + ' 项' : ''), failCount === 0);
    if (!silent || !settings.silent) showToast(message);
    refreshKugouVipClaimStatus();
    return { ok: failCount === 0, message: message };
  } finally {
    kugouAutoBusy = false;
    if (fullBtn) fullBtn.disabled = false;
    renderKugouVipClaimPanel();
  }
}

// 启动后自动签到：每天首次登录状态刷新时检查一次，未领取则静默执行全量签到。
var kugouVipAutoClaimDate = '';

async function maybeAutoClaimKugouDailyVip() {
  if (!kugouLoginStatus || !kugouLoginStatus.loggedIn) return;
  if (kugouVipClaimBusy || kugouAutoBusy) return;
  var settings = loadKugouAutoSettings();
  if (!settings.autoOnStartup) return;
  var today = kugouLocalDateStr();
  if (kugouVipAutoClaimDate === today) return;
  kugouVipAutoClaimDate = today;
  try {
    kugouVipClaimStatus = await apiJson('/api/kugou/vip/claim/status?t=' + Date.now());
  } catch (error) {
    renderKugouClaimNode();
    return;
  }
  renderKugouClaimNode();
  if (!kugouVipClaimStatus || kugouVipClaimStatus.claimedToday) return;
  if (kugouVipClaimStatus.recordAvailable === false) return;
  await runKugouFullCheckin({ silent: true });
}

function renderKugouVipClaimPanel() {
  renderKugouClaimNode();
  var panel = document.getElementById('kugou-vip-claim-panel');
  var status = document.getElementById('kugou-vip-claim-status');
  var button = document.getElementById('kugou-vip-claim-btn');
  var visible = kugouVipClaimPanelVisible();
  if (!panel) return;
  panel.style.display = visible ? '' : 'none';
  if (!visible) return;
  if (status) {
    status.textContent = kugouVipClaimBusy
      ? '正在领取并刷新会员状态…'
      : (kugouVipClaimStatus && kugouVipClaimStatus.claimedToday
        ? '今日畅听权益已领取，可正常使用当前会员音质。'
        : (kugouVipClaimStatus && kugouVipClaimStatus.recordAvailable === false
          ? '暂时无法读取领取记录，仍可手动尝试领取。'
          : '每天可领取一次酷狗概念版 VIP 畅听权益。'));
  }
  if (button) {
    button.disabled = kugouVipClaimBusy || !!(kugouVipClaimStatus && kugouVipClaimStatus.claimedToday);
    button.textContent = kugouVipClaimBusy
      ? '正在领取…'
      : (kugouVipClaimStatus && kugouVipClaimStatus.claimedToday ? '今日已领取' : '领取今日 VIP');
  }
}

async function refreshKugouVipClaimStatus() {
  if (!kugouVipClaimPanelVisible() && !kugouClaimNodeVisible()) return;
  renderKugouVipClaimPanel();
  try {
    kugouVipClaimStatus = await apiJson('/api/kugou/vip/claim/status?t=' + Date.now());
  } catch (error) {
    kugouVipClaimStatus = { recordAvailable: false, error: String((error && error.message) || error) };
  }
  renderKugouVipClaimPanel();
}

async function claimKugouDailyVip(options) {
  var silent = options === true || !!(options && options.silent);
  if (kugouVipClaimBusy) return;
  if (!kugouLoginStatus || !kugouLoginStatus.loggedIn) {
    openProviderLogin('kugou');
    return;
  }
  if (!silent && !window.confirm('领取今天的酷狗概念版 VIP 畅听权益，并刷新当前会员状态？')) return;
  kugouVipClaimBusy = true;
  renderKugouVipClaimPanel();
  try {
    var result = await apiJson('/api/kugou/vip/claim-day', { method: 'POST' });
    if (!result || !result.ok) {
      throw new Error((result && (result.message || result.error)) || '领取失败');
    }
    var bridge = getKugouLiteBridge();
    if (bridge && typeof bridge.refreshProfile === 'function') {
      try { await bridge.refreshProfile(); } catch (e) { }
    }
    kugouVipClaimStatus = { claimedToday: true, recordAvailable: true, date: result.date };
    await refreshKugouLoginStatus();
    updateUserModalUi();
    renderKugouVipClaimPanel();
    showToast(silent ? '已自动领取今日 VIP 畅听权益' : (result.message || '今日 VIP 畅听权益领取成功'));
  } catch (error) {
    console.warn('Kugou daily VIP claim failed:', error);
    showToast((silent ? '自动领取未成功：' : '领取失败：') + String((error && error.message) || error));
  } finally {
    kugouVipClaimBusy = false;
    renderKugouVipClaimPanel();
  }
}
