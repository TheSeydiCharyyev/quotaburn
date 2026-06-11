// Self-contained HTML report: all data, styles, and scripts inline.
// Hard rule: zero external requests — no CDNs, no web fonts, no telemetry.
//
// Layout is a three-question narrative: what did it cost? → what should I do?
// → where exactly did it go? Default view shows one number per row; every
// breakdown lives behind a <details> toggle. Light theme by default, dark
// theme via the header toggle (persisted) or prefers-color-scheme.

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
  windowDays: number;
  headline: { text: string; strong?: boolean }[];
  fixes: {
    title: string;
    subtitle: string;
    monthlyDollars: number | null;
    mathLine: string;
    detail: string[];
  }[];
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
  subagentOutputShare: number;
  topSessions: { sessionId: string; title: string | null; dollars: number; turns: number }[];
  sessionCount: number;
  mcp: { name: string; scope: string; calls: number; dead: boolean }[];
  subagentGroups: {
    kind: string; id: string; name: string | null; agentDescriptions: string[];
    agents: number; output: number; cacheRead: number; cacheWrite: number; date: string;
  }[];
}

// one source of truth for the dark palette — applied both via the manual
// toggle ([data-theme="dark"]) and via prefers-color-scheme when no choice was saved
const DARK_TOKENS = `
      --bg: #0e1013; --surface: #16191f; --inset: #1c2027;
      --border: #272c35; --border-soft: #222731;
      --text: #e9e7e2; --text-soft: #b8b4ab; --muted: #8a857a; --muted-2: #6e6a61;
      --accent: #ff7a47; --accent-tint: rgba(255, 122, 71, .13);
      --track: #262b34; --ok: #58b58b;`;

