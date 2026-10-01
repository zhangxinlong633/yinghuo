/** Built-in relay UI at GET / — Earth :3101 / Mars :3102 (OpenRouter-like green). */
export function buildConsoleHtml(opts: {
  nodeId: string;
  port: number;
  peerUrl: string;
}): string {
  const { nodeId, port, peerUrl } = opts;
  const defaultDst = nodeId === 'Earth' ? 'Mars' : 'Earth';
  const defaultPayload = `Hello from ${nodeId}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>DTN Relay — ${nodeId}</title>
  <script>
    (function () {
      var theme = localStorage.getItem('dtn-console-theme');
      if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);
    })();
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Noto+Sans+SC:wght@400;500;600;700&family=Syne:wght@500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --bg: #f6f3ec;
      --bg-soft: #eee8dc;
      --surface: rgba(255,252,247,0.72);
      --panel: rgba(255,252,247,0.88);
      --border: rgba(42, 58, 46, 0.12);
      --border-soft: rgba(42, 58, 46, 0.07);
      --text: #1c2a22;
      --muted: #5a6d61;
      --faint: #8a9a90;
      --accent: #0f7a4e;
      --accent-2: #0b5c3b;
      --accent-soft: rgba(15, 122, 78, 0.12);
      --accent-hover: #0b5c3b;
      --ok: #0f7a4e;
      --ok-soft: rgba(15, 122, 78, 0.12);
      --warn: #9a6700;
      --danger: #b42318;
      --danger-soft: rgba(180, 35, 24, 0.1);
      --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --sans: "Noto Sans SC", "Syne", ui-sans-serif, system-ui, sans-serif;
      --display: "Syne", "Noto Sans SC", sans-serif;
      --serif: "Instrument Serif", "Noto Serif SC", Georgia, serif;
      --nav-h: 72px;
      --radius: 18px;
      --radius-sm: 10px;
      --shadow: none;
      --nav-bg: rgba(246, 243, 236, 0.7);
      color-scheme: light;
    }
    html[data-theme="dark"] {
      --bg: #0c1410;
      --bg-soft: #14201a;
      --surface: rgba(18, 32, 26, 0.75);
      --panel: rgba(20, 36, 28, 0.9);
      --border: rgba(200, 230, 210, 0.12);
      --border-soft: rgba(200, 230, 210, 0.07);
      --text: #e7f2eb;
      --muted: #9bb5a6;
      --faint: #6f8a7b;
      --accent: #3dcf8e;
      --accent-2: #7aefb4;
      --accent-soft: rgba(61, 207, 142, 0.14);
      --accent-hover: #2fb87a;
      --ok: #3dcf8e;
      --ok-soft: rgba(61, 207, 142, 0.14);
      --warn: #e6b84d;
      --danger: #f07167;
      --danger-soft: rgba(240, 113, 103, 0.14);
      --shadow: none;
      --nav-bg: rgba(12, 20, 16, 0.72);
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; height: 100%;
      background: var(--bg); color: var(--text);
      font-family: var(--sans);
      -webkit-font-smoothing: antialiased;
      letter-spacing: 0.01em;
      font-size: 16.5px;
      font-weight: 400;
    }
    body {
      background:
        radial-gradient(1200px 560px at 12% -20%, rgba(15, 122, 78, 0.16), transparent 58%),
        radial-gradient(900px 480px at 88% 8%, rgba(180, 140, 60, 0.10), transparent 52%),
        radial-gradient(700px 400px at 50% 100%, rgba(15, 122, 78, 0.06), transparent 55%),
        linear-gradient(180deg, #f8f5ee 0%, #f1efe6 100%);
    }
    html[data-theme="dark"] body {
      background:
        radial-gradient(1100px 520px at 10% -18%, rgba(61, 207, 142, 0.14), transparent 55%),
        radial-gradient(800px 420px at 92% 0%, rgba(90, 120, 80, 0.12), transparent 50%),
        linear-gradient(180deg, #0c1410 0%, #101a15 100%);
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code, .mono { font-family: var(--mono); font-size: 0.9em; font-weight: 500; }
    .app {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    .mast {
      flex-shrink: 0;
      background: var(--nav-bg);
      border-bottom: 1px solid var(--border-soft);
      backdrop-filter: blur(18px) saturate(1.2);
      position: sticky; top: 0; z-index: 20;
    }
    .mast-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: 1rem;
      min-height: var(--nav-h);
      padding: 0.65rem clamp(1rem, 3vw, 2rem);
    }
    .mast-left {
      display: flex; align-items: baseline; gap: 0.65rem 0.85rem;
      flex-wrap: wrap;
      justify-self: start;
      min-width: 0;
    }
    .brand {
      font-family: var(--display);
      font-weight: 700;
      font-size: clamp(1.25rem, 2vw, 1.55rem);
      letter-spacing: -0.03em;
      line-height: 1;
      color: var(--text);
      white-space: nowrap;
    }
    .brand .port {
      font-family: var(--serif);
      font-weight: 400;
      font-style: italic;
      font-size: 0.92em;
      color: var(--muted);
      letter-spacing: 0;
      margin-left: 0.15rem;
    }
    .mast-status {
      display: inline-flex; align-items: center; gap: 0.45rem;
      flex-wrap: wrap;
    }
    .status-chip {
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
      padding: 0.2rem 0;
      border-bottom: 1px solid transparent;
    }
    .status-chip.ok { color: var(--ok); border-bottom-color: var(--ok); }
    .status-chip.bad { color: var(--danger); border-bottom-color: var(--danger); }
    .status-chip.muted { color: var(--faint); }
    .mast-uptime {
      font-family: var(--mono);
      font-size: 0.75rem;
      color: var(--faint);
      letter-spacing: 0.02em;
    }
    .nav {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.15rem 1.15rem;
      justify-self: center;
      flex-wrap: wrap;
    }
    .nav-btn {
      display: inline-flex; align-items: center;
      background: transparent; border: none; color: var(--muted);
      padding: 0.35rem 0.1rem 0.45rem;
      border-radius: 0;
      cursor: pointer;
      font-size: 0.95rem;
      font-weight: 600;
      font-family: var(--display);
      letter-spacing: 0.06em;
      white-space: nowrap;
      position: relative;
      transition: color 0.18s ease;
    }
    .nav-btn::after {
      content: "";
      position: absolute; left: 0; right: 0; bottom: 0;
      height: 1px;
      background: var(--accent);
      transform: scaleX(0);
      transform-origin: center;
      transition: transform 0.2s ease;
    }
    .nav-btn:hover { color: var(--text); }
    .nav-btn:hover::after { transform: scaleX(0.35); }
    .nav-btn.active { color: var(--text); }
    .nav-btn.active::after { transform: scaleX(1); }
    html[data-theme="dark"] .nav-btn.active { color: var(--accent-2); }
    .mast-tools {
      display: flex; align-items: center; gap: 0.55rem;
      justify-self: end;
      flex-shrink: 0;
    }
    .peer-link {
      display: inline-flex; align-items: center;
      padding: 0.25rem 0;
      border: none; background: transparent;
      color: var(--text);
      font-family: var(--serif);
      font-style: italic;
      font-weight: 400;
      font-size: 1rem;
      white-space: nowrap;
      border-bottom: 1px solid var(--border);
    }
    .peer-link:hover { border-bottom-color: var(--accent); text-decoration: none; color: var(--accent-2); }
    .lang-switch {
      display: inline-flex;
      gap: 0.35rem;
      border: none;
      background: transparent;
      width: auto;
    }
    .lang-btn, .theme-btn {
      background: transparent; color: var(--faint); border: none; border-radius: 0;
      padding: 0.2rem 0.35rem; font-size: 0.8rem; font-weight: 600;
      font-family: var(--display);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .lang-btn:hover, .theme-btn:hover { color: var(--text); }
    .lang-btn.active, .theme-btn.active {
      color: var(--accent-2);
      background: transparent;
      box-shadow: inset 0 -1px 0 var(--accent);
    }
    .lang-btn.active:hover, .theme-btn.active:hover { color: var(--accent-2); background: transparent; }
    .ghost.refresh-btn {
      border: none;
      background: transparent;
      color: var(--muted);
      font-family: var(--display);
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 0.2rem 0.35rem;
    }
    .ghost.refresh-btn:hover { color: var(--text); background: transparent; }
    .main {
      flex: 1;
      min-height: 0;
      padding: 1.6rem clamp(1.2rem, 3vw, 2.4rem) 2rem;
      overflow: auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .view { display: none; }
    .view.active {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      flex: 1;
      min-height: 0;
    }
    .view-title {
      margin: 0 0 0.15rem;
      font-family: var(--serif);
      font-size: clamp(1.85rem, 3vw, 2.35rem);
      font-weight: 400;
      font-style: italic;
      letter-spacing: -0.02em;
      line-height: 1.15;
      color: var(--text);
    }
    .grid { display: grid; gap: 1rem; }
    .grid.stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid.ops-grid { flex: 1; min-height: 0; align-items: stretch; }
    .grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .card.stretch {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .card.stretch pre, .card.stretch .logbox {
      flex: 1;
      max-height: none;
      min-height: 180px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border-soft);
      border-radius: var(--radius);
      padding: 1.15rem 1.25rem;
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
    }
    .card.stat-card {
      transition: transform 0.2s ease, border-color 0.2s ease;
      border-color: transparent;
      background: linear-gradient(160deg, rgba(255,252,247,0.9), rgba(238,232,220,0.55));
    }
    html[data-theme="dark"] .card.stat-card {
      background: linear-gradient(160deg, rgba(24,40,32,0.9), rgba(18,30,24,0.55));
    }
    .card.stat-card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
    }
    .card h3 {
      margin: 0 0 0.65rem;
      font-family: var(--display);
      font-size: 0.95rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .stat-val {
      font-size: clamp(1.85rem, 2.4vw, 2.35rem);
      font-weight: 700;
      font-family: var(--display);
      line-height: 1.05;
      letter-spacing: -0.04em;
      color: var(--text);
    }
    .stat-label {
      color: var(--muted);
      font-size: 0.88rem;
      margin-top: 0.4rem;
      font-weight: 500;
      letter-spacing: 0.01em;
    }
    .kv { display: grid; grid-template-columns: 8.5rem minmax(0, 1fr); gap: 0.45rem 0.85rem; font-size: 0.98rem; }
    .kv .k { color: var(--faint); font-weight: 500; }
    .kv .v { font-family: var(--mono); word-break: break-all; font-size: 0.94rem; color: var(--text); }
    .badge-open { color: var(--ok); font-weight: 700; }
    .badge-closed { color: var(--danger); font-weight: 700; }
    button, .btn {
      background: var(--accent); color: #fff; border: 1px solid transparent; border-radius: 6px;
      padding: 0.55rem 1.15rem; font-weight: 650; cursor: pointer; font-size: 0.95rem;
      font-family: var(--display);
      letter-spacing: 0.02em;
      transition: background 0.15s, transform 0.08s, box-shadow 0.15s;
    }
    button:hover { background: var(--accent-hover); }
    button:active { transform: scale(0.98); }
    button.secondary {
      background: transparent; color: var(--text);
      border: 1px solid var(--border);
    }
    button.secondary:hover { background: var(--bg-soft); border-color: var(--accent); }
    button.ghost {
      background: transparent; border: 1px solid var(--border); color: var(--muted);
      padding: 0.4rem 0.85rem; border-radius: 6px; font-size: 0.92rem;
    }
    button.ghost:hover { color: var(--text); border-color: var(--accent); }
    button.ghost.refresh-btn {
      border: none;
      background: transparent;
      color: var(--muted);
      font-family: var(--display);
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 0.2rem 0.35rem;
      border-radius: 0;
    }
    button.ghost.refresh-btn:hover { color: var(--text); background: transparent; border: none; }
    input, select, textarea {
      background: var(--surface); color: var(--text);
      border: 1px solid var(--border); border-radius: var(--radius-sm);
      padding: 0.5rem 0.7rem; font-size: 1rem; font-family: var(--sans);
    }
    input:focus, select:focus, textarea:focus {
      outline: none; border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-soft);
    }
    .form-row { display: flex; flex-wrap: wrap; gap: 0.65rem; align-items: flex-end; margin-bottom: 0.7rem; }
    .field { display: flex; flex-direction: column; gap: 0.25rem; }
    .field label { font-size: 0.9rem; color: var(--faint); font-weight: 600; }
    .field input { min-width: 9rem; }
    .field input#payload { min-width: 18rem; flex: 1; }
    pre, .logbox {
      margin: 0; white-space: pre-wrap; word-break: break-word;
      font-family: var(--mono); font-size: 0.92rem; line-height: 1.55;
      max-height: min(52vh, 480px); overflow: auto; color: var(--text);
      background: var(--bg-soft); border: 1px solid var(--border-soft);
      border-radius: var(--radius-sm); padding: 0.75rem 0.85rem;
    }
    .store-depth { display: flex; flex-direction: column; gap: 0.35rem; }
    .depth-bar-wrap {
      height: 6px; background: var(--bg-soft); border-radius: 999px; overflow: hidden;
      border: 1px solid var(--border-soft);
    }
    .depth-bar {
      height: 100%;
      background: var(--accent); border-radius: 999px;
      width: 0%; transition: width 0.35s ease;
    }
    .depth-meta { display: flex; justify-content: space-between; font-size: 0.95rem; }
    .depth-meta .name { color: var(--muted); }
    .depth-meta .count { font-family: var(--mono); font-weight: 650; color: var(--accent); }
    .toast {
      position: fixed; right: 0.85rem; bottom: 0.85rem; z-index: 50;
      background: var(--panel); color: var(--ok);
      border: 1px solid rgba(47,158,110,0.35);
      padding: 0.55rem 0.85rem; border-radius: var(--radius); font-size: 0.88rem;
      opacity: 0; transform: translateY(6px); transition: all 0.2s; pointer-events: none;
      max-width: 340px; font-family: var(--mono);
      box-shadow: var(--shadow);
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.err { color: var(--danger); border-color: rgba(196,92,92,0.4); }
    .hint { color: var(--muted); font-size: 0.95rem; margin: 0.2rem 0 0.75rem; line-height: 1.5; }
    .progress-ring {
      height: 5px; background: var(--bg-soft); border-radius: 999px; overflow: hidden; margin-top: 0.65rem;
      border: 1px solid var(--border-soft);
    }
    .progress-ring > span {
      display: block; height: 100%; background: var(--ok); width: 50%;
      transition: width 0.35s linear, background 0.15s;
    }
    .progress-ring.closed > span { background: var(--danger); }
    table.simple { width: 100%; border-collapse: collapse; font-size: 0.98rem; }
    table.simple th, table.simple td {
      text-align: left; padding: 0.45rem 0.35rem; border-bottom: 1px solid var(--border-soft);
    }
    table.simple th { color: var(--faint); font-weight: 600; font-size: 0.88rem; }
    table.simple td.mono { font-family: var(--mono); }
    tr[data-id] { cursor: pointer; }
    tr[data-id]:hover { background: var(--bg-soft); }
    #bundle-rows tr { cursor: pointer; }
    #bundle-rows tr:hover td { background: var(--bg-soft); }
    .graph-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(220px, 0.7fr);
      gap: 0.85rem;
      min-height: 420px;
    }
    .cn-map-card { min-height: 420px; display: flex; flex-direction: column; }
    #cn-svg {
      width: 100%;
      flex: 1;
      min-height: 360px;
      background: var(--bg-soft);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-soft);
    }
    #cn-svg .edge.direct { stroke: var(--accent); stroke-width: 2.5; }
    #cn-svg .edge.heard { stroke: var(--muted); stroke-width: 2; stroke-dasharray: 7 5; }
    #cn-svg .edge-hit { stroke: transparent; stroke-width: 16; cursor: pointer; }
    #cn-svg .node circle { fill: var(--surface); stroke: var(--accent-2); stroke-width: 2; }
    #cn-svg .node.self circle { fill: var(--accent); stroke: var(--accent-2); }
    #cn-svg .node text { fill: var(--text); font-size: 13px; font-family: var(--sans); font-weight: 650; }
    #cn-svg .edge.selected { stroke: var(--warn); }
    .cn-detail { margin-top: 0.85rem; }
    .cn-detail > summary { cursor: pointer; font-weight: 650; color: var(--muted); }
    .route-cols pre { min-height: 4.5rem; }
    @media (max-width: 1100px) {
      .grid.stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid.three { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 980px) {
      .mast-row {
        grid-template-columns: 1fr;
        justify-items: stretch;
        gap: 0.55rem;
        padding: 0.85rem 1.1rem;
      }
      .mast-left, .nav, .mast-tools { justify-self: stretch; }
      .mast-left { justify-content: space-between; }
      .nav { justify-content: center; gap: 0.85rem; padding: 0.15rem 0; }
      .mast-tools { justify-content: flex-end; flex-wrap: wrap; }
      .grid.two, .graph-layout { grid-template-columns: 1fr; }
      .card.stretch pre, .card.stretch .logbox { max-height: min(52vh, 480px); }
    }
    @media (max-width: 560px) {
      .grid.stats, .grid.three, .graph-layout { grid-template-columns: 1fr; }
      .main { padding: 1rem; }
      .brand .port { display: none; }
      .nav { gap: 0.65rem; }
      .nav-btn { font-size: 0.88rem; letter-spacing: 0.04em; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="mast">
      <div class="mast-row">
        <div class="mast-left">
          <div class="brand">${nodeId}<span class="port"> · :${port}</span></div>
          <div class="mast-status">
            <span class="status-chip muted" id="tb-role">—</span>
            <span class="status-chip bad" id="tb-contact"><span id="tb-contact-text">—</span></span>
            <span class="mast-uptime" id="tb-uptime">—</span>
          </div>
        </div>
        <nav class="nav" aria-label="primary">
          <button type="button" class="nav-btn active" data-view="overview" data-i18n="navOverview">概览</button>
          <button type="button" class="nav-btn" data-view="storage" data-i18n="navStorage">存储</button>
          <button type="button" class="nav-btn" data-view="connections" data-i18n="navConnections">连接</button>
          <button type="button" class="nav-btn" data-view="ops" data-i18n="navOps">操作</button>
          <button type="button" class="nav-btn" data-view="bundles" data-i18n="navBundles">束</button>
          <button type="button" class="nav-btn" data-view="logs" data-i18n="navLogs">日志</button>
        </nav>
        <div class="mast-tools">
          <button type="button" class="ghost refresh-btn" id="btn-refresh" data-i18n="refresh" data-i18n-title="refresh" title="立即刷新">刷新</button>
          <div class="lang-switch" role="group" aria-label="language">
            <button type="button" class="lang-btn active" data-lang="zh">中</button>
            <button type="button" class="lang-btn" data-lang="en">EN</button>
          </div>
          <div class="lang-switch" role="group" aria-label="theme">
            <button type="button" class="theme-btn" data-theme="light" data-i18n="themeLight">浅</button>
            <button type="button" class="theme-btn" data-theme="dark" data-i18n="themeDark">深</button>
          </div>
          <a class="peer-link" href="${peerUrl}/"><span data-i18n="peer">对端 </span>${defaultDst}</a>
        </div>
      </div>
    </header>

    <main class="main">
      <section class="view active" id="view-overview">
        <h2 class="view-title" data-i18n="overviewTitle">概览</h2>
        <div class="grid stats">
          <div class="card stat-card"><div class="stat-val" id="st-bundles">—</div><div class="stat-label" data-i18n="statBundles">报文 · LevelDB</div></div>
          <div class="card stat-card"><div class="stat-val" id="st-custody">—</div><div class="stat-label" data-i18n="statCustody">托管 · 持有</div></div>
          <div class="card stat-card"><div class="stat-val" id="st-index">—</div><div class="stat-label" data-i18n="statIndex">索引 · 键</div></div>
          <div class="card stat-card"><div class="stat-val" id="st-inbox">—</div><div class="stat-label" data-i18n="statInbox">收件箱 · 本地</div></div>
          <div class="card stat-card"><div class="stat-val" id="st-nodes">—</div><div class="stat-label" data-i18n="statNodes">已知节点</div></div>
          <div class="card stat-card"><div class="stat-val" id="st-seeds">—</div><div class="stat-label" data-i18n="statSeeds">种子邻居</div></div>
          <div class="card stat-card"><div class="stat-val" id="st-age">—</div><div class="stat-label" data-i18n="statAge">摘要最大年龄</div></div>
          <div class="card stat-card"><div class="stat-val" id="st-dests">—</div><div class="stat-label" data-i18n="statDests">可试算目的</div></div>
        </div>
        <div id="ov-bundle-counts" class="hint"></div>
        <table class="simple"><tbody id="ov-bundle-recent"></tbody></table>
        <div class="grid two">
          <div class="card">
            <h3 data-i18n="nodeInfo">节点信息</h3>
            <div class="kv">
              <div class="k">nodeId</div><div class="v" id="ov-node">${nodeId}</div>
              <div class="k">role</div><div class="v" id="ov-role">—</div>
              <div class="k">port</div><div class="v">:${port}</div>
              <div class="k">peerUrl</div><div class="v" id="ov-peer">${peerUrl}</div>
              <div class="k">dataDir</div><div class="v" id="ov-datadir">—</div>
              <div class="k">uptime</div><div class="v" id="ov-uptime">—</div>
            </div>
          </div>
          <div class="card">
            <h3 data-i18n="contactWin">接触窗口</h3>
            <div class="kv">
              <div class="k">peer</div><div class="v" id="ov-c-peer">—</div>
              <div class="k">link</div><div class="v" id="ov-c-link">—</div>
              <div class="k">phase</div><div class="v" id="ov-c-phase">—</div>
              <div class="k">delayMs</div><div class="v" id="ov-c-delay">—</div>
              <div class="k">nextChange</div><div class="v" id="ov-c-next">—</div>
            </div>
            <div class="progress-ring" id="ov-c-bar"><span style="width:40%"></span></div>
            <p class="hint" style="margin-top:0.4rem" data-i18n="contactHint">周期开窗时链路可转发；关闭时先存储再转发。</p>
          </div>
        </div>
        <div class="card stretch">
          <h3 data-i18n="recent">最近事件</h3>
          <pre id="ov-events" data-i18n="loading">加载中…</pre>
        </div>
      </section>

      <section class="view" id="view-storage">
        <h2 class="view-title" data-i18n="storageTitle">存储</h2>
        <p class="hint" data-i18n="storageHint">三层存储深度来自 /api/status 的 store（bundles / custody / index）。收发在「操作」页。</p>
        <div class="grid three">
          <div class="card">
            <h3 data-i18n="bundles">报文</h3>
            <div class="store-depth">
              <div class="depth-meta"><span class="name" data-i18n="pendingStored">待发 / 已存</span><span class="count" id="st2-bundles">0</span></div>
              <div class="depth-bar-wrap"><div class="depth-bar" id="bar-bundles"></div></div>
              <p class="hint" data-i18n="bundleHint">应用或转发中的报文</p>
            </div>
          </div>
          <div class="card">
            <h3 data-i18n="custody">托管</h3>
            <div class="store-depth">
              <div class="depth-meta"><span class="name" data-i18n="custodyHeld">托管中</span><span class="count" id="st2-custody">0</span></div>
              <div class="depth-bar-wrap"><div class="depth-bar" id="bar-custody"></div></div>
              <p class="hint" data-i18n="custodyHint">等待确认或接触窗口的托管</p>
            </div>
          </div>
          <div class="card">
            <h3 data-i18n="index">索引</h3>
            <div class="store-depth">
              <div class="depth-meta"><span class="name" data-i18n="indexKeys">索引键</span><span class="count" id="st2-index">0</span></div>
              <div class="depth-bar-wrap"><div class="depth-bar" id="bar-index"></div></div>
              <p class="hint" data-i18n="indexHint">查找索引深度</p>
            </div>
          </div>
        </div>
        <div class="card" style="margin-top:0.85rem">
          <h3 data-i18n="paths">路径</h3>
          <div class="kv">
            <div class="k">dataDir</div><div class="v" id="st-datadir">—</div>
          </div>
        </div>
      </section>

      <section class="view" id="view-connections">
        <h2 class="view-title" data-i18n="connectionsTitle">连接</h2>
        <div class="graph-layout">
          <div class="card cn-map-card">
            <h3 data-i18n="netMap">网络图</h3>
            <svg id="cn-svg" viewBox="0 0 640 420" role="img" aria-label="contact graph"></svg>
          </div>
          <div class="card" id="cn-edge">
            <h3 data-i18n="edgeSide">选中边</h3>
            <p class="hint" data-i18n="edgeHint">点击实线（直连）或虚线（听说）查看窗口、时延、新鲜度和跳数。</p>
            <div class="kv">
              <div class="k" data-i18n="edgeEnds">端点</div><div class="v" id="eg-ends">—</div>
              <div class="k" data-i18n="edgeKind">类型</div><div class="v" id="eg-kind">—</div>
              <div class="k">delayMs</div><div class="v" id="eg-delay">—</div>
              <div class="k">hopCount</div><div class="v" id="eg-hops">—</div>
              <div class="k" data-i18n="edgeAge">新鲜度</div><div class="v" id="eg-age">—</div>
              <div class="k">schedule</div><div class="v" id="eg-sched">—</div>
              <div class="k">periodMs</div><div class="v" id="eg-period">—</div>
              <div class="k">openOffset</div><div class="v" id="eg-offset">—</div>
              <div class="k">openDuration</div><div class="v" id="eg-duration">—</div>
            </div>
          </div>
        </div>
        <details class="card cn-detail">
          <summary data-i18n="linkDetail">链路明细</summary>
        <div class="grid two" style="margin-top:0.85rem">
          <div class="card">
            <h3 data-i18n="peerLink">对等链路</h3>
            <div class="kv">
              <div class="k">peer</div><div class="v" id="cn-peer">—</div>
              <div class="k">peerUrl</div><div class="v" id="cn-url">${peerUrl}</div>
              <div class="k" data-i18n="localEid">本端 EID</div><div class="v" id="cn-local-eid">—</div>
              <div class="k" data-i18n="peerEid">对端 EID</div><div class="v" id="cn-peer-eid">—</div>
              <div class="k" data-i18n="wireFormat">线上格式</div><div class="v" id="cn-wire">—</div>
              <div class="k">status</div><div class="v" id="cn-status">—</div>
              <div class="k">phase</div><div class="v" id="cn-phase">—</div>
              <div class="k">delayMs</div><div class="v" id="cn-delay">—</div>
              <div class="k">bandwidth</div><div class="v" id="cn-bw">—</div>
            </div>
          </div>
          <div class="card">
            <h3 data-i18n="contactPlan">接触计划</h3>
            <div class="kv">
              <div class="k">schedule</div><div class="v" id="cn-sched">—</div>
              <div class="k">periodMs</div><div class="v" id="cn-period">—</div>
              <div class="k">openOffset</div><div class="v" id="cn-offset">—</div>
              <div class="k">openDuration</div><div class="v" id="cn-duration">—</div>
              <div class="k">nextChangeAt</div><div class="v" id="cn-next">—</div>
              <div class="k">endpoints</div><div class="v" id="cn-ends">—</div>
            </div>
            <div class="progress-ring" id="cn-bar"><span></span></div>
          </div>
        </div>
        <div class="card" id="cn-links" style="margin-top:0.85rem"></div>
        <div class="card" style="margin-top:0.85rem">
          <h3 data-i18n="summary">摘要</h3>
          <table class="simple">
            <thead><tr><th data-i18n="field">字段</th><th data-i18n="value">值</th></tr></thead>
            <tbody>
              <tr><td data-i18n="self">本节点</td><td class="mono" id="cn-self">${nodeId}</td></tr>
              <tr><td data-i18n="peerRow">对端</td><td class="mono" id="cn-peer2">—</td></tr>
              <tr><td data-i18n="linkRow">链路</td><td id="cn-link-cell">—</td></tr>
              <tr><td>API</td><td class="mono">/api/contacts · /api/graph</td></tr>
            </tbody>
          </table>
        </div>
        </details>
      </section>

      <section class="view" id="view-ops">
        <h2 class="view-title" data-i18n="opsTitle">操作</h2>
        <p class="hint" data-i18n="opsHint">在本节点发送报文，并查看或取走本地收件箱。</p>
        <div class="grid two ops-grid">
          <div class="card stretch">
            <h3 data-i18n="sendTitle">发送</h3>
            <p class="hint" data-i18n="sendHint">经本节点 /api/send 注入；接触关闭时先存储，开窗后转发到对端。</p>
            <div class="form-row">
              <div class="field">
                <label for="dst" data-i18n="dst">目的地</label>
                <select id="dst"><option value="${defaultDst}">${defaultDst}</option></select>
              </div>
              <div class="field">
                <label for="ttl" data-i18n="ttl">存活时间（毫秒，可选）</label>
                <input id="ttl" type="number" placeholder="120000" style="min-width:7rem"/>
              </div>
            </div>
            <div class="field" style="margin-bottom:0.7rem">
              <label for="payload" data-i18n="payload">载荷</label>
              <input id="payload" value="${defaultPayload}" style="width:100%"/>
            </div>
            <button type="button" id="btn-send" data-i18n="send">发送</button>
            <h3 style="margin-top:0.85rem" data-i18n="response">响应</h3>
            <pre id="send-out">—</pre>
            <button type="button" class="secondary" id="btn-open-bundle" hidden style="margin-top:0.6rem"></button>
          </div>
          <div class="card stretch">
            <h3 data-i18n="inboxTitle">本地投递收件箱</h3>
            <p class="hint" data-i18n="recvHint">查看不取出；接收会清空本地收件箱。</p>
            <div class="form-row">
              <button type="button" id="btn-inbox-peek" class="secondary" data-i18n="peek">查看收件箱</button>
              <button type="button" id="btn-inbox-recv" data-i18n="recv">接收并清空</button>
              <span class="hint" style="margin:0"><span data-i18n="depthNow">当前深度</span> <code id="st2-inbox">0</code></span>
            </div>
            <pre id="inbox-out">[]</pre>
          </div>
        </div>
        <div class="card" id="route-strip">
          <h3 data-i18n="routeTitle">选路</h3>
          <p class="hint" data-i18n="routeHint">对试算目的或当前打开的束调用 /api/graph/route，对照被裁掉、时延候选和下一跳。</p>
          <div class="form-row">
            <div class="field">
              <label for="route-dst" data-i18n="trialDst">试算目的</label>
              <select id="route-dst"><option value="${defaultDst}">${defaultDst}</option></select>
            </div>
            <label class="hint" style="display:flex;align-items:center;gap:0.4rem;margin:0">
              <input type="checkbox" id="route-follow" checked/>
              <span data-i18n="followBundle">跟随当前束</span>
            </label>
          </div>
          <div class="grid three route-cols">
            <div>
              <div class="k" data-i18n="routeCulled">被裁掉</div>
              <pre id="route-culled">—</pre>
            </div>
            <div>
              <div class="k" data-i18n="routeCandidates">时延排序</div>
              <pre id="route-candidates">—</pre>
            </div>
            <div>
              <div class="k" data-i18n="routeNext">下一跳</div>
              <pre id="route-next">—</pre>
            </div>
          </div>
        </div>
      </section>

      <section class="view" id="view-bundles">
        <h2 class="view-title" data-i18n="bundlesTitle">束</h2>
        <table class="simple" id="bundle-table">
          <thead>
            <tr>
              <th data-i18n="colId">id</th>
              <th data-i18n="colSrc">源</th>
              <th data-i18n="colDst">目的</th>
              <th data-i18n="colState">状态</th>
              <th data-i18n="colWhere">当前节点</th>
              <th data-i18n="colUpdated">更新时间</th>
            </tr>
          </thead>
          <tbody id="bundle-rows"></tbody>
        </table>
        <div class="grid two" id="bundle-detail" hidden>
          <div class="card">
            <h3 id="bd-title">—</h3>
            <pre id="bd-meta">—</pre>
          </div>
          <div class="card stretch">
            <h3 data-i18n="timeline">时间线</h3>
            <pre id="bd-events">—</pre>
          </div>
        </div>
      </section>

      <section class="view" id="view-logs">
        <h2 class="view-title" data-i18n="logsTitle">日志</h2>
        <p class="hint" data-i18n="logsHint">来自 /api/status 的 recentEvents，大约每秒刷新。</p>
        <div class="card stretch">
          <div class="form-row">
            <button type="button" class="secondary" id="btn-clear-logview" data-i18n="clear">清空视图</button>
            <span class="hint" style="margin:0" id="log-count">0 条事件</span>
          </div>
          <pre id="log-out" data-i18n="loading">加载中…</pre>
        </div>
      </section>
    </main>
  </div>
  <div class="toast" id="toast"></div>

<script>
(function () {
  const $ = (id) => document.getElementById(id);
  let lastStatus = null;
  let lastBundles = [];
  let lastLinks = null;
  let lastGraph = null;
  let selectedEdge = null;
  let eidByNode = {};
  let openBundleId = null;
  const DEFAULT_DST = '${defaultDst}';
  let logClearedAt = 0;
  let lang = localStorage.getItem('dtn-console-lang') === 'en' ? 'en' : 'zh';
  let theme = localStorage.getItem('dtn-console-theme') === 'dark' ? 'dark' : 'light';
  const I18N = {
    zh: {
      navOverview: '概览', navStorage: '存储', navConnections: '连接', navOps: '操作', navBundles: '束', navLogs: '日志',
      peer: '对端 ', nodeLabel: '节点', role: '角色', uptime: '',
      themeLight: '浅', themeDark: '深', refresh: '刷新',
      overviewTitle: '概览', statBundles: '报文 · LevelDB', statCustody: '托管 · 持有', statIndex: '索引 · 键', statInbox: '收件箱 · 本地',
      statNodes: '已知节点', statSeeds: '种子邻居', statAge: '摘要最大年龄', statDests: '可试算目的',
      nodeInfo: '节点信息', contactWin: '接触窗口', contactHint: '周期开窗时链路可转发；关闭时先存储再转发。',
      recent: '最近事件', storageTitle: '存储',
      storageHint: '三层存储深度来自 /api/status 的 store（bundles / custody / index）。收发在「操作」页。',
      bundles: '报文', pendingStored: '待发 / 已存', bundleHint: '应用或转发中的报文',
      custody: '托管', custodyHeld: '托管中', custodyHint: '等待确认或接触窗口的托管',
      index: '索引', indexKeys: '索引键', indexHint: '查找索引深度',
      inboxTitle: '本地投递收件箱', peek: '查看收件箱', recv: '接收并清空', depthNow: '当前深度', paths: '路径',
      connectionsTitle: '连接', peerLink: '对等链路', contactPlan: '接触计划', summary: '摘要',
      netMap: '网络图', edgeSide: '选中边', edgeHint: '点击实线（直连）或虚线（听说）查看窗口、时延、新鲜度和跳数。',
      edgeEnds: '端点', edgeKind: '类型', edgeAge: '新鲜度', linkDetail: '链路明细',
      kindDirect: '直连', kindHeard: '听说',
      field: '字段', value: '值', self: '本节点', peerRow: '对端', linkRow: '链路',
      localEid: '本端 EID', peerEid: '对端 EID', wireFormat: '线上格式',
      opsTitle: '操作', opsHint: '在本节点发送报文，并查看或取走本地收件箱。',
      sendTitle: '发送', sendHint: '经本节点 /api/send 注入；接触关闭时先存储，开窗后转发到对端。',
      recvHint: '查看不取出；接收会清空本地收件箱。',
      dst: '目的地', payload: '载荷', ttl: '存活时间（毫秒，可选）', send: '发送', response: '响应',
      routeTitle: '选路', routeHint: '对试算目的或当前打开的束调用 /api/graph/route，对照被裁掉、时延候选和下一跳。',
      trialDst: '试算目的', followBundle: '跟随当前束', routeCulled: '被裁掉', routeCandidates: '时延排序', routeNext: '下一跳',
      logsTitle: '日志', logsHint: '来自 /api/status 的 recentEvents，大约每秒刷新。',
      clear: '清空视图', loading: '加载中…', noEvents: '（无事件）', cleared: '（已清空，新事件会显示在这里）',
      eventsWord: '条事件', open: '开启', closed: '关闭',
      bundlesTitle: '束', colId: 'id', colSrc: '源', colDst: '目的', colState: '状态', colWhere: '当前节点', colUpdated: '更新时间',
      timeline: '时间线', notFound: '未找到', openBundle: '查看束', notDirect: '本机不直连',
      upstream: '上游', downstream: '下游',
      primaryVersion: '版本', primarySrcEid: '源 EID', primaryDstEid: '目的 EID',
      primaryLifetime: '生存时间（毫秒）', primaryBytes: '字节长度', primaryHex: '前 32 字节',
      wireLength: '线上长度', deliveredAt: '到达时间',
      kindStored: '已存储', kindWaiting: '等待窗口', kindForward: '转发', kindRetry: '重试',
      kindArrived: '已到达', kindAcked: '已确认', kindExpired: '已过期', kindRoute: '选路',
      stateWaiting: '等待窗口', stateForwarding: '转发中', stateArrived: '已到达', stateAcked: '已确认', stateExpired: '已过期',
      toastStatus: '状态轮询失败：', toastSent: '已发送 ', toastSendFail: '发送失败',
      toastPeek: '已查看收件箱', toastRecv: '已接收并清空', toastRecvOk: '接收成功'
    },
    en: {
      navOverview: 'Overview', navStorage: 'Storage', navConnections: 'Connections', navOps: 'Ops', navBundles: 'Bundles', navLogs: 'Logs',
      peer: 'Peer ', nodeLabel: 'Node', role: 'role', uptime: '',
      themeLight: 'Light', themeDark: 'Dark', refresh: 'Refresh',
      overviewTitle: 'Overview', statBundles: 'Bundles · LevelDB', statCustody: 'Custody · held', statIndex: 'Index · keys', statInbox: 'Inbox · local',
      statNodes: 'Known nodes', statSeeds: 'Seed peers', statAge: 'Summary age', statDests: 'Trial dests',
      nodeInfo: 'Node', contactWin: 'Contact', contactHint: 'Forward while the window is open; store-and-forward while it is closed.',
      recent: 'Recent events', storageTitle: 'Storage',
      storageHint: 'Depths come from /api/status store (bundles / custody / index). Send and receive live on Ops.',
      bundles: 'Bundles', pendingStored: 'pending / stored', bundleHint: 'Bundles in flight or stored',
      custody: 'Custody', custodyHeld: 'custody held', custodyHint: 'Held until ACK or the next contact',
      index: 'Index', indexKeys: 'index keys', indexHint: 'Lookup index depth',
      inboxTitle: 'Local inbox', peek: 'Peek inbox', recv: 'Recv and clear', depthNow: 'Depth', paths: 'Paths',
      connectionsTitle: 'Connections', peerLink: 'Peer link', contactPlan: 'Contact plan', summary: 'Summary',
      netMap: 'Network map', edgeSide: 'Selected edge', edgeHint: 'Click a solid (direct) or dashed (heard) edge for window, delay, freshness, and hops.',
      edgeEnds: 'Ends', edgeKind: 'Kind', edgeAge: 'Freshness', linkDetail: 'Link detail',
      kindDirect: 'direct', kindHeard: 'heard',
      field: 'Field', value: 'Value', self: 'This node', peerRow: 'Peer', linkRow: 'Link',
      localEid: 'Local EID', peerEid: 'Peer EID', wireFormat: 'Wire format',
      opsTitle: 'Ops', opsHint: 'Send from this node, and peek or take the local inbox.',
      sendTitle: 'Send', sendHint: 'Inject via /api/send. Closed contacts store the bundle and forward it when the window opens.',
      recvHint: 'Peek leaves the inbox in place. Recv clears it.',
      dst: 'Destination', payload: 'Payload', ttl: 'TTL ms (optional)', send: 'Send', response: 'Response',
      routeTitle: 'Route', routeHint: 'Trial a destination, or follow the open bundle, via /api/graph/route.',
      trialDst: 'Trial dest', followBundle: 'Follow open bundle', routeCulled: 'Culled', routeCandidates: 'By delay', routeNext: 'Next hop',
      logsTitle: 'Logs', logsHint: 'recentEvents from /api/status, refreshed about once a second.',
      clear: 'Clear view', loading: 'Loading…', noEvents: '(no events)', cleared: '(cleared — new events will appear)',
      eventsWord: 'events', open: 'OPEN', closed: 'CLOSED',
      bundlesTitle: 'Bundles', colId: 'id', colSrc: 'Source', colDst: 'Dest', colState: 'State', colWhere: 'Current node', colUpdated: 'Updated',
      timeline: 'Timeline', notFound: 'Not found', openBundle: 'Open bundle', notDirect: 'not a direct link',
      upstream: 'upstream', downstream: 'downstream',
      primaryVersion: 'Version', primarySrcEid: 'Source EID', primaryDstEid: 'Dest EID',
      primaryLifetime: 'Lifetime (ms)', primaryBytes: 'Byte length', primaryHex: 'First 32 bytes',
      wireLength: 'Wire length', deliveredAt: 'Delivered at',
      kindStored: 'Stored', kindWaiting: 'Waiting', kindForward: 'Forward', kindRetry: 'Retry',
      kindArrived: 'Arrived', kindAcked: 'Acked', kindExpired: 'Expired', kindRoute: 'Route',
      stateWaiting: 'Waiting for window', stateForwarding: 'Forwarding', stateArrived: 'Arrived', stateAcked: 'Acknowledged', stateExpired: 'Expired',
      toastStatus: 'status poll failed: ', toastSent: 'sent ', toastSendFail: 'send failed',
      toastPeek: 'inbox peeked', toastRecv: 'recv cleared', toastRecvOk: 'recv ok'
    }
  };
  function t(key) {
    const pack = I18N[lang] || I18N.zh;
    return pack[key] != null ? pack[key] : key;
  }
  function linkHtml(open) {
    return open
      ? '<span class="badge-open">' + t('open') + '</span>'
      : '<span class="badge-closed">' + t('closed') + '</span>';
  }
  function applyLang() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key && I18N[lang] && I18N[lang][key] != null) el.textContent = I18N[lang][key];
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.title = t(key);
    });
    document.querySelectorAll('.lang-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-lang') === lang);
    });
    if (lastStatus) applyStatus(lastStatus);
    renderBundles(lastBundles);
    if (lastLinks) renderLinks(lastLinks);
    if (openBundleId && $('bundle-detail') && !$('bundle-detail').hidden) void openBundle(openBundleId);
    const openBtn = $('btn-open-bundle');
    if (openBtn && openBtn.dataset.id) openBtn.textContent = t('openBundle') + ' ' + openBtn.dataset.id;
  }
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('.theme-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-theme') === theme);
    });
  }

  function fmtUptime(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return h + 'h ' + m + 'm ' + sec + 's';
    if (m > 0) return m + 'm ' + sec + 's';
    return sec + 's';
  }

  function fmtTime(t) {
    try { return new Date(t).toLocaleTimeString(); } catch (_) { return String(t); }
  }

  function toast(msg, err) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = 'toast'; }, 2800);
  }

  function setContactPill(open, phase) {
    const pill = $('tb-contact');
    const text = $('tb-contact-text');
    pill.className = 'status-chip ' + (open ? 'ok' : 'bad');
    text.textContent = open ? t('open') : t('closed');
    pill.title = phase || '';
  }

  function contactProgress(contact) {
    if (!contact || !contact.schedule) return { pct: 50, open: false };
    const s = contact.schedule;
    const now = Date.now();
    const elapsed = now % s.periodMs;
    const open = !!contact.open;
    let pct;
    if (open) {
      const closeAt = s.openOffsetMs + s.openDurationMs;
      const remain = Math.max(0, closeAt - elapsed);
      pct = Math.max(2, Math.min(100, (remain / s.openDurationMs) * 100));
    } else if (elapsed < s.openOffsetMs) {
      pct = Math.max(2, Math.min(100, (elapsed / s.openOffsetMs) * 100));
    } else {
      const after = elapsed - (s.openOffsetMs + s.openDurationMs);
      const closedTail = s.periodMs - (s.openOffsetMs + s.openDurationMs);
      pct = Math.max(2, Math.min(100, (after / Math.max(1, closedTail)) * 100));
    }
    return { pct, open };
  }

  function applyBar(el, contact) {
    if (!el) return;
    const { pct, open } = contactProgress(contact);
    el.className = 'progress-ring' + (open ? '' : ' closed');
    const span = el.querySelector('span');
    if (span) span.style.width = pct + '%';
  }

  function depthPct(n, maxRef) {
    const m = Math.max(maxRef, 1);
    return Math.min(100, Math.round((n / m) * 100));
  }

  function renderEvents(events, el, since) {
    const list = (events || []).filter((e) => !since || e.t >= since);
    el.textContent = list.length
      ? list.map((e) => fmtTime(e.t) + '  ' + String(e.event).padEnd(10) + '  ' + e.msg).join('\\n')
      : t('noEvents');
    return list.length;
  }

  /** Normalize store counts from /api/status (nested store or flat legacy). */
  function readStore(s) {
    const raw = (s && s.store) ? s.store : s || {};
    return {
      bundles: Number(raw.bundles ?? 0) || 0,
      custody: Number(raw.custody ?? 0) || 0,
      index: Number(raw.index ?? 0) || 0,
      inbox: Number(raw.inbox ?? 0) || 0,
    };
  }

  function applyStatus(s) {
    lastStatus = s;
    const store = readStore(s);
    const contact = s.contact || {};
    const open = !!contact.open;
    $('tb-role').textContent = s.role || '—';
    $('tb-role').className = 'status-chip muted';
    setContactPill(open, contact.phase);
    $('tb-uptime').textContent = fmtUptime(s.uptimeMs);

    $('st-bundles').textContent = String(store.bundles);
    $('st-custody').textContent = String(store.custody);
    $('st-index').textContent = String(store.index);
    $('st-inbox').textContent = String(store.inbox);

    $('ov-node').textContent = s.nodeId;
    $('ov-role').textContent = s.role || '—';
    $('ov-peer').textContent = s.peerUrl || '—';
    $('ov-datadir').textContent = s.dataDir || '—';
    $('ov-uptime').textContent = fmtUptime(s.uptimeMs);
    $('ov-c-peer').textContent = contact.peer || '—';
    $('ov-c-link').innerHTML = linkHtml(open);
    $('ov-c-phase').textContent = contact.phase || '—';
    $('ov-c-delay').textContent = contact.delayMs != null ? String(contact.delayMs) : '—';
    $('ov-c-next').textContent = contact.nextChangeAt
      ? new Date(contact.nextChangeAt).toLocaleString() + ' (' + fmtTime(contact.nextChangeAt) + ')'
      : '—';
    applyBar($('ov-c-bar'), contact);
    renderEvents((s.recentEvents || []).slice(-14), $('ov-events'));

    const maxStore = Math.max(store.bundles, store.custody, store.index, store.inbox, 4);
    $('st2-bundles').textContent = String(store.bundles);
    $('st2-custody').textContent = String(store.custody);
    $('st2-index').textContent = String(store.index);
    $('st2-inbox').textContent = String(store.inbox);
    $('bar-bundles').style.width = depthPct(store.bundles, maxStore) + '%';
    $('bar-custody').style.width = depthPct(store.custody, maxStore) + '%';
    $('bar-index').style.width = depthPct(store.index, maxStore) + '%';
    $('st-datadir').textContent = s.dataDir || '—';

    $('cn-peer').textContent = contact.peer || '—';
    $('cn-peer2').textContent = contact.peer || '—';
    $('cn-url').textContent = s.peerUrl || '—';
    $('cn-status').innerHTML = linkHtml(open);
    $('cn-link-cell').innerHTML = linkHtml(open);
    $('cn-phase').textContent = contact.phase || '—';
    $('cn-delay').textContent = contact.delayMs != null ? String(contact.delayMs) : '—';
    applyBar($('cn-bar'), contact);
    $('cn-next').textContent = contact.nextChangeAt
      ? new Date(contact.nextChangeAt).toLocaleString()
      : '—';

    const n = renderEvents(s.recentEvents || [], $('log-out'), logClearedAt || 0);
    $('log-count').textContent = n + ' ' + t('eventsWord');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  function stateLabel(state) {
    const map = {
      WAITING: 'stateWaiting',
      FORWARDING: 'stateForwarding',
      ARRIVED: 'stateArrived',
      ACKED: 'stateAcked',
      EXPIRED: 'stateExpired',
    };
    return map[state] ? t(map[state]) : (state || '—');
  }

  const NODE_ID = '${nodeId}';
  const HOP_ORDER = ['Earth', 'Relay', 'Mars'];
  let openSeq = 0;

  function kindLabel(kind) {
    const map = {
      STORED: 'kindStored', WAITING: 'kindWaiting', FORWARD: 'kindForward', RETRY: 'kindRetry',
      ARRIVED: 'kindArrived', ACKED: 'kindAcked', EXPIRED: 'kindExpired', ROUTE: 'kindRoute',
    };
    return map[kind] ? t(map[kind]) : (kind || '');
  }

  function hopSide(link) {
    if (link.local) return '';
    const me = HOP_ORDER.indexOf(NODE_ID);
    const ia = HOP_ORDER.indexOf(link.a);
    const ib = HOP_ORDER.indexOf(link.b);
    if (me < 0 || ia < 0 || ib < 0) return t('notDirect');
    if (ia > me && ib > me) return t('downstream') + ' · ' + t('notDirect');
    if (ia < me && ib < me) return t('upstream') + ' · ' + t('notDirect');
    return t('notDirect');
  }

  function bundleRowsHtml(bundles) {
    return (bundles || []).map((b) => {
      const updated = b.updatedAt ? new Date(b.updatedAt).toLocaleString() : '—';
      return '<tr data-id="' + esc(b.id) + '">' +
        '<td class="mono">' + esc(b.id) + '</td>' +
        '<td class="mono">' + esc(b.src) + '</td>' +
        '<td class="mono">' + esc(b.dst) + '</td>' +
        '<td>' + esc(stateLabel(b.state)) + '</td>' +
        '<td class="mono">' + esc(b.custodian) + '</td>' +
        '<td>' + esc(updated) + '</td></tr>';
    }).join('');
  }

  function renderBundles(bundles) {
    const list = bundles || [];
    const counts = { WAITING: 0, FORWARDING: 0, ARRIVED: 0, EXPIRED: 0 };
    list.forEach((b) => { if (counts[b.state] != null) counts[b.state] += 1; });
    $('ov-bundle-counts').textContent = ['WAITING', 'FORWARDING', 'ARRIVED', 'EXPIRED']
      .map((s) => stateLabel(s) + ' ' + counts[s]).join(' · ');
    $('bundle-rows').innerHTML = bundleRowsHtml(list);
    const held = list.filter((b) => b.state === 'WAITING' || b.state === 'FORWARDING' || b.state === 'ARRIVED');
    $('ov-bundle-recent').innerHTML = bundleRowsHtml(held.slice(0, 5));
  }

  function bundleMetaText(bundle) {
    const events = bundle.events || [];
    const updatedAt = bundle.updatedAt
      || (events.length ? events[events.length - 1].t : bundle.createdAt);
    const updated = updatedAt ? new Date(updatedAt).toLocaleString() : '—';
    const lines = [
      t('colState') + ': ' + stateLabel(bundle.state),
      t('colWhere') + ': ' + (bundle.custodian || '—'),
      t('colUpdated') + ': ' + updated,
    ];
    const primary = bundle.primary;
    if (primary) {
      lines.push(
        t('primaryVersion') + ': ' + primary.version,
        t('primarySrcEid') + ': ' + primary.srcEid,
        t('primaryDstEid') + ': ' + primary.dstEid,
        t('primaryLifetime') + ': ' + primary.lifetimeMs,
        t('primaryBytes') + ': ' + primary.byteLength,
        t('primaryHex') + ': ' + primary.hex32
      );
    }
    if (bundle.wireLength != null) lines.push(t('wireLength') + ': ' + bundle.wireLength);
    return lines.join('\\n');
  }

  function inboxText(messages) {
    const list = messages || [];
    if (!list.length) return '[]';
    return list.map((m) => [
      t('colSrc') + ': ' + (m.src || ''),
      t('colDst') + ': ' + (m.dst || ''),
      t('payload') + ': ' + (m.payload || ''),
      t('deliveredAt') + ': ' + (m.deliveredAt != null ? new Date(m.deliveredAt).toLocaleString() : '—'),
    ].join('\\n')).join('\\n\\n');
  }

  function renderLinks(links) {
    const el = $('cn-links');
    if (!el) return;
    const rows = (links || []).map((l) => {
      const label = (l.a || '') + ' ↔ ' + (l.b || '');
      const extra = l.local
        ? linkHtml(!!l.open) + ' <span class="mono">' + esc(l.phase || '—') + '</span>'
        : esc(hopSide(l));
      return '<tr><td class="mono">' + esc(label) + '</td><td>' + extra + '</td></tr>';
    }).join('');
    el.hidden = !rows;
    el.innerHTML = rows
      ? '<table class="simple"><tbody>' + rows + '</tbody></table>'
      : '';
  }

  async function refreshBundles() {
    try {
      const body = await fetch('/api/bundles').then((r) => r.json());
      lastBundles = (body && body.bundles) || [];
      renderBundles(lastBundles);
    } catch (_) { /* ignore */ }
  }

  async function openBundle(id) {
    const seq = ++openSeq;
    openBundleId = id;
    $('bundle-detail').hidden = false;
    $('bd-title').textContent = id;
    try {
      const res = await fetch('/api/bundles/' + encodeURIComponent(id));
      const body = await res.json();
      if (seq !== openSeq) return;
      if (!body.ok) {
        $('bd-meta').textContent = '—';
        $('bd-events').textContent = t('notFound');
        return;
      }
      $('bd-title').textContent = body.bundle.id;
      $('bd-meta').textContent = bundleMetaText(body.bundle);
      const events = body.bundle.events || [];
      const shown = events.filter((e, i) => {
        const prev = events[i - 1];
        return !prev || prev.node !== e.node || prev.kind !== e.kind || prev.msg !== e.msg;
      });
      $('bd-events').textContent = shown
        .map((e) => {
          const line = new Date(e.t).toLocaleTimeString() + '  ' + e.node + '  ' + kindLabel(e.kind);
          return e.msg ? line + '  ' + e.msg : line;
        })
        .join('\\n') || t('noEvents');
    } catch (e) {
      if (seq !== openSeq) return;
      $('bd-meta').textContent = '—';
      $('bd-events').textContent = String(e);
    }
  }

  function showView(view) {
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const el = document.getElementById('view-' + view);
    if (el) el.classList.add('active');
  }

  async function refreshContacts(s) {
    try {
      const c = await fetch('/api/contacts').then((r) => r.json());
      if (!c) return;
      lastLinks = c.links || [];
      renderLinks(lastLinks);
      const sch = c.schedule || (c.contact && c.contact.schedule) || {};
      $('cn-sched').textContent = sch.type || '—';
      $('cn-period').textContent = sch.periodMs != null ? String(sch.periodMs) : '—';
      $('cn-offset').textContent = sch.openOffsetMs != null ? String(sch.openOffsetMs) : '—';
      $('cn-duration').textContent = sch.openDurationMs != null ? String(sch.openDurationMs) : '—';
      const bw = c.contact && c.contact.bandwidthBps;
      $('cn-bw').textContent = bw != null ? bw + ' bps' : '—';
      eidByNode = c.eidByNode || {};
      $('cn-local-eid').textContent = c.localEid || '—';
      const peerName = c.peer || (c.contact && c.contact.peer) || '';
      const eidMap = c.eidByNode || {};
      $('cn-peer-eid').textContent = eidMap[peerName] || '—';
      $('cn-wire').textContent = c.wireFormat || '—';
      if (c.contact) {
        $('cn-ends').textContent = (c.contact.a || '') + ' ↔ ' + (c.contact.b || '');
      }
      if (s && s.contact) {
        s.contact.schedule = sch;
        applyBar($('ov-c-bar'), s.contact);
        applyBar($('cn-bar'), Object.assign({}, s.contact, { schedule: sch, open: c.open }));
      }
    } catch (_) { /* ignore */ }
  }

  function fmtAge(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    if (ms < 1000) return Math.round(ms) + ' ms';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' s';
    return Math.floor(s / 60) + ' m ' + (s % 60) + ' s';
  }

  function edgeKeyOf(e) {
    return (e.a || '') + '|' + (e.b || '');
  }

  function fillSelect(el, ids, prefer) {
    if (!el) return;
    const current = el.value || prefer || '';
    const list = ids.length ? ids : [DEFAULT_DST];
    el.innerHTML = list.map((id) => '<option value="' + esc(id) + '">' + esc(id) + '</option>').join('');
    if (list.indexOf(current) >= 0) el.value = current;
    else if (prefer && list.indexOf(prefer) >= 0) el.value = prefer;
    else el.value = list[0];
  }

  function showEdge(edge) {
    selectedEdge = edge || null;
    if (!edge) return;
    const sch = edge.schedule || {};
    const direct = edge.kind === 'direct' || edge.direct;
    $('eg-ends').textContent = edge.a + ' ↔ ' + edge.b;
    $('eg-kind').textContent = direct ? t('kindDirect') : t('kindHeard');
    $('eg-delay').textContent = edge.delayMs != null ? String(edge.delayMs) : '—';
    $('eg-hops').textContent = edge.hopCount != null ? String(edge.hopCount) : '—';
    $('eg-age').textContent = edge.originatedAt != null ? fmtAge(Math.max(0, Date.now() - edge.originatedAt)) : '—';
    $('eg-sched').textContent = sch.type || '—';
    $('eg-period').textContent = sch.periodMs != null ? String(sch.periodMs) : '—';
    $('eg-offset').textContent = sch.openOffsetMs != null ? String(sch.openOffsetMs) : '—';
    $('eg-duration').textContent = sch.openDurationMs != null ? String(sch.openDurationMs) : '—';
  }

  function renderMap(g) {
    const svg = $('cn-svg');
    if (!svg || !g) return;
    const nodes = g.nodes || [];
    const edges = g.edges || [];
    let minX = 0, maxX = 1, minY = 0, maxY = 1;
    if (nodes.length) {
      minX = Math.min.apply(null, nodes.map((n) => Number(n.x) || 0));
      maxX = Math.max.apply(null, nodes.map((n) => Number(n.x) || 0));
      minY = Math.min.apply(null, nodes.map((n) => Number(n.y) || 0));
      maxY = Math.max.apply(null, nodes.map((n) => Number(n.y) || 0));
    }
    const w = 640, h = 420, pad = 46;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
    const byId = {};
    nodes.forEach((n) => { byId[n.id] = n; });
    function px(n) { return pad + ((Number(n.x) || 0) - minX) * scale; }
    function py(n) { return h - pad - ((Number(n.y) || 0) - minY) * scale; }
    const lines = edges.map((e) => {
      const a = byId[e.a], b = byId[e.b];
      if (!a || !b) return '';
      const key = edgeKeyOf(e);
      const cls = (e.kind === 'direct' || e.direct) ? 'direct' : 'heard';
      const sel = selectedEdge && edgeKeyOf(selectedEdge) === key ? ' selected' : '';
      return '<line class="edge ' + cls + sel + '" x1="' + px(a) + '" y1="' + py(a) + '" x2="' + px(b) + '" y2="' + py(b) + '"/>' +
        '<line class="edge-hit" data-edge="' + esc(key) + '" x1="' + px(a) + '" y1="' + py(a) + '" x2="' + px(b) + '" y2="' + py(b) + '"/>';
    }).join('');
    const dots = nodes.map((n) => {
      const self = n.id === NODE_ID ? ' self' : '';
      const r = n.id === NODE_ID ? 12 : 8;
      return '<g class="node' + self + '" transform="translate(' + px(n) + ',' + py(n) + ')">' +
        '<circle r="' + r + '"/><text y="-16" text-anchor="middle">' + esc(n.id) + '</text></g>';
    }).join('');
    svg.innerHTML = lines + dots;
  }

  function renderOverviewGraph(g) {
    const stats = (g && g.stats) || {};
    const nodes = (g && g.nodes) || [];
    $('st-nodes').textContent = String(stats.nodeCount != null ? stats.nodeCount : nodes.length);
    $('st-seeds').textContent = String(stats.peerCount != null ? stats.peerCount : ((g && g.peers) || []).length);
    $('st-age').textContent = fmtAge(stats.maxEdgeAgeMs || 0);
    $('st-dests').textContent = String(nodes.filter((n) => n.id !== NODE_ID).length);
    const ids = nodes.map((n) => n.id).concat(Object.keys(eidByNode || {}));
    const choices = ids.filter((id, i) => id && id !== NODE_ID && ids.indexOf(id) === i);
    fillSelect($('dst'), choices, DEFAULT_DST);
    fillSelect($('route-dst'), choices, DEFAULT_DST);
  }

  async function refreshGraph() {
    try {
      const g = await fetch('/api/graph').then((r) => r.json());
      if (!g || !Array.isArray(g.nodes)) return;
      lastGraph = g;
      renderMap(g);
      renderOverviewGraph(g);
    } catch (_) { /* static installs still have GraphService */ }
  }

  async function refreshRoute() {
    const follow = $('route-follow') && $('route-follow').checked;
    let dst = $('route-dst') ? $('route-dst').value : '';
    if (follow && openBundleId) {
      const open = (lastBundles || []).find((b) => b.id === openBundleId);
      if (open && open.dst) dst = open.dst;
    }
    if (!dst) return;
    try {
      const res = await fetch('/api/graph/route?dst=' + encodeURIComponent(dst));
      const d = await res.json();
      const culled = d.culled || [];
      const cands = (d.candidates || []).slice().sort((a, b) => (a.costMs || 0) - (b.costMs || 0));
      $('route-culled').textContent = culled.length
        ? culled.map((c) => c.neighbor + '  cost=' + c.costMs + '  closer=' + c.closer).join('\\n')
        : '—';
      $('route-candidates').textContent = cands.length
        ? cands.map((c) => c.neighbor + '  cost=' + c.costMs + '  wait=' + c.waitMs).join('\\n')
        : '—';
      $('route-next').textContent = d.nextHop ? String(d.nextHop) : (d.reason || '—');
    } catch (e) {
      $('route-next').textContent = String(e);
    }
  }

  async function refresh() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const s = await res.json();
      applyStatus(s);
      await refreshContacts(s);
      await refreshGraph();
    } catch (e) {
      toast(t('toastStatus') + (e && e.message ? e.message : e), true);
    }
    await refreshBundles();
    await refreshRoute();
  }

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      showView(btn.getAttribute('data-view'));
    });
  });

  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.addEventListener('click', () => {
      lang = b.getAttribute('data-lang') === 'en' ? 'en' : 'zh';
      localStorage.setItem('dtn-console-lang', lang);
      applyLang();
    });
  });
  document.querySelectorAll('.theme-btn').forEach((b) => {
    b.addEventListener('click', () => {
      theme = b.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      localStorage.setItem('dtn-console-theme', theme);
      applyTheme();
    });
  });
  applyLang();
  applyTheme();

  $('btn-refresh').addEventListener('click', () => { void refresh(); });
  $('cn-svg').addEventListener('click', (ev) => {
    const hit = ev.target.closest ? ev.target.closest('[data-edge]') : null;
    if (!hit || !lastGraph) return;
    const key = hit.getAttribute('data-edge');
    const edge = (lastGraph.edges || []).find((e) => edgeKeyOf(e) === key);
    if (!edge) return;
    showEdge(edge);
    renderMap(lastGraph);
  });
  $('route-dst').addEventListener('change', () => {
    if ($('route-follow')) $('route-follow').checked = false;
    void refreshRoute();
  });
  $('route-follow').addEventListener('change', () => { void refreshRoute(); });
  $('bundle-rows').addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr');
    if (!tr || !tr.dataset.id) return;
    void openBundle(tr.dataset.id);
  });
  $('btn-open-bundle').addEventListener('click', () => {
    const id = $('btn-open-bundle').dataset.id;
    if (!id) return;
    showView('bundles');
    void openBundle(id);
  });

  $('btn-send').addEventListener('click', async () => {
    const dst = $('dst').value;
    const payload = $('payload').value;
    const ttlRaw = $('ttl').value;
    const body = { dst, payload };
    if (ttlRaw) body.ttlMs = Number(ttlRaw);
    try {
      const r = await fetch('/api/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      const openBtn = $('btn-open-bundle');
      if (j.ok && j.id) {
        $('send-out').textContent = [
          'id: ' + j.id,
          'dst: ' + (j.dst || ''),
          'payload: ' + (j.payload || ''),
        ].join('\\n');
        openBtn.hidden = false;
        openBtn.dataset.id = j.id;
        openBtn.textContent = t('openBundle') + ' ' + j.id;
      } else {
        $('send-out').textContent = j.error || t('toastSendFail');
        openBtn.hidden = true;
      }
      toast(j.ok ? t('toastSent') + (j.id || 'ok') : (j.error || t('toastSendFail')), !j.ok);
      void refresh();
    } catch (e) {
      $('send-out').textContent = String(e);
      toast(String(e), true);
    }
  });

  async function doRecv(clear) {
    const url = clear ? '/api/recv' : '/api/inbox';
    const r = await fetch(url).then((x) => x.json());
    const messages = r.messages || [];
    $('inbox-out').textContent = inboxText(messages);
    return r;
  }

  $('btn-inbox-peek').addEventListener('click', async () => {
    try { await doRecv(false); toast(t('toastPeek')); void refresh(); }
    catch (e) { toast(String(e), true); }
  });
  $('btn-inbox-recv').addEventListener('click', async () => {
    try { await doRecv(true); toast(t('toastRecv')); void refresh(); }
    catch (e) { toast(String(e), true); }
  });
  $('btn-clear-logview').addEventListener('click', () => {
    logClearedAt = Date.now();
    $('log-out').textContent = t('cleared');
    $('log-count').textContent = '0 ' + t('eventsWord');
  });

  void refresh();
  setInterval(() => { void refresh(); }, 1000);
})();
</script>
</body>
</html>`;
}
