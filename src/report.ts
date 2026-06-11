// Self-contained HTML report: all data, styles, and scripts inline.
// Hard rule: zero external requests — no CDNs, no web fonts, no telemetry.

export interface ReportData {
  version: string;
  scope: string;
  root: string;
  generatedAt: string;
  files: number;
  mb: number;
  sessions: number;
  turns: number;
  contextResets: number;
  cost: { total: number; cacheRead: number; cacheWrite: number; output: number; input: number };
  totals: {
    output: number; inputUncached: number; cacheRead: number;
    cacheCreation5m: number; cacheCreation1h: number;
  };
  byModel: { model: string; output: number; cacheRead: number; dollars: number | null }[];
  tools: { name: string; calls: number; addedTokens: number; residencyCost: number }[];
  repeatedReads: { filePath: string; reads: number; wastedTokens: number }[];
  cache: {
    expiryEvents: number; recreationTokens: number; recreationDollars: number;
    avoidableWith1h: number;
    topEvents: { timestamp: string; gapMinutes: number; ttl: string; recreationTokens: number; project: string }[];
  };
  startup: { count: number; median: number; p90: number };
  mcp: { name: string; scope: string; calls: number; dead: boolean }[];
  subagentGroups: { kind: string; id: string; agents: number; output: number; cacheRead: number; cacheWrite: number; date: string }[];
  quickWins: string[];
}