export function renderHtmlReport(data: ReportData): string {
  // </script> inside the JSON would terminate the script block
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>quotaburn — where your Claude Code quota burns</title>
<script>try{var t=localStorage.getItem('qb-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
<style>
  :root {
    --bg: #faf9f7; --surface: #ffffff; --inset: #f6f4f0;
    --border: #eae7e0; --border-soft: #f1efe9;
    --text: #26231e; --text-soft: #57534a; --muted: #98927f; --muted-2: #a8a294;
    --accent: #e8590c; --accent-tint: #fbeadd;
    --track: #efece5; --ok: #3d8361;
    --radius: 14px;
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, "Cascadia Code", Consolas, monospace;
  }
  :root[data-theme="dark"] {${DARK_TOKENS}
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {${DARK_TOKENS}
    }
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body {
    background: var(--bg); color: var(--text);
    font-family: var(--sans); font-size: 15px; line-height: 1.55;
    padding: 28px 24px 64px;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 860px; margin: 0 auto; }
  .num { font-variant-numeric: tabular-nums; }
  .mono { font-family: var(--mono); }

  .eyebrow {
    font-size: 11px; font-weight: 600; letter-spacing: .14em;
    text-transform: uppercase; color: var(--muted);
  }
  h2 { font-size: 19px; font-weight: 650; letter-spacing: -0.01em; }
  .helper { font-size: 13px; color: var(--muted); margin-top: 4px; }

  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
  .brand svg { color: var(--accent); flex: none; }
  .head-right { display: flex; align-items: center; gap: 14px; }
  .scope { font-size: 12.5px; color: var(--muted); }
  #themeBtn {
    display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; border-radius: 9px;
    background: none; border: 1px solid var(--border); color: var(--muted);
    cursor: pointer; transition: color .15s ease, border-color .15s ease;
  }
  #themeBtn:hover { color: var(--accent); border-color: var(--accent-tint); }
  #themeBtn .ic-sun { display: none; }
  :root[data-theme="dark"] #themeBtn .ic-sun { display: block; }
  :root[data-theme="dark"] #themeBtn .ic-moon { display: none; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) #themeBtn .ic-sun { display: block; }
    :root:not([data-theme="light"]) #themeBtn .ic-moon { display: none; }
  }

  .hero { padding: 84px 0 68px; }
  .hero .display {
    font-size: clamp(56px, 9vw, 84px); font-weight: 620;
    letter-spacing: -0.035em; line-height: 1.05;
    font-variant-numeric: tabular-nums; margin: 14px 0 10px;
  }
  .hero .context { font-size: 14px; color: var(--muted); }
  .hero .insight {
    margin-top: 36px; padding-left: 18px;
    border-left: 2px solid var(--accent);
    font-size: 17.5px; line-height: 1.6; color: var(--text-soft); max-width: 620px;
  }
  .hero .insight strong { color: var(--text); font-weight: 620; font-variant-numeric: tabular-nums; }
  .hero .disclaimer { margin-top: 22px; font-size: 12.5px; color: var(--muted-2); max-width: 560px; }

  section { margin: 0 0 72px; }
  .section-head { margin-bottom: 20px; }

  details summary { list-style: none; cursor: pointer; }
  details summary::-webkit-details-marker { display: none; }
  summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 10px; }
  .chev { flex: none; color: var(--muted-2); transition: transform .25s ease; }
  details[open] > summary .chev { transform: rotate(180deg); }
  .reveal { animation: reveal .26s ease; }
  @keyframes reveal { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

  .fixes { display: flex; flex-direction: column; gap: 10px; }
  .fix { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .fix > summary { display: flex; align-items: center; gap: 16px; padding: 18px 20px; transition: background .15s ease; }
  .fix > summary:hover { background: var(--inset); }
  .fix-n {
    flex: none; width: 28px; height: 28px; border-radius: 999px;
    background: var(--accent-tint); color: var(--accent);
    font-size: 13px; font-weight: 650;
    display: flex; align-items: center; justify-content: center;
  }
  .fix-main { flex: 1; min-width: 220px; }
  .fix-title { font-size: 15px; font-weight: 600; display: block; }
  .fix-sub { font-size: 13px; color: var(--muted); margin-top: 2px; display: block; }
  .fix-save { text-align: right; flex: none; }
  .fix-save .v { font-size: 16px; font-weight: 650; color: var(--accent); font-variant-numeric: tabular-nums; white-space: nowrap; display: block; }
  .fix-save .l { font-size: 10.5px; color: var(--muted-2); margin-top: 1px; white-space: nowrap; display: block; }
  .fix-body {
    border-top: 1px solid var(--border-soft); background: var(--inset);
    padding: 16px 20px 18px 64px; font-size: 13.5px; color: var(--text-soft);
  }
  .fix-body p { margin-bottom: 8px; max-width: 580px; }
  .fix-body p:last-child { margin-bottom: 0; }
  .math {
    font-family: var(--mono); font-size: 12px; color: var(--muted);
    background: var(--surface); border: 1px solid var(--border-soft);
    border-radius: 8px; padding: 8px 12px; margin: 10px 0;
    overflow-x: auto; white-space: nowrap;
  }

  .ledger { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .ledger > * + * { border-top: 1px solid var(--border-soft); }
  .lrow { display: flex; align-items: center; gap: 16px; padding: 15px 20px; transition: background .15s ease; }
  summary.lrow:hover { background: var(--inset); }
  .lrow-main { flex: 1; min-width: 200px; }
  .lrow-title { font-size: 14.5px; font-weight: 600; display: block; }
  .lrow-verdict { font-size: 13px; color: var(--muted); margin-top: 1px; display: block; }
  .lrow-key { text-align: right; flex: none; }
  .lrow-key .v { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; display: block; }
  .lrow-key .l { font-size: 10.5px; color: var(--muted-2); white-space: nowrap; display: block; }
  .lbody { border-top: 1px solid var(--border-soft); background: var(--inset); padding: 18px 20px 20px; font-size: 13.5px; color: var(--text-soft); }
  .lbody .note { font-size: 12.5px; color: var(--muted); max-width: 620px; }
  .lbody .note + .bars, .lbody .bars + .note, .lbody .note + table, .lbody table + .note, .lbody .math + .note { margin-top: 12px; }
  .lbody .note + .math { margin-top: 12px; }

  .bars { display: flex; flex-direction: column; gap: 11px; }
  .bar { display: grid; grid-template-columns: 170px 1fr 180px; gap: 14px; align-items: center; }
  .bar .b-label { font-size: 13px; color: var(--text-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar .b-val { font-size: 12.5px; color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .bar .b-val b { color: var(--text-soft); font-weight: 600; }
  .track { height: 6px; border-radius: 999px; background: var(--track); overflow: hidden; }
  .fill { height: 100%; width: 0; border-radius: 999px; background: var(--accent); transition: width .7s cubic-bezier(.25,.8,.25,1); }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th {
    text-align: left; font-size: 10.5px; font-weight: 600; letter-spacing: .08em;
    text-transform: uppercase; color: var(--muted-2); padding: 4px 8px 6px;
  }
  td { padding: 7px 8px; border-top: 1px solid var(--border-soft); color: var(--text-soft); font-variant-numeric: tabular-nums; }
  th.r, td.r { text-align: right; }
  td .path {
    font-family: var(--mono); font-size: 12px; color: var(--muted);
    direction: rtl; text-align: left; unicode-bidi: plaintext;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 380px; display: inline-block; vertical-align: bottom;
  }
  .dead { color: var(--accent); }
  .ok { color: var(--ok); }

  footer { text-align: center; font-size: 12px; color: var(--muted-2); padding-top: 8px; }
  footer a { color: var(--muted); text-decoration: none; border-bottom: 1px solid var(--border); }
  footer a:hover { color: var(--accent); border-color: var(--accent-tint); }

  @media (max-width: 760px) {
    body { padding: 20px 16px 48px; }
    .hero { padding: 56px 0 48px; }
    .bar { grid-template-columns: 96px 1fr 80px; }
    .bar .b-val .detail { display: none; }
    .fix-body { padding-left: 20px; }
    .lrow-verdict { display: none; }
    td .path { max-width: 160px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .fill, .chev { transition: none; }
    .reveal { animation: none; }
  }
</style>
</head>
<body>
<div class="wrap">

  <header>
    <div class="brand">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
      </svg>
      quotaburn
    </div>
    <div class="head-right">
      <div class="scope num" id="meta"></div>
      <button id="themeBtn" type="button" aria-label="Toggle dark theme" title="Toggle dark theme">
        <svg class="ic-moon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
        <svg class="ic-sun" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
      </button>
    </div>
  </header>

  <div class="hero">
    <div class="eyebrow">What did my usage cost?</div>
    <div class="display num" id="heroTotal"></div>
    <div class="context num" id="heroContext"></div>
    <p class="insight" id="headline"></p>
    <p class="disclaimer">Subscription plans don't bill per token — this is the API-price value of your
      usage, measured locally from your own logs. Nothing left this machine.</p>
  </div>

  <section id="fixesSection">
    <div class="section-head">
      <h2>What should I do about it?</h2>
      <div class="helper" id="fixesHelper"></div>
    </div>
    <div class="fixes" id="fixes"></div>
  </section>

  <section>
    <div class="section-head">
      <h2>Where exactly did it go?</h2>
      <div class="helper">The full ledger. Every line expands.</div>
    </div>
    <div class="ledger" id="ledger"></div>
  </section>

  <footer id="foot"></footer>

</div>

<script>
const DATA = ${json};

(function () {
  'use strict';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var usd = function (n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); };
  var tokShort = function (n) { return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n); };
  var gap = function (m) { return m < 60 ? m + 'm' : m < 1440 ? (m / 60).toFixed(1) + 'h' : (m / 1440).toFixed(1) + 'd'; };
  var pctOf = function (part, whole) { return whole > 0 ? (part / whole) * 100 : 0; };
  var $ = function (id) { return document.getElementById(id); };

  var CHEV = '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  // ---- theme toggle ----
  $('themeBtn').addEventListener('click', function () {
    var de = document.documentElement;
    var cur = de.getAttribute('data-theme');
    if (cur !== 'dark' && cur !== 'light') {
      cur = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    var next = cur === 'dark' ? 'light' : 'dark';
    de.setAttribute('data-theme', next);
    try { localStorage.setItem('qb-theme', next); } catch (e) {}
  });

  // ---- header / hero ----
  $('meta').textContent = DATA.scope + ' · ' + DATA.files + ' files (' + DATA.mb + ' MB) · ' + DATA.generatedAt;
  $('heroContext').textContent = 'at API list prices · ' + fmt(DATA.sessions) + ' sessions · ' + fmt(DATA.turns) + ' assistant turns';
  $('headline').innerHTML = DATA.headline.map(function (p) {
    return p.strong ? '<strong>' + esc(p.text) + '</strong>' : esc(p.text);
  }).join('');
  $('foot').innerHTML = 'Generated locally by quotaburn v' + esc(DATA.version) +
    ' · reads ~/.claude/projects only · zero network, zero telemetry · ' +
    '<a href="https://github.com/TheSeydiCharyyev/quotaburn">github.com/TheSeydiCharyyev/quotaburn</a>';

  // hero count-up (final value also the no-JS-after-this fallback)
  (function () {
    var el = $('heroTotal');
    var target = DATA.cost.total;
    if (reduced) { el.textContent = usd(target); return; }
    var t0 = null;
    el.textContent = usd(0);
    var tick = function (t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / 1100);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = usd(target * eased);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })();

  // ---- act 2: fixes ----
  if (DATA.fixes.length === 0) {
    $('fixesSection').remove();
  } else {
    $('fixesHelper').textContent = (DATA.fixes.length === 1 ? 'One fix. Open it to see the math.' :
      DATA.fixes.length + ' fixes, biggest first. Open one to see the math.') +
      ' Projections assume your last ' + Math.round(DATA.windowDays) + ' days repeat.';
    $('fixes').innerHTML = DATA.fixes.map(function (f, i) {
      var save = f.monthlyDollars !== null
        ? '<span class="v num">~$' + fmt(f.monthlyDollars) + '/mo</span><span class="l">projected savings</span>'
        : '<span class="v num" style="color:var(--muted)">&mdash;</span><span class="l">habit, not a toggle</span>';
      return '<details class="fix"><summary>' +
        '<span class="fix-n num">' + (i + 1) + '</span>' +
        '<span class="fix-main"><span class="fix-title">' + esc(f.title) + '</span>' +
        '<span class="fix-sub">' + esc(f.subtitle) + '</span></span>' +
        '<span class="fix-save">' + save + '</span>' + CHEV +
        '</summary><div class="fix-body reveal">' +
        '<p>' + esc(f.detail[0] || '') + '</p>' +
        '<div class="math num">' + esc(f.mathLine) + '</div>' +
        (f.detail[1] ? '<p>' + esc(f.detail[1]) + '</p>' : '') +
        '</div></details>';
    }).join('');
  }

  // ---- act 3: ledger ----
  var rowHead = function (title, verdict, keyV, keyL) {
    return '<span class="lrow-main"><span class="lrow-title">' + title + '</span>' +
      '<span class="lrow-verdict">' + verdict + '</span></span>' +
      '<span class="lrow-key"><span class="v num">' + keyV + '</span>' +
      (keyL ? '<span class="l">' + keyL + '</span>' : '') + '</span>';
  };
  var row = function (title, verdict, keyV, keyL, body) {
    return '<details><summary class="lrow">' + rowHead(title, verdict, keyV, keyL) + CHEV +
      '</summary><div class="lbody reveal">' + body + '</div></details>';
  };
  var staticRow = function (title, verdict, keyV, keyL) {
    return '<div class="lrow">' + rowHead(title, verdict, keyV, keyL) +
      '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" style="visibility:hidden"></svg></div>';
  };
  var barRow = function (label, width, val, opacity) {
    return '<div class="bar"><span class="b-label" title="' + esc(label) + '">' + esc(label) + '</span>' +
      '<span class="track"><span class="fill" data-w="' + width.toFixed(1) + '"' +
      (opacity < 1 ? ' style="opacity:' + opacity + '"' : '') + '></span></span>' +
      '<span class="b-val num">' + val + '</span></div>';
  };

  var rows = [];
  var c = DATA.cost;
  var t = DATA.totals;

  // cost split
  (function () {
    var cachePct = Math.round(pctOf(c.cacheRead + c.cacheWrite, c.total));
    var parts = [['Cache read', c.cacheRead], ['Cache write', c.cacheWrite], ['Output', c.output], ['Input (uncached)', c.input]];
    var bars = parts.map(function (p, i) {
      return barRow(p[0], pctOf(p[1], c.total), '<b>' + usd(p[1]) + '</b> · ' + Math.round(pctOf(p[1], c.total)) + '%', [1, .7, .45, .3][i]);
    }).join('');
    var note = (t.cacheRead / 1e9).toFixed(1) + ' billion cache-read tokens were re-sent across your turns, against ' +
      tokShort(t.output) + ' tokens of actual model output. That ratio is normal for agentic coding — ' +
      "it's why idle expiries (below) hurt so much.";
    rows.push(row('Cost split', 'Cache, not output, is your bill — ' + cachePct + '% went to writing and re-reading cache.',
      cachePct + '% cache', '', '<div class="bars">' + bars + '</div><p class="note">' + note + '</p>'));
  })();

  // by model
  (function () {
    var priced = DATA.byModel.filter(function (m) { return m.dollars !== null; })
      .sort(function (a, b) { return b.dollars - a.dollars; });
    if (priced.length === 0) return;
    var top = priced[0];
    var bars = priced.map(function (m, i) {
      return barRow(m.model, pctOf(m.dollars, c.total), '<b>' + usd(m.dollars) + '</b> · ' + Math.round(pctOf(m.dollars, c.total)) + '%',
        Math.max(.3, 1 - i * .27));
    }).join('');
    var unpriced = DATA.byModel.filter(function (m) { return m.dollars === null; });
    var note = unpriced.length > 0
      ? '<p class="note">Excluded (no pricing data): ' + unpriced.map(function (m) { return esc(m.model); }).join(', ') + '.</p>'
      : '';
    rows.push(row('By model', esc(top.model) + ' did the heavy lifting — ' + Math.round(pctOf(top.dollars, c.total)) + '% of total value.',
      usd(top.dollars), esc(top.model), '<div class="bars">' + bars + '</div>' + note));
  })();

  // context eaters
  (function () {
    var totalRes = DATA.tools.reduce(function (s, x) { return s + x.residencyCost; }, 0);
    if (totalRes === 0 || DATA.tools.length === 0) return;
    var topTool = DATA.tools[0];
    var bars = DATA.tools.slice(0, 12).map(function (x) {
      var p = pctOf(x.residencyCost, totalRes);
      return barRow(x.name, p, '<b>' + p.toFixed(1) + '%</b> <span class="detail">· ' + fmt(x.calls) + ' calls</span>', 1);
    }).join('');
    var note = 'Tokens a tool added × turns they stayed in context — a result is re-sent on every later turn; ' +
      "that's the real bill. " + DATA.contextResets + ' context resets detected.';
    rows.push(row('Context eaters', 'What your context window actually carries, turn after turn.',
      esc(topTool.name) + ' · ' + pctOf(topTool.residencyCost, totalRes).toFixed(1) + '%', '',
      '<p class="note">' + note + '</p><div class="bars">' + bars + '</div>'));
  })();

  // top sessions
  (function () {
    var ss = DATA.topSessions;
    if (ss.length === 0) return;
    var top = ss.slice(0, 5);
    var topSum = top.reduce(function (s, x) { return s + x.dollars; }, 0);
    var max = top[0].dollars;
    var bars = top.map(function (x) {
      var name = x.title || x.sessionId.slice(0, 8);
      return barRow(name, max > 0 ? (x.dollars / max) * 100 : 0,
        '<b>' + usd(x.dollars) + '</b> <span class="detail">· ' + fmt(x.turns) + ' turns</span>', 1);
    }).join('');
    var share = Math.round(pctOf(topSum, c.total));
    rows.push(row('Top sessions',
      'Your ' + top.length + ' most expensive sessions carry ' + share + '% of everything you spent.',
      usd(topSum), 'top ' + top.length + ' of ' + DATA.sessionCount,
      '<div class="bars">' + bars + '</div>' +
      '<p class="note">Each session\\'s bill includes its subagents and workflows. Long-lived sessions are also the ones idle-expiry rebuilds hit hardest (see cache economics).</p>'));
  })();

  // cache economics
  (function () {
    var ce = DATA.cache;
    var share = pctOf(ce.recreationDollars, c.total);
    var tbl = ce.topEvents.slice(0, 8).map(function (e) {
      return '<tr><td class="mono">' + esc(e.timestamp.slice(0, 16).replace('T', ' ')) + '</td>' +
        '<td>' + gap(e.gapMinutes) + '</td><td>' + esc(e.ttl) + '</td>' +
        '<td class="r">' + fmt(e.recreationTokens) + ' tok</td></tr>';
    }).join('');
    var avoidNote = ce.avoidableWith1h < ce.recreationTokens / 10
      ? 'Only ' + fmt(ce.avoidableWith1h) + " of those tokens would have been saved by the longer 1h TTL — so the fix isn't a longer TTL, it's not resuming stale sessions."
      : fmt(ce.avoidableWith1h) + ' of those tokens fell in the 5m-to-1h window — a 1h TTL (#46829) would have saved them.';
    rows.push(row('Cache economics',
      'Caching saves you money overall — but ' + fmt(ce.expiryEvents) + ' idle expiries clawed back ' + share.toFixed(1) + '% of all spend.',
      usd(ce.recreationDollars), 'rebuild cost',
      '<p class="note">' + fmt(ce.expiryEvents) + ' times a session sat idle past the cache TTL; the next turn paid to rebuild ' +
      fmt(ce.recreationTokens) + ' tokens of context. ' + avoidNote + '</p>' +
      '<table><thead><tr><th>when</th><th>idle</th><th>ttl</th><th class="r">rebuilt</th></tr></thead><tbody>' + tbl + '</tbody></table>'));
  })();

  // startup tax
  (function () {
    var s = DATA.startup;
    rows.push(row('Startup tax', 'Every session opens ~' + tokShort(s.median) + ' tokens deep before your first word.',
      fmt(s.median) + ' tok', 'median',
      '<p class="note">The first request of a session already carries the system prompt, tool definitions, skills and CLAUDE.md/memory.</p>' +
      '<div class="math num">median ' + fmt(s.median) + ' tok · p90 ' + fmt(s.p90) + ' tok · ' + fmt(s.count) +
      ' sessions ≈ ' + tokShort(s.median * s.count) + ' tok loaded before any work</div>' +
      '<p class="note">The spread between median and p90 is tiny — this cost is structural, not situational. ' +
      'Trimming instructions and unused skills shrinks it for every future session.</p>'));
  })();

  // subagents & workflows
  (function () {
    var g = DATA.subagentGroups;
    if (g.length === 0) {
      rows.push(staticRow('Subagents &amp; workflows', 'No subagent activity in this window.', '0 runs', ''));
      return;
    }
    var agents = g.reduce(function (s, x) { return s + x.agents; }, 0);
    var label = function (x) {
      if (x.name) return (x.kind === 'workflow' ? 'workflow: ' : 'subagents: ') + x.name;
      return x.kind === 'workflow' ? 'workflow ' + x.id : 'subagents of ' + x.id.slice(0, 8);
    };
    var tbl = g.slice(0, 8).map(function (x) {
      var tip = x.agentDescriptions.length > 0 ? ' title="' + esc(x.agentDescriptions.join(' · ')) + '"' : '';
      return '<tr><td class="mono">' + esc(x.date) + '</td><td' + tip + '>' + esc(label(x)) + '</td>' +
        '<td class="r">' + x.agents + '</td><td class="r">' + fmt(x.output) + '</td><td class="r">' + fmt(x.cacheRead) + '</td></tr>';
    }).join('');
    rows.push(row('Subagents &amp; workflows',
      'Background agents produced ' + (DATA.subagentOutputShare * 100).toFixed(1) + '% of all output tokens.',
      agents + ' agents', g.length + ' runs',
      '<table><thead><tr><th>date</th><th>group</th><th class="r">agents</th><th class="r">output</th><th class="r">cache read</th></tr></thead><tbody>' +
      tbl + '</tbody></table>'));
  })();

  // mcp audit
  (function () {
    var m = DATA.mcp;
    if (m.length === 0) {
      rows.push(staticRow('MCP audit', 'No MCP servers configured and none called — zero dead weight in your startup.',
        '<span class="ok">all clear</span>', ''));
      return;
    }
    var dead = m.filter(function (x) { return x.dead; });
    var tbl = m.map(function (x) {
      return '<tr><td class="mono' + (x.dead ? ' dead' : '') + '">' + esc(x.name) + (x.dead ? ' — dead weight' : '') + '</td>' +
        '<td>' + esc(x.scope) + '</td><td class="r">' + fmt(x.calls) + '</td></tr>';
    }).join('');
    rows.push(row('MCP audit',
      dead.length > 0 ? dead.length + ' server(s) load into every session but were never called.'
        : 'Every configured server was actually used.',
      dead.length > 0 ? '<span class="dead">' + dead.length + ' dead</span>' : m.length + ' servers',
      dead.length > 0 ? 'of ' + m.length + ' configured' : '',
      '<table><thead><tr><th>server</th><th>scope</th><th class="r">calls</th></tr></thead><tbody>' + tbl + '</tbody></table>'));
  })();

  // repeated reads
  (function () {
    var rr = DATA.repeatedReads;
    if (rr.length === 0) {
      rows.push(staticRow('Repeated reads', 'No file was read twice into the same context window.', '<span class="ok">none</span>', ''));
      return;
    }
    var wasted = rr.reduce(function (s, x) { return s + x.wastedTokens; }, 0);
    var tbl = rr.slice(0, 8).map(function (x) {
      return '<tr><td><span class="path">' + esc(x.filePath) + '</span></td>' +
        '<td class="r">' + x.reads + '×</td><td class="r">' + fmt(x.wastedTokens) + ' tok</td></tr>';
    }).join('');
    rows.push(row('Repeated reads', 'Files re-read while a full copy was already sitting in context.',
      tokShort(wasted) + ' tok', 'wasted',
      '<table><thead><tr><th>file</th><th class="r">reads</th><th class="r">wasted</th></tr></thead><tbody>' + tbl + '</tbody></table>' +
      '<p class="note">~' + fmt(wasted) + ' tokens wasted across all repeated reads. Run <span class="mono">quotaburn --json</span> for the full list.</p>'));
  })();

  $('ledger').innerHTML = rows.join('');

  // ---- thin bars animate the first time their panel opens ----
  var all = document.querySelectorAll('details');
  for (var i = 0; i < all.length; i++) {
    all[i].addEventListener('toggle', function () {
      if (!this.open) return;
      var fills = this.querySelectorAll('.fill[data-w]');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          for (var j = 0; j < fills.length; j++) {
            fills[j].style.transitionDelay = reduced ? '0ms' : (j * 40) + 'ms';
            fills[j].style.width = fills[j].getAttribute('data-w') + '%';
          }
        });
      });
    });
  }
})();
</script>
</body>
</html>`;
}
