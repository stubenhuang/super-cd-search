import zxingWasmBundle from './zxing-wasm.browser.js?raw'

export const MOBILE_ZXING_JS = zxingWasmBundle

export const MOBILE_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Super CD Search</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; padding: 0 0 40px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #f5f0e8; color: #2c2520;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1e1a16; color: #f5eee3; }
  }
  .topbar {
    position: sticky; top: 0; z-index: 10;
    padding: 10px 16px 0;
    background: rgba(245,240,232,.92);
    -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  }
  @media (prefers-color-scheme: dark) { .topbar { background: rgba(30,26,22,.92); } }
  .topbar-inner { max-width: 520px; margin: 0 auto; }
  .topbar-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .badge {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 12px; border-radius: 999px;
    background: rgba(93,122,74,.12); color: #5d7a4a; font-weight: 600; font-size: 12px;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #5d7a4a; box-shadow: 0 0 0 4px rgba(93,122,74,.15); }
  .tabs {
    display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px;
    border-radius: 14px; background: rgba(44,37,32,.08);
  }
  @media (prefers-color-scheme: dark) { .tabs { background: rgba(245,238,227,.08); } }
  .tab {
    width: 100%; padding: 10px 8px; border: none; border-radius: 10px;
    background: transparent; color: inherit; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
  }
  .tab.active { background: #fefefe; color: #2c2520; box-shadow: 0 2px 8px rgba(44,37,32,.14); }
  @media (prefers-color-scheme: dark) { .tab.active { background: #312a22; color: #f5eee3; } }
  .page { max-width: 520px; margin: 0 auto; padding: 16px; }
  .panel[hidden] { display: none; }
  .card {
    width: 100%; padding: 28px 20px; text-align: center;
    background: #fefefe; border: 1px solid rgba(44,37,32,.12); border-radius: 18px;
    box-shadow: 0 12px 40px rgba(44,37,32,.12);
  }
  @media (prefers-color-scheme: dark) {
    .card { background: #312a22; border-color: rgba(245,238,227,.12); }
  }
  h1 { margin: 0 0 10px; font-size: 22px; }
  .intro { margin: 0 0 24px; line-height: 1.7; opacity: .72; font-size: 14px; }
  button {
    font: inherit; font-weight: 600; cursor: pointer; transition: opacity .15s ease;
  }
  button:disabled { opacity: .5; cursor: wait; }
  .primary {
    width: 100%; padding: 16px; font-size: 19px; border-radius: 16px; border: 1px solid transparent;
    background: #b8860b; color: #2c2520;
    box-shadow: 0 8px 22px rgba(184,134,11,.28);
  }
  .primary:active { transform: scale(.98); }
  .scan-hint { margin: 12px 4px 18px; font-size: 12px; line-height: 1.6; opacity: .6; }
  .manual-panel {
    margin-top: 4px; border: 1px solid rgba(44,37,32,.15); border-radius: 12px;
    background: transparent; text-align: left;
  }
  @media (prefers-color-scheme: dark) {
    .manual-panel { border-color: rgba(245,238,227,.18); }
  }
  .manual-panel summary {
    list-style: none; cursor: pointer; padding: 12px 14px;
    font-size: 14px; font-weight: 600; opacity: .78;
  }
  .manual-panel summary::-webkit-details-marker { display: none; }
  .manual-panel summary .chevron { float: right; transition: transform .15s ease; }
  .manual-panel[open] summary .chevron { transform: rotate(180deg); }
  .manual-body { padding: 0 14px 14px; }
  .secondary { width: 100%; margin-top: 10px; padding: 13px 14px; border-radius: 12px; background: transparent; border: 1px solid rgba(44,37,32,.2); color: inherit; font-size: 15px; }
  @media (prefers-color-scheme: dark) {
    .secondary { border-color: rgba(245,238,227,.25); }
  }
  input[type="text"] {
    width: 100%; padding: 13px 14px; border: 1px solid rgba(44,37,32,.25); border-radius: 12px;
    font: inherit; font-size: 16px; text-align: center; background: #f5f0e8; color: inherit;
  }
  @media (prefers-color-scheme: dark) {
    input[type="text"] { background: #26211a; border-color: rgba(245,238,227,.25); }
  }
  .status { margin-top: 18px; padding: 12px 14px; border-radius: 12px; font-size: 14px; line-height: 1.6; text-align: center; }
  .status[hidden] { display: none; }
  .loading { background: rgba(184,134,11,.1); color: #9a7209; }
  @media (prefers-color-scheme: dark) { .loading { color: #f0ce68; } }
  .success { background: rgba(93,122,74,.12); color: #5d7a4a; }
  .error { background: rgba(166,61,64,.1); color: #a63d40; }
  .status .catalog { display: block; margin-top: 4px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 16px; font-weight: 700; }
  .status .sub { display: block; margin-top: 2px; opacity: .75; font-size: 12px; overflow-wrap: anywhere; }
  .status.candidates { text-align: left; }
  .status .candidate-list { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  .status .candidate {
    width: 100%; padding: 10px 12px; border: 1px solid rgba(44,37,32,.2); border-radius: 10px;
    background: transparent; color: inherit; cursor: pointer; text-align: left; font-size: 13px;
  }
  @media (prefers-color-scheme: dark) {
    .status .candidate { border-color: rgba(245,238,227,.25); }
  }
  .status .candidate .candidate-catno {
    display: block; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 15px; font-weight: 700;
  }
  .status .candidate .candidate-title { display: block; margin-top: 2px; opacity: .75; font-size: 12px; overflow-wrap: anywhere; }
  .status .candidate .candidate-source { display: block; margin-top: 2px; opacity: .55; font-size: 11px; }
  .spinner {
    display: inline-block; width: 16px; height: 16px; margin-right: 8px; vertical-align: -2px;
    border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
    animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ---- 发布 tab ---- */
  .publish-summary {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    margin-bottom: 12px; padding: 12px 14px;
    background: #fefefe; border: 1px solid rgba(44,37,32,.12); border-radius: 14px;
    font-size: 13px; line-height: 1.6;
  }
  @media (prefers-color-scheme: dark) {
    .publish-summary { background: #312a22; border-color: rgba(245,238,227,.12); }
  }
  .publish-summary .stats { display: flex; flex-direction: column; }
  .publish-summary .stats-main { font-weight: 700; font-size: 14px; }
  .publish-summary .stats-sub { opacity: .6; font-size: 12px; }
  .publish-refresh {
    flex-shrink: 0; padding: 10px 14px; border-radius: 10px; font-size: 13px;
    background: transparent; border: 1px solid rgba(44,37,32,.2); color: inherit;
  }
  @media (prefers-color-scheme: dark) { .publish-refresh { border-color: rgba(245,238,227,.25); } }
  .publish-empty {
    padding: 40px 20px; text-align: center; font-size: 14px; line-height: 1.8; opacity: .7;
    background: #fefefe; border: 1px dashed rgba(44,37,32,.2); border-radius: 14px;
  }
  @media (prefers-color-scheme: dark) {
    .publish-empty { background: #312a22; border-color: rgba(245,238,227,.2); }
  }
  .publish-list { display: flex; flex-direction: column; gap: 12px; }
  .pub-item {
    padding: 14px; background: #fefefe; border: 1px solid rgba(44,37,32,.12); border-radius: 16px;
  }
  @media (prefers-color-scheme: dark) {
    .pub-item { background: #312a22; border-color: rgba(245,238,227,.12); }
  }
  .pub-item.pub-on { border-color: rgba(184,134,11,.55); box-shadow: 0 0 0 1px rgba(184,134,11,.25); }
  .pub-head { display: flex; gap: 12px; align-items: flex-start; }
  .pub-cover {
    width: 64px; height: 64px; flex-shrink: 0; object-fit: cover;
    border-radius: 10px; border: 1px solid rgba(44,37,32,.12); background: rgba(44,37,32,.06);
  }
  .pub-cover.broken { visibility: hidden; }
  .pub-cover-slot { position: relative; width: 64px; height: 64px; flex-shrink: 0; }
  .pub-cover-slot::after {
    content: "♪"; position: absolute; inset: 0; display: grid; place-items: center;
    border-radius: 10px; border: 1px solid rgba(44,37,32,.12); background: rgba(44,37,32,.06);
    font-size: 22px; opacity: .4;
  }
  .pub-head-main { flex: 1; min-width: 0; }
  .pub-cat-row { display: flex; align-items: center; gap: 8px; }
  .pub-cat {
    flex: 1; min-width: 0; font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 16px; font-weight: 700; overflow-wrap: anywhere;
  }
  .copy-btn {
    flex-shrink: 0; min-width: 64px; padding: 8px 10px; border-radius: 10px; font-size: 13px;
    background: rgba(93,122,74,.14); border: 1px solid rgba(93,122,74,.4); color: #5d7a4a;
  }
  .copy-btn.copied { background: rgba(93,122,74,.3); }
  .pub-meta-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .pub-badge {
    display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px;
    background: rgba(184,134,11,.16); color: #9a7209; font-size: 12px; font-weight: 700;
  }
  @media (prefers-color-scheme: dark) { .pub-badge { color: #f0ce68; } }
  .pub-index { font-size: 12px; opacity: .5; }
  .pub-details { margin-top: 12px; }
  .pub-details summary {
    list-style: none; cursor: pointer; display: flex; align-items: flex-start; gap: 8px;
    font-size: 13px; font-weight: 600; opacity: .8;
  }
  .pub-details summary::-webkit-details-marker { display: none; }
  .pub-details .preview {
    flex: 1; min-width: 0; font-weight: 400;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .pub-details .chevron { flex-shrink: 0; transition: transform .15s ease; }
  .pub-details[open] .chevron { transform: rotate(180deg); }
  .pub-details .full-text {
    margin-top: 8px; padding: 10px 12px; border-radius: 10px;
    background: rgba(44,37,32,.05); font-size: 13px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere;
  }
  @media (prefers-color-scheme: dark) { .pub-details .full-text { background: rgba(245,238,227,.06); } }
  .pub-copy-details {
    margin-top: 8px; width: 100%; padding: 11px; border-radius: 10px; font-size: 13px;
    background: transparent; border: 1px solid rgba(44,37,32,.2); color: inherit;
  }
  @media (prefers-color-scheme: dark) { .pub-copy-details { border-color: rgba(245,238,227,.25); } }
  .pub-prices {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px;
  }
  .price-cell {
    display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
    padding: 10px 12px; border-radius: 12px; text-align: left;
    background: rgba(44,37,32,.05); border: 1px solid transparent; color: inherit;
  }
  .price-cell:active { border-color: rgba(93,122,74,.5); }
  .price-cell .label { font-size: 11px; opacity: .6; }
  .price-cell .value { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .price-cell.copied { background: rgba(93,122,74,.18); }
  .price-cell.copied .value { color: #5d7a4a; }
  .price-cell .copied-hint { font-size: 11px; color: #5d7a4a; font-weight: 600; }
  .pub-toggle {
    margin-top: 12px; width: 100%; padding: 12px; border-radius: 12px; font-size: 14px;
    background: transparent; border: 1px solid rgba(184,134,11,.5); color: #9a7209;
  }
  @media (prefers-color-scheme: dark) { .pub-toggle { color: #f0ce68; } }
  .pub-item.pub-on .pub-toggle { background: rgba(184,134,11,.12); }
  .pub-platforms { display: none; gap: 8px; margin-top: 10px; }
  .pub-item.pub-on .pub-platforms { display: grid; grid-template-columns: 1fr 1fr 1fr; }
  .platform-chip {
    padding: 11px 6px; border-radius: 10px; font-size: 13px;
    background: transparent; border: 1px solid rgba(44,37,32,.2); color: inherit;
  }
  @media (prefers-color-scheme: dark) { .platform-chip { border-color: rgba(245,238,227,.25); } }
  .platform-chip.on {
    background: rgba(93,122,74,.16); border-color: rgba(93,122,74,.55); color: #5d7a4a;
  }
  .platform-chip .platform-check { margin-right: 4px; }
  .toast {
    position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(8px);
    z-index: 50; max-width: 86vw; padding: 10px 18px; border-radius: 999px;
    background: rgba(44,37,32,.9); color: #f5eee3; font-size: 13px; font-weight: 600;
    opacity: 0; pointer-events: none; transition: opacity .2s ease, transform .2s ease;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div class="topbar-row">
      <span class="badge"><span class="dot"></span>LAN · 已连接</span>
    </div>
    <nav class="tabs">
      <button id="tab-scan" class="tab active" type="button">📷 扫描</button>
      <button id="tab-publish" class="tab" type="button">📋 发布</button>
    </nav>
  </div>
</header>
<main class="page">
  <section id="panel-scan" class="panel">
    <div class="card">
      <h1>快速添加 CD 编号</h1>
      <p class="intro">拍摄 CD 盒上的条形码，识别后会自动添加到电脑搜索框。</p>
      <button id="scan-btn" class="primary" type="button">📷 扫描 CD 条码</button>
      <input id="file-input" type="file" accept="image/*" capture="environment" hidden>
      <div class="scan-hint">点击按钮调起相机，对条码拍照即可自动识别</div>
      <details class="manual-panel">
        <summary>⌨️ 手动输入条码<span class="chevron">▾</span></summary>
        <div class="manual-body">
          <input id="barcode-input" type="text" inputmode="numeric" autocomplete="off" placeholder="输入 8–14 位条码数字">
          <button id="submit-btn" class="secondary" type="button">添加编号</button>
        </div>
      </details>
      <div id="status" class="status" hidden></div>
    </div>
  </section>
  <section id="panel-publish" class="panel" hidden>
    <div class="publish-summary">
      <div class="stats">
        <span id="publish-stats-main" class="stats-main">发布</span>
        <span id="publish-stats-sub" class="stats-sub"></span>
      </div>
      <button id="publish-refresh" class="publish-refresh" type="button">↻ 刷新</button>
    </div>
    <div id="publish-content" class="publish-empty">正在加载发布内容…</div>
  </section>
</main>
<div id="toast" class="toast"></div>
<script src="/zxing.js"></script>
<script src="/mobile.js"></script>
</body>
</html>`

export const MOBILE_APP_JS = `(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  var scanBtn = byId('scan-btn');
  var fileInput = byId('file-input');
  var barcodeInput = byId('barcode-input');
  var submitBtn = byId('submit-btn');
  var status = byId('status');
  var busy = false;

  /* ---------- tabs ---------- */

  var tabScan = byId('tab-scan');
  var tabPublish = byId('tab-publish');
  var panelScan = byId('panel-scan');
  var panelPublish = byId('panel-publish');
  var activeTab = 'scan';

  function switchTab(name) {
    activeTab = name;
    var isScan = name === 'scan';
    tabScan.classList.toggle('active', isScan);
    tabPublish.classList.toggle('active', !isScan);
    panelScan.hidden = !isScan;
    panelPublish.hidden = isScan;
    if (!isScan) loadPublishList(false);
  }

  tabScan.addEventListener('click', function () { switchTab('scan'); });
  tabPublish.addEventListener('click', function () { switchTab('publish'); });

  /* ---------- toast & clipboard ---------- */

  var toastTimer = null;
  function toast(message) {
    var el = byId('toast');
    el.textContent = message;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function copyWithFeedback(text, button, copiedLabel) {
    copyText(text).then(function (ok) {
      if (!ok) { toast('复制失败，请长按手动复制'); return; }
      toast('已复制');
      if (!button) return;
      var original = button.getAttribute('data-original-label') || button.innerHTML;
      button.setAttribute('data-original-label', original);
      button.innerHTML = copiedLabel || '已复制 ✓';
      button.classList.add('copied');
      setTimeout(function () {
        button.innerHTML = original;
        button.classList.remove('copied');
        button.removeAttribute('data-original-label');
      }, 1200);
    });
  }

  /* ---------- publish tab ---------- */

  var publishContent = byId('publish-content');
  var publishStatsMain = byId('publish-stats-main');
  var publishStatsSub = byId('publish-stats-sub');
  var publishRefresh = byId('publish-refresh');
  var publishItems = [];
  var publishLoading = false;
  var publishedAtText = '';
  var publishEventSource = null;
  var publishRefreshTimer = null;

  var PLATFORM_LABELS = { taobao: '淘宝', xianyu: '闲鱼', discogs: 'Discogs' };
  var PLATFORM_ORDER = ['taobao', 'xianyu', 'discogs'];
  var PRICE_FIELDS = [
    ['lowestPriceUsd', '最低价($)'],
    ['highestPriceUsd', '最高价($)'],
    ['lowestPriceCny', '最低价(￥)'],
    ['highestPriceCny', '最高价(￥)']
  ];

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatPrice(value) {
    return value === null || value === undefined ? null : Number(value).toFixed(2);
  }

  function formatTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function imageSrc(item) {
    return '/publish/image?catalog=' + encodeURIComponent(item.catalogNumber);
  }

  function renderPublish() {
    // Remember which cards have their details expanded so automatic refreshes
    // (polling, mutations) never collapse what the user is reading.
    var openCatalogs = {};
    publishContent.querySelectorAll('details.pub-details[open]').forEach(function (details) {
      var article = details.closest('article.pub-item');
      var item = article && publishItems[Number(article.getAttribute('data-index'))];
      if (item) openCatalogs[item.catalogNumber] = true;
    });

    publishStatsMain.textContent = publishItems.length
      ? '共 ' + publishItems.length + ' 条 CD'
      : '发布';

    var publishedCount = 0;
    var platformCount = 0;
    publishItems.forEach(function (item) {
      if (item.published) publishedCount++;
      if (item.platforms && item.platforms.length) platformCount++;
    });
    publishStatsSub.textContent = publishItems.length
      ? '已发布 ' + publishedCount + ' · 平台标记 ' + platformCount
        + (publishedAtText ? ' · ' + publishedAtText : '')
      : '';

    if (!publishItems.length) {
      publishContent.className = 'publish-empty';
      publishContent.innerHTML = '当前没有进行中的发布<br>在电脑端「CD 库」勾选条目后点击「发布」，并保持发布页打开';
      return;
    }

    var html = publishItems.map(function (item, index) {
      var pricesHtml = PRICE_FIELDS.map(function (field) {
        var text = formatPrice(item[field[0]]);
        var valueHtml = text === null
          ? '<span class="value">—</span>'
          : '<span class="value">' + text + '</span>';
        var disabledAttr = text === null ? ' disabled' : '';
        return '<button type="button" class="price-cell" data-action="copy-price" data-index="' + index + '" data-field="' + field[0] + '"' + disabledAttr + '>' +
          '<span class="label">' + field[1] + '</span>' + valueHtml + '</button>';
      }).join('');

      var platformHtml = PLATFORM_ORDER.map(function (platform) {
        var on = item.platforms && item.platforms.indexOf(platform) >= 0;
        return '<button type="button" class="platform-chip' + (on ? ' on' : '') + '" data-action="toggle-platform" data-index="' + index + '" data-platform="' + platform + '">' +
          '<span class="platform-check">' + (on ? '✓' : '＋') + '</span>' + PLATFORM_LABELS[platform] + '</button>';
      }).join('');

      var badge = item.published ? '<span class="pub-badge">已发布</span>' : '';

      return '<article class="pub-item' + (item.published ? ' pub-on' : '') + '" data-index="' + index + '">' +
        '<div class="pub-head">' +
          '<span class="pub-cover-slot"><img class="pub-cover" src="' + escapeHtml(imageSrc(item)) + '" alt="" loading="lazy"></span>' +
          '<div class="pub-head-main">' +
            '<div class="pub-cat-row">' +
              '<span class="pub-cat">' + escapeHtml(item.catalogNumber) + '</span>' +
              '<button type="button" class="copy-btn" data-action="copy-catalog" data-index="' + index + '">复制</button>' +
            '</div>' +
            '<div class="pub-meta-row">' + badge + '<span class="pub-index">#' + (index + 1) + '</span></div>' +
          '</div>' +
        '</div>' +
        '<details class="pub-details">' +
          '<summary><span class="preview">' + escapeHtml(item.details || '（无详情）') + '</span><span class="chevron">▾</span></summary>' +
          '<div class="full-text">' + escapeHtml(item.details || '（无详情）') + '</div>' +
          '<button type="button" class="pub-copy-details" data-action="copy-details" data-index="' + index + '">复制详情</button>' +
        '</details>' +
        '<div class="pub-prices">' + pricesHtml + '</div>' +
        '<button type="button" class="pub-toggle" data-action="toggle-published" data-index="' + index + '">' +
          (item.published ? '取消发布' : '标记为已发布') + '</button>' +
        '<div class="pub-platforms">' + platformHtml + '</div>' +
      '</article>';
    }).join('');

    publishContent.className = 'publish-list';
    publishContent.innerHTML = html;
    publishContent.querySelectorAll('article.pub-item').forEach(function (article) {
      var item = publishItems[Number(article.getAttribute('data-index'))];
      if (!item || !openCatalogs[item.catalogNumber]) return;
      var details = article.querySelector('details.pub-details');
      if (details) details.open = true;
    });
  }

  function loadPublishList(showSpinner) {
    if (publishLoading) return;
    publishLoading = true;
    publishRefresh.disabled = true;
    if (showSpinner) {
      publishContent.className = 'publish-empty';
      publishContent.textContent = '正在加载发布内容…';
    }
    fetch('/api/publish/list', { credentials: 'same-origin' })
      .then(function (response) { return response.json(); })
      .then(function (snapshot) {
        publishItems = (snapshot && snapshot.items) || [];
        publishedAtText = snapshot && snapshot.publishedAt ? formatTime(snapshot.publishedAt) : '';
        renderPublish();
      })
      .catch(function () {
        publishContent.className = 'publish-empty';
        publishContent.innerHTML = '无法连接电脑，请检查手机与电脑是否在同一局域网';
      })
      .finally(function () {
        publishLoading = false;
        publishRefresh.disabled = false;
      });
  }

  /**
   * Desktop changes arrive instantly over SSE. Refreshes are debounced so
   * bursts (e.g. library auto-saves during a desktop search) collapse into
   * one list reload.
   */
  function handlePublishEvent(kind) {
    if (kind === 'finished') toast('本轮发布已完成');
    if (publishRefreshTimer) clearTimeout(publishRefreshTimer);
    publishRefreshTimer = setTimeout(function () {
      publishRefreshTimer = null;
      if (activeTab === 'publish' && !document.hidden) loadPublishList(false);
    }, 300);
  }

  function connectPublishEvents() {
    if (publishEventSource || typeof EventSource === 'undefined') return;
    var source = new EventSource('/api/publish/events');
    publishEventSource = source;
    // A reconnect may have missed events; refresh once the stream is open again.
    source.onopen = function () {
      if (activeTab === 'publish') loadPublishList(false);
    };
    source.addEventListener('changed', function () { handlePublishEvent('changed'); });
    source.addEventListener('finished', function () { handlePublishEvent('finished'); });
  }

  connectPublishEvents();

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && activeTab === 'publish') loadPublishList(false);
  });

  publishRefresh.addEventListener('click', function () { loadPublishList(true); });

  function postPublish(path, body) {
    return fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok || !data || data.status !== 'ok') {
          throw new Error((data && data.message) || '操作失败，请重试');
        }
      });
    });
  }

  publishContent.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button) return;
    var index = Number(button.getAttribute('data-index'));
    var item = publishItems[index];
    if (!item) return;
    var action = button.getAttribute('data-action');

    if (action === 'copy-catalog') {
      copyWithFeedback(item.catalogNumber, button, '已复制 ✓');
      return;
    }

    if (action === 'copy-details') {
      if (!item.details) { toast('该 CD 暂无详情'); return; }
      copyWithFeedback(item.details, button, '✓ 已复制详情');
      return;
    }

    if (action === 'copy-price') {
      var text = formatPrice(item[button.getAttribute('data-field')]);
      if (text === null) return;
      copyWithFeedback(text, button, '<span class="copied-hint">已复制 ✓</span>');
      return;
    }

    if (action === 'toggle-published') {
      var next = !item.published;
      button.disabled = true;
      postPublish('/api/publish/state', { catalogNumber: item.catalogNumber, published: next })
        .then(function () {
          item.published = next;
          renderPublish();
          toast(next ? '已标记为已发布，可勾选发布平台' : '已取消发布');
        })
        .catch(function (err) { toast(err.message || '操作失败，请重试'); })
        .finally(function () { renderPublish(); });
      return;
    }

    if (action === 'toggle-platform') {
      var platform = button.getAttribute('data-platform');
      var platforms = (item.platforms || []).slice();
      var pos = platforms.indexOf(platform);
      if (pos >= 0) platforms.splice(pos, 1);
      else platforms.push(platform);
      button.disabled = true;
      postPublish('/api/publish/platforms', { catalogNumber: item.catalogNumber, platforms: platforms })
        .then(function () {
          item.platforms = platforms;
          renderPublish();
          toast('已更新发布平台');
        })
        .catch(function (err) { toast(err.message || '操作失败，请重试'); })
        .finally(function () { renderPublish(); });
      return;
    }
  });

  // <img> error events do not bubble; catch them on the way up and hide the frame.
  publishContent.addEventListener('error', function (event) {
    var img = event.target;
    if (img && img.tagName === 'IMG' && img.classList.contains('pub-cover')) {
      img.classList.add('broken');
    }
  }, true);

  /* ---------- scan tab (unchanged behaviour) ---------- */

  function normalizeBarcode(value) {
    var normalized = String(value || '').replace(/[\\s-]/g, '');
    if (!/^\\d{8,14}$/.test(normalized)) return null;
    return normalized;
  }

  var SOURCE_LABELS = {
    discogs: 'Discogs',
    tower: 'Tower Records Japan',
    hmv: 'HMV Japan',
    yahoo: 'Yahoo Shopping',
    surugaya: 'Suruga-ya'
  };

  function setBusy(next) {
    busy = next;
    scanBtn.disabled = next;
    submitBtn.disabled = next;
    barcodeInput.disabled = next;
  }

  function show(kind, html) {
    status.hidden = false;
    status.className = 'status ' + kind;
    status.innerHTML = html;
  }

  function renderResponse(data) {
    if (!data || !data.status) {
      show('error', '电脑返回了无效响应，请重试');
      return;
    }

    if (data.status === 'added') {
      var title = data.title ? '<span class="sub">' + escapeHtml(data.title) + '</span>' : '';
      var source = data.source ? '<span class="sub">来源：' + escapeHtml(SOURCE_LABELS[data.source] || data.source) + '</span>' : '';
      show('success', '已添加到电脑搜索框<span class="catalog">' + escapeHtml(data.catalogNumber) + '</span>' + title + source);
      barcodeInput.value = '';
      return;
    }

    if (data.status === 'candidates' && data.candidates && data.candidates.length) {
      var items = data.candidates.map(function (candidate) {
        return '<button type="button" class="candidate" data-catalog="' + escapeHtml(candidate.catalogNumber) + '">' +
        '<span class="candidate-catno">' + escapeHtml(candidate.catalogNumber) + '</span>' +
        '<span class="candidate-title">' + escapeHtml(candidate.title || '') + '</span>' +
        '<span class="candidate-source">来源：' + escapeHtml(SOURCE_LABELS[candidate.source] || candidate.source) + '</span>' +
        '</button>';
      }).join('');
      show('candidates', '找到多个候选，请选择要添加的编号：<div class="candidate-list">' + items + '</div>');
      status.querySelectorAll('button.candidate').forEach(function (button) {
        button.addEventListener('click', function () {
          selectCandidate(data.barcode, button.getAttribute('data-catalog'));
        });
      });
      return;
    }

    if (data.status === 'not_found') {
      show('error', escapeHtml(data.message || '所有条码来源均未找到该 CD') + '<span class="sub">条码：' + escapeHtml(data.barcode) + '</span>');
      return;
    }

    if (data.status === 'unavailable') {
      show('error', escapeHtml(data.message || '桌面端正在搜索，请稍后再试'));
      return;
    }

    if (data.status === 'no_token') {
      show('error', escapeHtml(data.message || '请先在电脑的「设置 → API 令牌」中配置 Discogs Token'));
      return;
    }

    show('error', escapeHtml(data.message || '条码查询失败，请稍后重试'));
  }

  function selectCandidate(barcode, catalogNumber) {
    if (!barcode || !catalogNumber || busy) return;
    setBusy(true);
    show('loading', '<span class="spinner"></span>正在添加所选编号…');

    fetch('/api/barcode/select', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: barcode, catalogNumber: catalogNumber })
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (response.status === 409 && data) data.status = 'unavailable';
        renderResponse(data);
      });
    }).catch(function () {
      show('error', '无法连接电脑，请检查手机与电脑是否在同一局域网');
    }).finally(function () {
      setBusy(false);
    });
  }

  function submitBarcode(barcode) {
    var normalized = normalizeBarcode(barcode);
    if (!normalized) {
      setBusy(false);
      show('error', '条码必须是 8–14 位数字');
      return;
    }

    setBusy(true);
    show('loading', '<span class="spinner"></span>正在查询条码…');

    fetch('/api/barcode', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: normalized })
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (response.status === 409 && data) data.status = 'unavailable';
        renderResponse(data);
      });
    }).catch(function () {
      show('error', '无法连接电脑，请检查手机与电脑是否在同一局域网');
    }).finally(function () {
      setBusy(false);
    });
  }

  function decodeFile(file) {
    return ZXingWasmReader.decodeBarcodeFile(file).then(function (text) {
      if (!text) throw new Error('empty barcode');
      return text;
    });
  }

  scanBtn.addEventListener('click', function () {
    if (!busy) fileInput.click();
  });

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file || busy) return;

    setBusy(true);
    show('loading', '<span class="spinner"></span>正在识别条码…');
    decodeFile(file).then(function (text) {
      if (!text) throw new Error('empty barcode');
      submitBarcode(text);
    }).catch(function () {
      setBusy(false);
      show('error', '无法识别条码，请拍清楚一些或改用下方手动输入');
    });
  });

  submitBtn.addEventListener('click', function () {
    submitBarcode(barcodeInput.value);
  });

  barcodeInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') submitBarcode(barcodeInput.value);
  });
})();`
