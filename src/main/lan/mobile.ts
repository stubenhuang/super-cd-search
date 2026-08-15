import zxingWasmBundle from './zxing-wasm.browser.js?raw'

export const MOBILE_ZXING_JS = zxingWasmBundle

export const MOBILE_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Super CD Search · 快速添加</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #f5f0e8; color: #2c2520;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1e1a16; color: #f5eee3; }
  }
  .card {
    width: 100%; max-width: 460px; padding: 32px 24px; text-align: center;
    background: #fefefe; border: 1px solid rgba(44,37,32,.12); border-radius: 18px;
    box-shadow: 0 12px 40px rgba(44,37,32,.12);
  }
  @media (prefers-color-scheme: dark) {
    .card { background: #312a22; border-color: rgba(245,238,227,.12); }
  }
  .badge {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 14px; margin-bottom: 18px; border-radius: 999px;
    background: rgba(93,122,74,.12); color: #5d7a4a; font-weight: 600; font-size: 13px;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #5d7a4a; box-shadow: 0 0 0 4px rgba(93,122,74,.15); }
  h1 { margin: 0 0 10px; font-size: 24px; }
  .intro { margin: 0 0 26px; line-height: 1.7; opacity: .72; font-size: 14px; }
  button {
    width: 100%; padding: 14px 16px; border-radius: 12px; border: 1px solid transparent;
    font: inherit; font-size: 16px; font-weight: 600; cursor: pointer; transition: opacity .15s ease;
  }
  button:disabled { opacity: .5; cursor: wait; }
  .primary { background: #b8860b; color: #2c2520; }
  .secondary { margin-top: 10px; background: transparent; border-color: rgba(44,37,32,.2); color: inherit; }
  @media (prefers-color-scheme: dark) {
    .secondary { border-color: rgba(245,238,227,.25); }
  }
  .divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; color: rgba(44,37,32,.45); font-size: 12px; }
  @media (prefers-color-scheme: dark) { .divider { color: rgba(245,238,227,.45); } }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: rgba(44,37,32,.15); }
  @media (prefers-color-scheme: dark) { .divider::before, .divider::after { background: rgba(245,238,227,.15); } }
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
</style>
</head>
<body>
<main class="card">
  <span class="badge"><span class="dot"></span>LAN Connected · 已连接</span>
  <h1>快速添加 CD 编号</h1>
  <p class="intro">拍摄 CD 盒上的条形码，或手动输入条码数字。<br>识别后会自动添加到电脑搜索框。</p>
  <button id="scan-btn" class="primary" type="button">📷 拍照扫描条码</button>
  <input id="file-input" type="file" accept="image/*" capture="environment" hidden>
  <div class="divider">或</div>
  <input id="barcode-input" type="text" inputmode="numeric" autocomplete="off" placeholder="输入 8–14 位条码数字">
  <button id="submit-btn" class="secondary" type="button">添加编号</button>
  <div id="status" class="status" hidden></div>
</main>
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

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

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
