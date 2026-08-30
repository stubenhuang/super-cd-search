import zxingWasmBundle from './zxing-wasm.browser.js?raw'

export const MOBILE_ZXING_JS = zxingWasmBundle

export const MOBILE_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Super CD Search</title>
<link rel="icon" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAARGVYSWZNTQAqAAAACAABh2kABAAAAAEAAAAaAAAAAAADoAEAAwAAAAEAAQAAoAIABAAAAAEAAAAgoAMABAAAAAEAAAAgAAAAAKyGYvMAAAHLaVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJYTVAgQ29yZSA2LjAuMCI+CiAgIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgICAgIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICAgICAgICAgIHhtbG5zOmV4aWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vZXhpZi8xLjAvIj4KICAgICAgICAgPGV4aWY6Q29sb3JTcGFjZT4xPC9leGlmOkNvbG9yU3BhY2U+CiAgICAgICAgIDxleGlmOlBpeGVsWERpbWVuc2lvbj41MTI8L2V4aWY6UGl4ZWxYRGltZW5zaW9uPgogICAgICAgICA8ZXhpZjpQaXhlbFlEaW1lbnNpb24+NTEyPC9leGlmOlBpeGVsWURpbWVuc2lvbj4KICAgICAgPC9yZGY6RGVzY3JpcHRpb24+CiAgIDwvcmRmOlJERj4KPC94OnhtcG1ldGE+CgCF4JgAAAkjSURBVFgJ7VdbbBxnGT3/XHZnvXc7Xttx7NycurGbNGmblIbSpqICFKKWCEqRUolWUCEhhMoLDyAqEAUJhLg8lGt5Qa0grUJDqipBaWlKkyZprnVqx05ibx17vRvvrr3e+9x2ODO5eUNb8QYP/NJqZnb/me/M951zvm+B//IS/0l850XI1/eNwLl+fu1kGAKPXLu4ehzZymcfbIjvo3HTL02XHwrAOf+LVftP5T8/kSptshpOWJIUIWQJis8HSfFBUVUiEby/Acd2YNsGjw00LAumoQvLMInKMbsTwfe23798V3DNN041Rb568YEA3tn7nS8+t2fsVwePJzuz2YIbCEKS+JEh8SgrCgMytHMlGT5FgmGafCSv+Z3TIBDb4mkD0UgQmzesrD+2rf9Hn1tf+om46/fuxutLuX529eT0y09tffp3R/70yoGzfkmBo6o+MDICfhVBTeJ5A9VaDfds6OB3MkwCOXQyjVXdIZSrJio1EwslkwAJgkDS6Vnsnkxp0zP5H/qe3JJjmN8ujtkEwHn7kcBTfxx75sChUf+GgXZnoWwhsSSI9f0JL7jEfEXDAew/PI2uNj/f0sHypSGUSnVsGmj1gk9frqB9SRTlchWp2SpqdRMXJ/POsZOj4vmu0NPO8E/3iMFvZ66BaAKQr7SvODY0urmTD996RycyczrW9ESwJCyjWrdwKVNBV9BBXDNFca7olWFOqkGYVSTft3H7qqgz07DQnxDQ4xru6Y/graHL+NjAahw8kXKOnkl27T+a3Mzgez8QwPmpUqJcqavpbM3JsfY9rX6U5vIYGa17b+cn3EvTeRyfsLChV8C9Hh4HzlxysGmFgdMjZWHZwjl3vo5Ii4o0yzOdruDu1S1o8UmYnq0gOZnpuRbcPTZlgPcKj1Ykmgsgl5dQ1oGJWRs6qbOy04982RZWQ+Cd5BUCCgpB4f63xy2E/EBPmyIOj5WdWKABmU/r6/Lj70cvITdPVbCGDbtxQ9IEQFbdWArZLbmbqNzjSQN2II5YaxSRsIbBVVH4fTLIMY/dEhnvcsI9umpQKNGqIZArmti4Jgwhq6jZMvKmH6cmLSRnDe4hWJ98BfnVsE0ZUDT3UsA0G1i9IoHZfBUNQ8fgylacHV9AsWKT9Y5DqQuNCmBMGJbj7Xcl2Bbx4ZblQbx7YU4MrIw5M9mqd2+CfBg6P+8RUqJkF68mAJoW8vSuaTKiQUpMcVCSZaSydUzM1NBCgBsHOrBlYwdWLw1CdkykMiUMXVzAidEC5os6xqcMzJUamKIa3Kypdg06lXD3QAyZggVrkam6QJoBBAOO4wh0tGoI+gVs1tbvl/DWmSw62zR89ZF1+MK2teheEnAU1rdaKIhCLo/71gbw7q0aXjqUx7HRIlS+5eTlGpbynoMn5hEKKthxfw9MsAwqibJoNQMIheGwsK1hFRcmF7xtAU31av+tnbdh545BRGIRGLRZkw5ksBy6bkGyTTHYrSD0QNRzwWNjJYSYxdyCjuVdISyU61ioWCgwQ7L/IwAomgaZKY8FwHT7STIJZyeK2LG1Fw8/sJzJa4AGh2AoiGqpgnrNoDFaMHTDqVR1dESAbbdrmMrq6E60QKd0XKL2JIIQtOW6biMUbmmy/6YMKAGNKpAR8tlQSVbym1xQsP3eboQDCizTouQc7P/nBby0dwi2XkeLZOB+lkAVNtMr6B3A5j4N0/k6gVlY19fGwBZ5oCNGXila+MNV4OZcsLazczXk6efhoA9re6NY1RWEqRtQmZXX3zyHF/aN45nvfhbJ98bx530XcTQjEFd1LNNKSMT96G2T8fqQzvs02FRRls+r6g16CGM3aCyLVlMGrFIZtkXTqRrsbo4nm644t9gm/rI/iftuj+PlfaN48uH1+OWzr9GoqljW3QHVp2Ds/VnI7WEspXLaIzbW9fpp4QIZ7klSQUuXaOQNy1WpNpWgSZT1eh0WAURbZK/Tp/M68vNVlOYLlFsBQ8MplIsVFDMpnD4zhWKxjovJLCS9jENHx5Gl/Hwkcizagux8DSOXqswk2zK9xWZ7dkth6s0ZaAIwX6ghrAnWSkIiqnp+XijpmL2cxR3dFuJyEVGfiT3/SGLnlgCiqoFzY9OYy6QxuML1e3KgtwO2UOl8JnyK8J63fkUApYoJi91Tr30EgEKhjHhA0PFM+OUGWkMSzqeqmJopQqGhVMn0e/sDHkd2H85h5nKRqVYxlSYw3ufTfMhWJRwdziGisdycWmayNc4JBjsrFcNcuMpYvJo4oFdqrE8DutGglxNIzaGrWTidrOLTd8Th4ximqBIe/2QbUgsSwrEoOiixGbbt147MsE9ISOVtxDqXIRaa94js9hXXA9whpTUmMQO1xfFvakY0yjTlYzds+JiBW7sU9C9VMTxVw8W0jmDQ7819gl7R39viNZ07BxPo7mLTosRu7dHQ3hrAU0/cia9/7TM0HgPdbSxHpu62GK+J6TdxoCkDwqzbdcPB5KUKutv9mGeNOYdgdsHG85WM94ABNhs/We92TndU02kuG26JY/hCAiMjk+juTaDELrj9wTXY9WICE1RHseJKn93TnScdq2lKbgKwZW0omWhtKY5eQORiikh4gxvEbXulGRu/eTWNjw+EsHF1BD1dgCl8mM7pGJmYx4ETWdy2TMWeV0/j2Z+vQyk7hw0c5Q4fn4ZQZc7HJDHVsXxJgCPMjdUEIJBdSN+5Jrz3zHj8seLcPEHz9QXnB7eQXBl+tftwAQdOLyAekj2Wl6oN5Eo2mSMjrETplGX8bdcbDKTiE7fI2MWS5OYqkLWgWN8XPf/olrYjX7oRv7k3/uClEefX39x8KpWvb58uym2cfIQ7xbj2LCsqJE7Iii/ANw+gbGkoGhp0BNhg+FH8GJvmfwMCduWZy5WgsF1bSlCMpm1xz2Cr/sSDnV9Z9/hfzy6K71Lj39fJ5x7q+8P+qZ+dHK99qlBxAkJWvCbl/h+QeS651wpBkYzuSOa6p2s0ronpNDNVsskXZoWJI5ntvk71zEOb2r735R+/ue/maB8IwN3kvLFVOfier29sqtLDfzyeYUmq6rg1YxcWjEcQVx7nuA3k2uIgqnNkcsGQQk5n3Jd/dHtsVNz1SvXalv8f/6cy8C8wHT4cJN7BWwAAAABJRU5ErkJggg==" type="image/png">
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
  h1 { margin: 0 0 4px; font-size: 18px; }
  .intro { margin: 0 0 10px; line-height: 1.5; opacity: .6; font-size: 12px; }
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
  textarea {
    width: 100%; min-height: 220px; padding: 11px 12px; border: 1px solid rgba(44,37,32,.25); border-radius: 12px;
    font: inherit; font-size: 15px; text-align: left; background: #f5f0e8; color: inherit;
    resize: none;
  }
  @media (prefers-color-scheme: dark) {
    textarea { background: #26211a; border-color: rgba(245,238,227,.25); }
  }
  .search-card { padding: 16px 14px 12px; }
  .search-controls { display: flex; align-items: stretch; gap: 8px; margin-top: 10px; }
  .mode-switch {
    flex-shrink: 0; display: flex; gap: 2px; padding: 3px;
    border-radius: 12px; background: rgba(44,37,32,.08);
  }
  @media (prefers-color-scheme: dark) { .mode-switch { background: rgba(245,238,227,.08); } }
  .mode-btn {
    padding: 9px 14px; border: none; border-radius: 10px;
    background: transparent; color: inherit; font-size: 14px; cursor: pointer;
  }
  .mode-btn.active { background: #fefefe; color: #2c2520; box-shadow: 0 1px 6px rgba(44,37,32,.14); }
  @media (prefers-color-scheme: dark) { .mode-btn.active { background: #3a3228; color: #f5eee3; } }
  .search-run { flex: 1; padding: 11px 12px; font-size: 16px; border-radius: 12px; }
  .scan-row {
    width: 100%; margin-top: 12px; padding: 14px; border-radius: 14px; font-size: 16px;
    background: #5d7a4a; color: #f5f0e8; border: 1px solid transparent;
    box-shadow: 0 6px 18px rgba(93,122,74,.3);
  }
  .scan-row:active { transform: scale(.98); }
  @media (prefers-color-scheme: dark) { .scan-row { background: #6b8a56; color: #f5eee3; } }
  .search-progress { margin-top: 10px; text-align: left; }
  .search-progress-track {
    height: 6px; border-radius: 999px; background: rgba(44,37,32,.1); overflow: hidden;
  }
  @media (prefers-color-scheme: dark) { .search-progress-track { background: rgba(245,238,227,.1); } }
  .search-progress-fill { height: 100%; border-radius: 999px; background: #b8860b; transition: width .3s ease; }
  .search-progress-summary { margin-top: 6px; font-size: 12px; font-weight: 600; opacity: .8; }
  .search-catalogs {
    display: flex; flex-direction: column; gap: 6px; margin-top: 8px;
    max-height: 34vh; overflow-y: auto;
  }
  .search-catalog {
    padding: 8px 10px; border: 1px solid rgba(44,37,32,.12); border-radius: 10px;
    background: rgba(44,37,32,.03);
  }
  @media (prefers-color-scheme: dark) {
    .search-catalog { border-color: rgba(245,238,227,.12); background: rgba(245,238,227,.04); }
  }
  .search-catalog-name {
    display: block; margin-bottom: 5px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 14px; font-weight: 700; overflow-wrap: anywhere;
  }
  .search-catalog-platforms { display: flex; flex-wrap: wrap; gap: 5px; }
  .search-chip {
    display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 999px;
    font-size: 10px; background: rgba(44,37,32,.06); opacity: .75;
  }
  @media (prefers-color-scheme: dark) { .search-chip { background: rgba(245,238,227,.07); } }
  .search-chip.complete { background: rgba(93,122,74,.14); color: #5d7a4a; opacity: 1; }
  .search-chip.not_found { opacity: .55; }
  .search-chip.error { background: rgba(166,61,64,.12); color: #a63d40; opacity: 1; }
  .search-chip.challenge { background: rgba(184,134,11,.16); color: #9a7209; opacity: 1; }
  @media (prefers-color-scheme: dark) { .search-chip.challenge { color: #f0ce68; } }
  .status { margin-top: 10px; padding: 10px 12px; border-radius: 12px; font-size: 13px; line-height: 1.6; text-align: center; }
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

  /* ---- post-search flow dialogs (deep dig / smart generation) ---- */
  .flow-dialog {
    position: fixed; inset: 0; z-index: 40;
    display: grid; place-items: center; padding: 20px;
    background: rgba(0,0,0,.45);
    -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
  }
  .flow-dialog[hidden] { display: none; }
  .flow-dialog-card {
    width: 100%; max-width: 380px; padding: 18px 16px;
    background: #fefefe; border: 1px solid rgba(44,37,32,.12); border-radius: 16px;
    box-shadow: 0 16px 48px rgba(0,0,0,.24);
  }
  @media (prefers-color-scheme: dark) {
    .flow-dialog-card { background: #312a22; border-color: rgba(245,238,227,.12); }
  }
  .flow-dialog-title { font-size: 17px; font-weight: 700; margin-bottom: 8px; }
  .flow-dialog-body { font-size: 13px; line-height: 1.7; opacity: .88; overflow-wrap: anywhere; }
  .flow-dialog-hint { margin: 6px 0 0; font-size: 12px; opacity: .7; }
  .flow-dialog-platforms { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .flow-dialog-actions { display: flex; gap: 8px; margin-top: 14px; }
  .flow-dialog-actions button {
    flex: 1; padding: 11px 10px; border-radius: 10px; font-size: 14px;
  }
  .flow-btn-secondary { background: transparent; border: 1px solid rgba(44,37,32,.25); color: inherit; }
  @media (prefers-color-scheme: dark) { .flow-btn-secondary { border-color: rgba(245,238,227,.3); } }
  .flow-btn-primary {
    background: #b8860b; color: #2c2520; border: 1px solid transparent;
  }
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div class="topbar-row">
      <span class="badge"><span class="dot"></span>LAN · 已连接</span>
    </div>
    <nav class="tabs">
      <button id="tab-search" class="tab active" type="button">🔍 搜索</button>
      <button id="tab-publish" class="tab" type="button">📋 发布</button>
    </nav>
  </div>
</header>
<main class="page">
  <section id="panel-search" class="panel">
    <div class="card search-card">
      <h1>远程搜索</h1>
      <p class="intro">与电脑端搜索框同步，由电脑端执行并保存到 CD 库</p>
      <textarea id="search-input" rows="10" placeholder="输入目录号，多个用逗号或换行分隔（最多 10 个）" autocomplete="off" enterkeyhint="done"></textarea>
      <div class="search-controls">
        <div class="mode-switch" role="group" aria-label="搜索模式">
          <button id="mode-standard" class="mode-btn active" type="button">标准</button>
          <button id="mode-deep" class="mode-btn" type="button">深度</button>
        </div>
        <button id="search-run" class="primary search-run" type="button">🔍 搜索</button>
      </div>
      <div id="search-status" class="status" hidden></div>
      <div id="search-progress" class="search-progress" hidden>
        <div class="search-progress-track"><div id="search-progress-fill" class="search-progress-fill"></div></div>
        <div id="search-progress-summary" class="search-progress-summary"></div>
        <div id="search-catalogs" class="search-catalogs"></div>
      </div>
      <button id="scan-btn" class="scan-row" type="button" title="对 CD 条码拍照，自动识别后加入搜索框">📷 扫码添加编号</button>
      <input id="file-input" type="file" accept="image/*" capture="environment" hidden>
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
<div id="flow-dialog" class="flow-dialog" hidden>
  <div class="flow-dialog-card" role="dialog" aria-modal="true" aria-labelledby="flow-dialog-title">
    <div id="flow-dialog-title" class="flow-dialog-title"></div>
    <div id="flow-dialog-body" class="flow-dialog-body"></div>
    <div id="flow-dialog-actions" class="flow-dialog-actions"></div>
  </div>
</div>
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
  var status = byId('status');
  var busy = false;

  /* ---------- tabs ---------- */

  var tabSearch = byId('tab-search');
  var tabPublish = byId('tab-publish');
  var panelSearch = byId('panel-search');
  var panelPublish = byId('panel-publish');
  var activeTab = 'search';

  function switchTab(name) {
    activeTab = name;
    var isSearch = name === 'search';
    tabSearch.classList.toggle('active', isSearch);
    tabPublish.classList.toggle('active', !isSearch);
    panelSearch.hidden = !isSearch;
    panelPublish.hidden = isSearch;
    if (isSearch) pollSearchState();
    else loadPublishList(false);
  }

  tabSearch.addEventListener('click', function () { switchTab('search'); });
  tabPublish.addEventListener('click', function () { switchTab('publish'); });

  /* ---------- search tab: remote control of the desktop search ---------- */

  var searchInput = byId('search-input');
  var searchRun = byId('search-run');
  var searchStatus = byId('search-status');
  var searchProgress = byId('search-progress');
  var searchProgressFill = byId('search-progress-fill');
  var searchProgressSummary = byId('search-progress-summary');
  var searchCatalogs = byId('search-catalogs');
  var modeStandard = byId('mode-standard');
  var modeDeep = byId('mode-deep');

  var flowDialog = byId('flow-dialog');
  var flowDialogTitle = byId('flow-dialog-title');
  var flowDialogBody = byId('flow-dialog-body');
  var flowDialogActions = byId('flow-dialog-actions');
  var flowBusy = false;

  var QUERY_PLATFORM_LABELS = {
    discogs: 'Discogs', ebay: 'eBay', kojima: 'Kojima', hmv: 'HMV',
    yahoo: 'Yahoo', cdjapan: 'CDJapan', tower: 'Tower',
    surugaya: 'Suruga-ya', zenmarket: 'ZenMarket',
    xianyu: '闲鱼', taobao: '淘宝'
  };
  var STATUS_ICONS = { loading: '⏳', complete: '✓', not_found: '−', challenge: '⚠', error: '✗', pending: '○' };

  var searchInputTimer = null;
  var searchPollTimer = null;
  var searchGotState = false;

  function showSearch(kind, html) {
    searchStatus.hidden = false;
    searchStatus.className = 'status ' + kind;
    searchStatus.innerHTML = html;
  }

  function hideSearchStatus() {
    searchStatus.hidden = true;
    searchStatus.className = 'status';
    searchStatus.innerHTML = '';
  }

  function setModeButtons(mode) {
    var isDeep = mode === 'deep';
    modeStandard.classList.toggle('active', !isDeep);
    modeDeep.classList.toggle('active', isDeep);
  }

  function postSearchMode(mode) {
    return fetch('/api/search/mode', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: mode })
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (response.status === 409 && data) data.status = 'unavailable';
        if (!response.ok || !data || data.status !== 'ok') {
          throw new Error((data && data.message) || '模式切换失败，请重试');
        }
      });
    });
  }

  modeStandard.addEventListener('click', function () {
    setModeButtons('standard');
    postSearchMode('standard').catch(function (err) {
      toast(err.message || '模式切换失败，请重试');
    });
  });

  modeDeep.addEventListener('click', function () {
    setModeButtons('deep');
    postSearchMode('deep').catch(function (err) {
      toast(err.message || '模式切换失败，请重试');
    });
  });

  /* ---------- post-search flow dialogs (deep dig / smart generation) ---------- */

  function showFlowDialog(title, bodyHtml, actionsHtml) {
    flowDialogTitle.textContent = title;
    flowDialogBody.innerHTML = bodyHtml;
    flowDialogActions.innerHTML = actionsHtml;
    flowDialog.hidden = false;
  }

  function hideFlowDialog() {
    flowDialog.hidden = true;
    flowDialogTitle.textContent = '';
    flowDialogBody.innerHTML = '';
    flowDialogActions.innerHTML = '';
  }

  function postFlowAction(action) {
    if (flowBusy) return;
    flowBusy = true;
    var buttons = flowDialogActions.querySelectorAll('button');
    buttons.forEach(function (button) { button.disabled = true; });
    fetch('/api/search/flow/' + action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (response.status === 409 && data) data.status = 'unavailable';
        if (!response.ok || !data || data.status !== 'ok') {
          throw new Error((data && data.message) || '操作失败，请重试');
        }
        pollSearchState();
      });
    }).catch(function (err) {
      toast(err.message || '无法连接电脑，请检查手机与电脑是否在同一局域网');
    }).finally(function () {
      flowBusy = false;
    });
  }

  flowDialogActions.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-flow]');
    if (!button) return;
    postFlowAction(button.getAttribute('data-flow'));
  });

  function renderFlowDialog(state) {
    var phase = state.phase;
    if (phase === 'deep-dig-prompt') {
      var platformNames = (state.flowPlatforms || []).map(function (p) {
        return QUERY_PLATFORM_LABELS[p] || p;
      }).join(' / ');
      showFlowDialog(
        '深挖',
        '有 ' + (Number(state.flowCount) || 0) + ' 个编号在标准搜索中未找到结果。深挖将对这些编号追加查询更多平台（' + escapeHtml(platformNames) + '），结果更全但耗时更长。',
        '<button type="button" class="flow-btn-secondary" data-flow="skip">跳过</button>' +
        '<button type="button" class="flow-btn-primary" data-flow="confirm">执行深挖</button>'
      );
    } else if (phase === 'smart-prompt') {
      showFlowDialog(
        '智能生成',
        '检测到 ' + (Number(state.flowCount) || 0) + ' 个编号的详情字段不完整（厂牌 / 格式 / 国家 / 发行日期 / 类型）。智能生成将逐个访问平台商品页并调用已配置的 LLM 补齐缺失字段；多个编号时耗时较长，并会消耗 LLM API 额度。',
        '<button type="button" class="flow-btn-secondary" data-flow="skip">跳过</button>' +
        '<button type="button" class="flow-btn-primary" data-flow="confirm">开始智能生成</button>'
      );
    } else if (phase === 'smart-running') {
      var stageIndex = Number(state.stageIndex) || 0;
      var stageTotal = Number(state.stageTotal) || 0;
      var stageCatalog = state.stageCatalog || '';
      showFlowDialog(
        '智能生成',
        '<span class="spinner"></span>正在智能生成（' + stageIndex + '/' + stageTotal + '）：' + escapeHtml(stageCatalog) + '…',
        ''
      );
    } else if (phase === 'smart-done') {
      var failed = Number(state.flowFailed) || 0;
      var failedHint = failed > 0
        ? '<p class="flow-dialog-hint">' + failed + ' 个编号生成失败</p>'
        : '';
      showFlowDialog(
        '智能生成',
        '<p>✓ 智能生成完成</p>' + failedHint,
        '<button type="button" class="flow-btn-primary" data-flow="close">关闭</button>'
      );
    } else {
      hideFlowDialog();
    }
  }

  function postSearchInput(text) {
    if (searchInputTimer) { clearTimeout(searchInputTimer); searchInputTimer = null; }
    return fetch('/api/search/input', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok || !data || data.status !== 'ok') {
          throw new Error((data && data.message) || '同步失败，请重试');
        }
      });
    });
  }

  // Phone edits are pushed to the desktop search box, debounced while typing.
  searchInput.addEventListener('input', function () {
    if (searchInputTimer) clearTimeout(searchInputTimer);
    searchInputTimer = setTimeout(function () {
      searchInputTimer = null;
      postSearchInput(searchInput.value).catch(function (err) {
        toast(err.message || '同步失败，请重试');
      });
    }, 300);
  });

  searchInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      triggerSearch();
    }
  });

  function triggerSearch() {
    // Flush a pending input sync first so the desktop searches the latest text.
    var flush = searchInputTimer ? postSearchInput(searchInput.value) : Promise.resolve();
    flush.then(function () {
      return fetch('/api/search/run', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (response.status === 409 && data) data.status = 'unavailable';
        if (!response.ok || !data || data.status !== 'ok') {
          throw new Error((data && data.message) || '触发搜索失败，请重试');
        }
        showSearch('loading', '<span class="spinner"></span>已在电脑端开始搜索');
        pollSearchState();
      });
    }).catch(function (err) {
      showSearch('error', err.message || '无法连接电脑，请检查手机与电脑是否在同一局域网');
    });
  }

  searchRun.addEventListener('click', triggerSearch);

  function pollSearchState() {
    if (activeTab !== 'search' || document.hidden) return;
    fetch('/api/search/state', { credentials: 'same-origin' })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (!data || data.status !== 'ok' || !data.state) throw new Error('bad state');
        renderSearchState(data.state);
      })
      .catch(function () {
        if (!searchGotState) {
          showSearch('error', '无法连接电脑，请检查手机与电脑是否在同一局域网');
        }
      });
  }

  function renderSearchState(state) {
    searchGotState = true;
    var busy = !!state.busy;
    searchInput.disabled = busy;
    searchRun.disabled = busy;
    modeStandard.disabled = busy;
    modeDeep.disabled = busy;
    setModeButtons(state.searchMode === 'deep' ? 'deep' : 'standard');

    // Mirror the desktop search box, but never clobber what the user is typing.
    if (document.activeElement !== searchInput && state.input !== searchInput.value) {
      searchInput.value = state.input || '';
    }

    var phase = state.phase || 'idle';
    var showProgress = phase === 'searching' || phase === 'deep-search';
    searchProgress.hidden = !showProgress;
    if (showProgress) {
      var percent = Math.max(0, Math.min(100, Number(state.percent) || 0));
      searchProgressFill.style.width = percent + '%';
      var total = Number(state.total) || 0;
      var completed = Math.min(Number(state.completed) || 0, total);
      var summaryText = '已完成 ' + completed + ' / ' + total + '（' + percent + '%）';
      if (phase === 'deep-search') summaryText = '深度搜索中 · ' + summaryText;
      searchProgressSummary.textContent = summaryText;

      var platformStatus = {};
      (state.progress || []).forEach(function (item) {
        var byCatalog = {};
        (item.platforms || []).forEach(function (p) { byCatalog[p.platform] = p.status; });
        platformStatus[item.catalogNumber] = byCatalog;
      });
      var catalogsHtml = (state.catalogs || []).map(function (catalogNumber) {
        var statuses = platformStatus[catalogNumber] || {};
        var chips = (state.platforms || []).map(function (platform) {
          var chipStatus = statuses[platform] || 'pending';
          var label = QUERY_PLATFORM_LABELS[platform] || platform;
          return '<span class="search-chip ' + chipStatus + '">' + (STATUS_ICONS[chipStatus] || '○') + ' ' + escapeHtml(label) + '</span>';
        }).join('');
        return '<div class="search-catalog"><span class="search-catalog-name">' + escapeHtml(catalogNumber) + '</span>' +
          '<span class="search-catalog-platforms">' + chips + '</span></div>';
      }).join('');
      searchCatalogs.innerHTML = catalogsHtml;
    }

    // Post-search dialogs (deep dig / smart generation) render as an overlay.
    renderFlowDialog(state);

    if (state.error) {
      showSearch('error', escapeHtml(state.error));
    } else if (phase === 'done' && !busy) {
      showSearch('success', '搜索完成，结果已保存到 CD 库<span class="sub">新增 ' + (Number(state.inserted) || 0) + ' 条 · 更新 ' + (Number(state.updated) || 0) + ' 条</span>');
    } else if (phase === 'searching' || phase === 'deep-search') {
      // The progress panel above is the status display for running searches.
      hideSearchStatus();
    }
    // Dialog phases and idle keep whatever status is already shown.
  }

  // Poll the desktop search state machine while the search tab is visible.
  searchPollTimer = setInterval(function () {
    pollSearchState();
  }, 1000);
  pollSearchState();

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
    if (document.hidden) return;
    if (activeTab === 'search') pollSearchState();
    else loadPublishList(false);
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

  /* ---------- scan card: camera barcode recognition ---------- */

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
      show('error', '无法识别条码，请拍清楚一些后重试');
    });
  });
})();`
