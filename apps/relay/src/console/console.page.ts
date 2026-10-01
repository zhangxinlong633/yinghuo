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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
  <style>
    :root {
      /* Light green — OpenRouter-like airy surface */
      --bg: #f3faf5;
      --bg-soft: #e8f5ee;
      --surface: #ffffff;
      --panel: #ffffff;
      --border: #d7ebe0;
      --border-soft: #e4f2ea;
      --text: #0f1f16;
      --muted: #4f6a5b;
      --faint: #7d9788;
      --accent: #16a34a;
      --accent-2: #15803d;
      --accent-soft: #dcfce7;
      --accent-hover: #15803d;
      --ok: #15803d;
      --ok-soft: #dcfce7;
      --warn: #a16207;
      --danger: #b91c1c;
      --danger-soft: #fee2e2;
      --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --sans: Inter, ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Noto Sans SC", sans-serif;
      --nav-h: 64px;
      --radius: 16px;
      --radius-sm: 12px;
      --shadow: 0 1px 2px rgba(15,31,22,0.04), 0 8px 24px rgba(15,31,22,0.03);
      --nav-bg: rgba(255,255,255,0.82);
      color-scheme: light;
    }
    html[data-theme="dark"] {
      /* Deep green */
      --bg: #07140e;
      --bg-soft: #0d1f16;
      --surface: #10261b;
      --panel: #122c1f;
      --border: #1f4633;
      --border-soft: #183628;
      --text: #e8f7ee;
      --muted: #9fc4ae;
      --faint: #6f9a80;
      --accent: #22c55e;
      --accent-2: #4ade80;
      --accent-soft: rgba(34,197,94,0.16);
      --accent-hover: #16a34a;
      --ok: #4ade80;
      --ok-soft: rgba(34,197,94,0.18);
      --warn: #fbbf24;
      --danger: #f87171;
      --danger-soft: rgba(248,113,113,0.16);
      --shadow: 0 1px 2px rgba(0,0,0,0.4), 0 12px 32px rgba(0,0,0,0.28);
      --nav-bg: rgba(7,20,14,0.88);
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; height: 100%;
      background: var(--bg); color: var(--text);
      font-family: var(--sans);
      -webkit-font-smoothing: antialiased;
      letter-spacing: -0.01em;
      font-size: 17px;
    }
    body {
      background:
        radial-gradient(900px 420px at 8% -10%, rgba(22,163,74,0.10), transparent 55%),
        radial-gradient(720px 360px at 95% 0%, rgba(74,222,128,0.08), transparent 50%),
        var(--bg);
    }
    html[data-theme="dark"] body {
      background:
        radial-gradient(900px 420px at 8% -10%, rgba(34,197,94,0.12), transparent 55%),
        radial-gradient(720px 360px at 95% 0%, rgba(22,163,74,0.10), transparent 50%),
        var(--bg);
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
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(14px);
      position: sticky; top: 0; z-index: 20;
    }
    .mast-row {
      display: flex; align-items: center; gap: 1rem;
      min-height: 64px;
      padding: 0.45rem 1.25rem;
    }
    .brand {
      display: flex; align-items: center; gap: 0.55rem;
      font-weight: 700; font-size: 1.02rem; letter-spacing: -0.02em;
      white-space: nowrap; color: var(--text);
      flex-shrink: 0;
    }
    .brand .mark {
      width: 30px; height: 30px; border-radius: 9px;
      background: linear-gradient(145deg, var(--accent) 0%, var(--accent-2) 100%);
      flex-shrink: 0;
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    .nav {
      display: flex;
      align-items: center;
      gap: 0.15rem;
      flex: 1;
      min-width: 0;
      overflow-x: auto;
    }
    .nav-btn {
      display: inline-flex; align-items: center; gap: 0.4rem;
      width: auto;
      background: transparent; border: 1px solid transparent; color: var(--muted);
      padding: 0.45rem 0.8rem; border-radius: 999px; cursor: pointer;
      font-size: 0.98rem; font-weight: 600; font-family: var(--sans);
      white-space: nowrap;
      transition: background 0.12s, color 0.12s, border-color 0.12s;
    }
    .nav-btn:hover { background: var(--bg-soft); color: var(--text); }
    .nav-btn.active {
      background: var(--accent-soft); color: var(--accent-2);
      border-color: transparent;
    }
    html[data-theme="dark"] .nav-btn.active {
      background: var(--accent); color: #062012;
      border-color: var(--accent);
    }
    .nav-btn .ico { opacity: 0.9; }
    .mast-tools {
      display: flex; align-items: center; gap: 0.45rem;
      flex-shrink: 0;
    }
    .peer-link {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 0.4rem 0.75rem; border-radius: 999px;
      border: 1px solid var(--border); background: var(--surface);
      color: var(--text); font-weight: 600; font-size: 0.92rem;
      white-space: nowrap;
    }
    .peer-link:hover { background: var(--accent-soft); text-decoration: none; }
    .lang-switch {
      display: inline-flex; border: 1px solid var(--border); border-radius: 999px;
      overflow: hidden; background: var(--surface); width: auto;
    }
    .lang-btn, .theme-btn {
      background: transparent; color: var(--muted); border: none; border-radius: 0;
      padding: 0.35rem 0.65rem; font-size: 0.88rem; font-weight: 650;
    }
    .lang-btn:hover, .theme-btn:hover { background: var(--bg-soft); color: var(--text); }
    .lang-btn.active, .theme-btn.active { background: var(--accent); color: #fff; }
    .lang-btn.active:hover, .theme-btn.active:hover { background: var(--accent-hover); }
    .status-row {
      display: flex; align-items: center; justify-content: space-between;
      gap: 0.75rem; flex-wrap: wrap;
      padding: 0.35rem 1.25rem 0.55rem;
      border-top: 1px solid var(--border-soft);
    }
    .status-left, .status-right {
      display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap;
    }
    .status-row h1 { font-size: 1.05rem; margin: 0; font-weight: 700; color: var(--text); letter-spacing: -0.02em; }
    .status-right { color: var(--muted); font-size: 0.95rem; }
    .pill {
      display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 0.22rem 0.65rem; border-radius: 999px; font-size: 0.86rem; font-weight: 600;
      border: 1px solid var(--border); background: var(--surface);
    }
    .pill.ok { color: var(--ok); border-color: transparent; background: var(--ok-soft); }
    .pill.bad { color: var(--danger); border-color: transparent; background: var(--danger-soft); }
    .pill.muted { color: var(--muted); }
    .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
    .main {
      flex: 1;
      min-height: 0;
      padding: 1.15rem 1.4rem 1.6rem;
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
      margin: 0; font-size: 1.35rem; font-weight: 700;
      letter-spacing: -0.03em;
    }
    .grid { display: grid; gap: 0.85rem; }
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
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.1rem;
      box-shadow: var(--shadow);
    }
    .card.stat-card { transition: border-color 0.15s; }
    .card.stat-card:hover { border-color: var(--accent-2); }
    .card h3 {
      margin: 0 0 0.55rem; font-size: 1.02rem; font-weight: 650;
      color: var(--text); letter-spacing: -0.01em;
    }
    .stat-val {
      font-size: 1.7rem; font-weight: 700; font-family: var(--mono);
      line-height: 1.15; letter-spacing: -0.04em; color: var(--text);
    }
    .stat-label { color: var(--muted); font-size: 0.92rem; margin-top: 0.35rem; font-weight: 500; }
    .kv { display: grid; grid-template-columns: 8.5rem minmax(0, 1fr); gap: 0.45rem 0.85rem; font-size: 0.98rem; }
    .kv .k { color: var(--faint); font-weight: 500; }
    .kv .v { font-family: var(--mono); word-break: break-all; font-size: 0.94rem; color: var(--text); }
    .badge-open { color: var(--ok); font-weight: 700; }
    .badge-closed { color: var(--danger); font-weight: 700; }
    button, .btn {
      background: var(--accent); color: #fff; border: 1px solid transparent; border-radius: 999px;
      padding: 0.48rem 1rem; font-weight: 600; cursor: pointer; font-size: 1rem;
      font-family: var(--sans);
      transition: background 0.12s, transform 0.08s;
    }
    button:hover { background: var(--accent-hover); }
    button:active { transform: scale(0.98); }
    button.secondary {
      background: var(--surface); color: var(--text);
      border: 1px solid var(--border);
    }
    button.secondary:hover { background: var(--bg-soft); }
    button.ghost {
      background: transparent; border: 1px solid var(--border); color: var(--muted);
      padding: 0.35rem 0.65rem; border-radius: 999px; font-size: 1rem;
    }
    button.ghost:hover { color: var(--text); border-color: var(--accent); }
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
    @media (max-width: 1100px) {
      .grid.stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid.three { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 900px) {
      .mast-row { flex-wrap: wrap; }
      .nav { order: 3; flex-basis: 100%; }
      .grid.two { grid-template-columns: 1fr; }
      .card.stretch pre, .card.stretch .logbox { max-height: min(52vh, 480px); }
    }
    @media (max-width: 560px) {
      .grid.stats, .grid.three { grid-template-columns: 1fr; }
      .main { padding: 1rem; }
      .brand span.brand-text { display: none; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="mast">
      <div class="mast-row">
        <div class="brand"><span class="mark"></span><span class="brand-text">${nodeId} · :${port}</span></div>
        <nav class="nav">
          <button type="button" class="nav-btn active" data-view="overview"><span class="ico">◉</span><span data-i18n="navOverview">概览</span></button>
          <button type="button" class="nav-btn" data-view="storage"><span class="ico">▣</span><span data-i18n="navStorage">存储</span></button>
          <button type="button" class="nav-btn" data-view="connections"><span class="ico">⇄</span><span data-i18n="navConnections">连接</span></button>
          <button type="button" class="nav-btn" data-view="ops"><span class="ico">➤</span><span data-i18n="navOps">操作</span></button>
          <button type="button" class="nav-btn" data-view="logs"><span class="ico">≡</span><span data-i18n="navLogs">日志</span></button>
        </nav>
        <div class="mast-tools">
          <div class="lang-switch" role="group" aria-label="language">
            <button type="button" class="lang-btn active" data-lang="zh">中文</button>
            <button type="button" class="lang-btn" data-lang="en">EN</button>
          </div>
          <div class="lang-switch" role="group" aria-label="theme">
            <button type="button" class="theme-btn" data-theme="light" data-i18n="themeLight">浅色</button>
            <button type="button" class="theme-btn" data-theme="dark" data-i18n="themeDark">深色</button>
          </div>
          <a class="peer-link" href="${peerUrl}/"><span data-i18n="peer">对端</span> ${defaultDst}</a>
        </div>
      </div>
      <div class="status-row">
        <div class="status-left">
          <h1><span data-i18n="nodeLabel">节点</span> <code id="tb-node">${nodeId}</code></h1>
          <span class="pill muted" id="tb-role">role=—</span>
          <span class="pill bad" id="tb-contact"><span class="dot"></span><span id="tb-contact-text">—</span></span>
        </div>
        <div class="status-right">
          <span id="tb-uptime">uptime —</span>
          <button type="button" class="ghost" id="btn-refresh" data-i18n-title="refresh" title="立即刷新">↻</button>
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
        </div>
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
        <div class="grid two">
          <div class="card">
            <h3 data-i18n="peerLink">对等链路</h3>
            <div class="kv">
              <div class="k">peer</div><div class="v" id="cn-peer">—</div>
              <div class="k">peerUrl</div><div class="v" id="cn-url">${peerUrl}</div>
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
        <div class="card" style="margin-top:0.85rem">
          <h3 data-i18n="summary">摘要</h3>
          <table class="simple">
            <thead><tr><th data-i18n="field">字段</th><th data-i18n="value">值</th></tr></thead>
            <tbody>
              <tr><td data-i18n="self">本节点</td><td class="mono" id="cn-self">${nodeId}</td></tr>
              <tr><td data-i18n="peerRow">对端</td><td class="mono" id="cn-peer2">—</td></tr>
              <tr><td data-i18n="linkRow">链路</td><td id="cn-link-cell">—</td></tr>
              <tr><td>API</td><td class="mono">/api/contacts · /api/status</td></tr>
            </tbody>
          </table>
        </div>
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
                <input id="dst" value="${defaultDst}"/>
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
  let logClearedAt = 0;
  let lang = localStorage.getItem('dtn-console-lang') === 'en' ? 'en' : 'zh';
  let theme = localStorage.getItem('dtn-console-theme') === 'dark' ? 'dark' : 'light';
  const I18N = {
    zh: {
      navOverview: '概览', navStorage: '存储', navConnections: '连接', navOps: '操作', navLogs: '日志',
      peer: '对端 ', nodeLabel: '节点', role: '角色', uptime: '运行时间',
      overviewTitle: '概览', statBundles: '报文 · LevelDB', statCustody: '托管 · 持有', statIndex: '索引 · 键', statInbox: '收件箱 · 本地',
      nodeInfo: '节点信息', contactWin: '接触窗口', contactHint: '周期开窗时链路可转发；关闭时先存储再转发。',
      recent: '最近事件', storageTitle: '存储',
      storageHint: '三层存储深度来自 /api/status 的 store（bundles / custody / index）。收发在「操作」页。',
      bundles: '报文', pendingStored: '待发 / 已存', bundleHint: '应用或转发中的报文',
      custody: '托管', custodyHeld: '托管中', custodyHint: '等待确认或接触窗口的托管',
      index: '索引', indexKeys: '索引键', indexHint: '查找索引深度',
      inboxTitle: '本地投递收件箱', peek: '查看收件箱', recv: '接收并清空', depthNow: '当前深度', paths: '路径',
      connectionsTitle: '连接', peerLink: '对等链路', contactPlan: '接触计划', summary: '摘要',
      field: '字段', value: '值', self: '本节点', peerRow: '对端', linkRow: '链路',
      opsTitle: '操作', opsHint: '在本节点发送报文，并查看或取走本地收件箱。',
      sendTitle: '发送', sendHint: '经本节点 /api/send 注入；接触关闭时先存储，开窗后转发到对端。',
      recvHint: '查看不取出；接收会清空本地收件箱。',
      dst: '目的地', payload: '载荷', ttl: '存活时间（毫秒，可选）', send: '发送', response: '响应',
      logsTitle: '日志', logsHint: '来自 /api/status 的 recentEvents，大约每秒刷新。',
      clear: '清空视图', loading: '加载中…', noEvents: '（无事件）', cleared: '（已清空，新事件会显示在这里）',
      eventsWord: '条事件', open: '开启', closed: '关闭', refresh: '立即刷新',
      themeLight: '浅色', themeDark: '深色',
      toastStatus: '状态轮询失败：', toastSent: '已发送 ', toastSendFail: '发送失败',
      toastPeek: '已查看收件箱', toastRecv: '已接收并清空', toastRecvOk: '接收成功'
    },
    en: {
      navOverview: 'Overview', navStorage: 'Storage', navConnections: 'Connections', navOps: 'Ops', navLogs: 'Logs',
      peer: 'Peer ', nodeLabel: 'Node', role: 'role', uptime: 'uptime',
      overviewTitle: 'Overview', statBundles: 'Bundles · LevelDB', statCustody: 'Custody · held', statIndex: 'Index · keys', statInbox: 'Inbox · local',
      nodeInfo: 'Node', contactWin: 'Contact', contactHint: 'Forward while the window is open; store-and-forward while it is closed.',
      recent: 'Recent events', storageTitle: 'Storage',
      storageHint: 'Depths come from /api/status store (bundles / custody / index). Send and receive live on Ops.',
      bundles: 'Bundles', pendingStored: 'pending / stored', bundleHint: 'Bundles in flight or stored',
      custody: 'Custody', custodyHeld: 'custody held', custodyHint: 'Held until ACK or the next contact',
      index: 'Index', indexKeys: 'index keys', indexHint: 'Lookup index depth',
      inboxTitle: 'Local inbox', peek: 'Peek inbox', recv: 'Recv and clear', depthNow: 'Depth', paths: 'Paths',
      connectionsTitle: 'Connections', peerLink: 'Peer link', contactPlan: 'Contact plan', summary: 'Summary',
      field: 'Field', value: 'Value', self: 'This node', peerRow: 'Peer', linkRow: 'Link',
      opsTitle: 'Ops', opsHint: 'Send from this node, and peek or take the local inbox.',
      sendTitle: 'Send', sendHint: 'Inject via /api/send. Closed contacts store the bundle and forward it when the window opens.',
      recvHint: 'Peek leaves the inbox in place. Recv clears it.',
      dst: 'Destination', payload: 'Payload', ttl: 'TTL ms (optional)', send: 'Send', response: 'Response',
      logsTitle: 'Logs', logsHint: 'recentEvents from /api/status, refreshed about once a second.',
      clear: 'Clear view', loading: 'Loading…', noEvents: '(no events)', cleared: '(cleared — new events will appear)',
      eventsWord: 'events', open: 'OPEN', closed: 'CLOSED', refresh: 'Refresh now',
      themeLight: 'Light', themeDark: 'Dark',
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
    pill.className = 'pill ' + (open ? 'ok' : 'bad');
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
    $('tb-node').textContent = s.nodeId;
    $('tb-role').textContent = t('role') + '=' + (s.role || '—');
    setContactPill(open, contact.phase);
    $('tb-uptime').textContent = t('uptime') + ' ' + fmtUptime(s.uptimeMs);

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

  async function refreshContacts(s) {
    try {
      const c = await fetch('/api/contacts').then((r) => r.json());
      if (!c) return;
      const sch = c.schedule || (c.contact && c.contact.schedule) || {};
      $('cn-sched').textContent = sch.type || '—';
      $('cn-period').textContent = sch.periodMs != null ? String(sch.periodMs) : '—';
      $('cn-offset').textContent = sch.openOffsetMs != null ? String(sch.openOffsetMs) : '—';
      $('cn-duration').textContent = sch.openDurationMs != null ? String(sch.openDurationMs) : '—';
      const bw = c.contact && c.contact.bandwidthBps;
      $('cn-bw').textContent = bw != null ? bw + ' bps' : '—';
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

  async function refresh() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const s = await res.json();
      applyStatus(s);
      await refreshContacts(s);
    } catch (e) {
      toast(t('toastStatus') + (e && e.message ? e.message : e), true);
    }
  }

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.getAttribute('data-view');
      const el = document.getElementById('view-' + view);
      if (el) el.classList.add('active');
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
      $('send-out').textContent = JSON.stringify(j, null, 2);
      toast(j.ok ? t('toastSent') + (j.bundle && j.bundle.id ? j.bundle.id : 'ok') : (j.error || t('toastSendFail')), !j.ok);
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
    $('inbox-out').textContent = JSON.stringify(messages, null, 2);
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