export function renderHtmlReport(data: ReportData): string {
  // </script> inside the JSON would terminate the script block
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>quotaburn — where your Claude Code quota burns</title>
<style>
  :root {
    --bg: #0b0e14; --card: #11151d; --card2: #161b26; --border: #1f2533;
    --text: #e6e9f0; --muted: #8b93a7; --accent: #ff6a3d; --accent2: #ffb03a;
    --green: #4ade80; --red: #f87171;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--bg); color: var(--text);
    font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
    line-height: 1.5; padding: 40px 20px 80px;
  }
  .wrap { max-width: 960px; margin: 0 auto; }
  .mono { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
  header { display: flex; align-items: baseline; gap: 14px; margin-bottom: 8px; flex-wrap: wrap; }
  .logo { font-size: 26px; font-weight: 800; letter-spacing: -0.5px;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .meta { color: var(--muted); font-size: 13px; }
  .hero { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: center;
    background: var(--card); border: 1px solid var(--border); border-radius: 16px;
    padding: 32px; margin: 24px 0; }
  .hero h1 { font-size: 56px; font-weight: 800; letter-spacing: -2px; }
  .hero .sub { color: var(--muted); margin-top: 4px; }
  .legend { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
  .legend .row { display: flex; align-items: center; gap: 8px; }
  .dot { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  .donut { width: 150px; height: 150px; border-radius: 50%; position: relative; flex: none; }
  .donut::after { content: ""; position: absolute; inset: 22%; border-radius: 50%; background: var(--card); }
  .donut-wrap { display: flex; align-items: center; gap: 20px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
  .stat b { display: block; font-size: 22px; font-weight: 700; }
  .stat span { color: var(--muted); font-size: 12px; }
  section { margin: 34px 0; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--accent2);
    margin-bottom: 4px; }
  .hint { color: var(--muted); font-size: 13px; margin-bottom: 14px; }
  .wins { display: grid; gap: 10px; }
  .win { background: var(--card); border: 1px solid var(--border); border-left: 4px solid var(--accent);
    border-radius: 10px; padding: 14px 18px; display: flex; gap: 14px; align-items: baseline;
    opacity: 0; transform: translateY(8px); animation: rise .5s ease forwards; }
  .win:nth-child(2) { animation-delay: .12s } .win:nth-child(3) { animation-delay: .24s }
  .win .n { font-size: 22px; font-weight: 800; color: var(--accent); }
  @keyframes rise { to { opacity: 1; transform: none } }
  .bar-row { display: grid; grid-template-columns: 130px 1fr 230px; gap: 12px; align-items: center;
    padding: 7px 0; font-size: 13.5px; }
  .bar-row .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .track { background: var(--card2); border-radius: 6px; height: 18px; overflow: hidden; }
  .fill { height: 100%; width: 0; border-radius: 6px;
    background: linear-gradient(90deg, var(--accent), var(--accent2));
    transition: width 1s cubic-bezier(.2,.7,.2,1); }
  .bar-row .val { color: var(--muted); text-align: right; font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th { text-align: left; color: var(--muted); font-weight: 500; font-size: 12px;
    text-transform: uppercase; letter-spacing: .8px; padding: 6px 10px; }
  td { padding: 8px 10px; border-top: 1px solid var(--border); }
  td.num, th.num { text-align: right; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 11.5px;
    background: var(--card2); border: 1px solid var(--border); color: var(--muted); }
  .badge.hot { color: var(--red); border-color: rgba(248,113,113,.35); }
  .dead { color: var(--red); }
  .path { color: var(--muted); direction: rtl; text-align: left; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; max-width: 480px; display: inline-block; }
  footer { margin-top: 50px; color: var(--muted); font-size: 12.5px; text-align: center; }
  footer a { color: var(--accent2); text-decoration: none; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 760px) { .hero { grid-template-columns: 1fr } .grid2 { grid-template-columns: 1fr }
    .bar-row { grid-template-columns: 100px 1fr 120px } .bar-row .val .detail { display: none } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">🔥 quotaburn</div>
    <div class="meta" id="meta"></div>
  </header>

  <div class="hero">
    <div>
      <h1 class="mono" id="total">$0</h1>
      <div class="sub" id="heroSub"></div>
      <div class="sub" style="font-size:12px; margin-top:10px">Subscription plans don't bill per token — this is the API-price value of your usage.</div>
    </div>
    <div class="donut-wrap">
      <div class="donut" id="donut"></div>
      <div class="legend" id="legend"></div>
    </div>
  </div>

  <div class="stats" id="stats"></div>

  <section id="winsSection">
    <h2>Top quick wins</h2>
    <div class="hint">Personalized, ranked by what each one actually costs you.</div>
    <div class="wins" id="wins"></div>
  </section>

  <section>
    <h2>Top context eaters</h2>
    <div class="hint">Tokens a tool added × turns they stayed in context. A result is re-sent on every later turn — that's the real bill. <span id="resets"></span></div>
    <div id="bars"></div>
  </section>

  <section>
    <h2>Cache expiry — paid rebuilds after idle</h2>
    <div class="hint" id="cacheSummary"></div>
    <table><thead><tr><th>when</th><th>idle</th><th>ttl</th><th class="num">rebuild cost</th></tr></thead>
    <tbody id="cacheRows"></tbody></table>
  </section>

  <div class="grid2">
    <section>
      <h2>Repeated file reads</h2>
      <div class="hint">Same file, same context window.</div>
      <table><thead><tr><th>×</th><th>file</th><th class="num">wasted</th></tr></thead>
      <tbody id="readRows"></tbody></table>
    </section>
    <section>
      <h2>By model</h2>
      <div class="hint">API-price value per model.</div>
      <table><thead><tr><th>model</th><th class="num">output tok</th><th class="num">$</th></tr></thead>
      <tbody id="modelRows"></tbody></table>
    </section>
  </div>

  <section>
    <h2>Subagents &amp; workflows</h2>
    <div class="hint">What your background agents consumed.</div>
    <table><thead><tr><th>date</th><th>group</th><th class="num">agents</th><th class="num">output</th><th class="num">cache read</th></tr></thead>
    <tbody id="agentRows"></tbody></table>
  </section>

  <section id="mcpSection">
    <h2>MCP servers — configured vs used</h2>
    <div class="hint" id="mcpHint"></div>
    <table id="mcpTable"><thead><tr><th>server</th><th>scope</th><th class="num">calls</th></tr></thead>
    <tbody id="mcpRows"></tbody></table>
  </section>

  <footer>
    Generated locally by <span class="mono">quotaburn</span> <span id="ver"></span> · reads ~/.claude/projects only ·
    zero network · zero telemetry · <a href="https://github.com/TheSeydiCharyyev/quotaburn">github.com/TheSeydiCharyyev/quotaburn</a>
  </footer>
</div>

<script>
const DATA = ${json};

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const usd = (n) => '$' + n.toFixed(2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

$('meta').textContent = DATA.scope + ' · ' + DATA.files + ' files (' + DATA.mb + ' MB) · generated ' + DATA.generatedAt;
$('ver').textContent = 'v' + DATA.version;
$('heroSub').textContent = 'estimated cost at API list prices · ' + DATA.scope;
$('resets').textContent = DATA.contextResets + ' context resets detected.';

// hero count-up
(function () {
  const el = $('total'); const target = DATA.cost.total; const t0 = performance.now();
  function tick(t) {
    const p = Math.min(1, (t - t0) / 1400); const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = usd(target * eased);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

// donut + legend
(function () {
  const c = DATA.cost;
  const parts = [
    ['cache read', c.cacheRead, '#ff6a3d'],
    ['cache write', c.cacheWrite, '#ffb03a'],
    ['output', c.output, '#4ade80'],
    ['input', c.input, '#60a5fa'],
  ];
  let acc = 0; const stops = [];
  for (const [, v, col] of parts) {
    const deg = c.total > 0 ? (v / c.total) * 360 : 0;
    stops.push(col + ' ' + acc + 'deg ' + (acc + deg) + 'deg'); acc += deg;
  }
  $('donut').style.background = 'conic-gradient(' + stops.join(',') + ')';
  $('legend').innerHTML = parts.map(([name, v, col]) =>
    '<div class="row"><span class="dot" style="background:' + col + '"></span>' +
    esc(name) + ' <b class="mono">' + usd(v) + '</b> (' + (c.total > 0 ? Math.round(v / c.total * 100) : 0) + '%)</div>'
  ).join('');
})();

// stat cards
$('stats').innerHTML = [
  [fmt(DATA.sessions), 'sessions'],
  [fmt(DATA.turns), 'assistant turns'],
  [fmt(DATA.totals.cacheRead / 1e6) + 'M', 'cache-read tokens'],
  [fmt(DATA.totals.output / 1e6 * 10) / 10 + 'M', 'output tokens'],
  [fmt(DATA.startup.median), 'startup tax (median tok)'],
].map(([v, l]) => '<div class="stat"><b class="mono">' + v + '</b><span>' + l + '</span></div>').join('');

// quick wins
if (DATA.quickWins.length === 0) $('winsSection').remove();
else $('wins').innerHTML = DATA.quickWins.map((w, i) =>
  '<div class="win"><span class="n">' + (i + 1) + '</span><span>' + esc(w) + '</span></div>').join('');

// context eater bars (animate after layout)
(function () {
  const total = DATA.tools.reduce((s, t) => s + t.residencyCost, 0);
  $('bars').innerHTML = DATA.tools.slice(0, 12).map((t) => {
    const p = total > 0 ? t.residencyCost / total * 100 : 0;
    return '<div class="bar-row"><span class="name" title="' + esc(t.name) + '">' + esc(t.name) + '</span>' +
      '<div class="track"><div class="fill" data-w="' + p + '"></div></div>' +
      '<span class="val mono">' + p.toFixed(1) + '% <span class="detail">· ' + fmt(t.calls) + ' calls · +' + fmt(t.addedTokens) + ' tok</span></span></div>';
  }).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('.fill').forEach((el, i) => {
      setTimeout(() => { el.style.width = el.dataset.w + '%'; }, i * 70);
    });
  }));
})();

// cache expiry
$('cacheSummary').innerHTML = '<b class="mono" style="color:var(--red)">' + usd(DATA.cache.recreationDollars) +
  '</b> across ' + fmt(DATA.cache.expiryEvents) + ' events — every time a session sat idle past the cache TTL and the next turn paid to rebuild it (' +
  fmt(DATA.cache.recreationTokens) + ' tok).';
$('cacheRows').innerHTML = DATA.cache.topEvents.slice(0, 8).map((e) => {
  const gap = e.gapMinutes < 60 ? e.gapMinutes + 'm' : e.gapMinutes < 1440 ? (e.gapMinutes / 60).toFixed(1) + 'h' : (e.gapMinutes / 1440).toFixed(1) + 'd';
  return '<tr><td class="mono">' + esc(e.timestamp.slice(0, 16).replace('T', ' ')) + '</td>' +
    '<td><span class="badge hot">' + gap + '</span></td><td><span class="badge">' + esc(e.ttl) + '</span></td>' +
    '<td class="num mono">' + fmt(e.recreationTokens) + ' tok</td></tr>';
}).join('');

// repeated reads
$('readRows').innerHTML = DATA.repeatedReads.slice(0, 8).map((r) =>
  '<tr><td class="mono">' + r.reads + '×</td><td><span class="path mono">' + esc(r.filePath) + '</span></td>' +
  '<td class="num mono">' + fmt(r.wastedTokens) + '</td></tr>').join('');

// models
$('modelRows').innerHTML = DATA.byModel.map((m) =>
  '<tr><td class="mono">' + esc(m.model) + '</td><td class="num mono">' + fmt(m.output) + '</td>' +
  '<td class="num mono">' + (m.dollars === null ? '—' : usd(m.dollars)) + '</td></tr>').join('');

// subagents
$('agentRows').innerHTML = DATA.subagentGroups.slice(0, 8).map((g) =>
  '<tr><td class="mono">' + esc(g.date) + '</td><td>' + esc(g.kind === 'workflow' ? 'workflow ' + g.id : 'subagents of ' + g.id.slice(0, 8)) + '</td>' +
  '<td class="num mono">' + g.agents + '</td><td class="num mono">' + fmt(g.output) + '</td>' +
  '<td class="num mono">' + fmt(g.cacheRead) + '</td></tr>').join('');

// mcp
if (DATA.mcp.length === 0) {
  $('mcpHint').textContent = 'No MCP servers configured and no mcp__ calls in your logs — nothing to audit.';
  $('mcpTable').remove();
} else {
  $('mcpHint').textContent = 'Servers flagged red are loaded into every session but never called.';
  $('mcpRows').innerHTML = DATA.mcp.map((m) =>
    '<tr><td class="mono' + (m.dead ? ' dead' : '') + '">' + esc(m.name) + (m.dead ? ' — dead weight' : '') + '</td>' +
    '<td>' + esc(m.scope) + '</td><td class="num mono">' + fmt(m.calls) + '</td></tr>').join('');
}
</script>
</body>
</html>`;
}
