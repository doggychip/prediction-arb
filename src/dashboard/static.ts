export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>prediction-arb dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
  h1 { color: #58a6ff; margin-bottom: 8px; font-size: 1.4em; }
  h2 { color: #8b949e; font-size: 1.1em; margin: 20px 0 10px; border-bottom: 1px solid #21262d; padding-bottom: 6px; }
  .stats { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px 20px; min-width: 140px; }
  .stat .label { color: #8b949e; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat .value { color: #f0f6fc; font-size: 1.5em; font-weight: 600; margin-top: 4px; }
  .stat .value.green { color: #3fb950; }
  .stat .value.yellow { color: #d29922; }
  table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; margin-bottom: 20px; font-size: 0.85em; }
  th { background: #21262d; color: #8b949e; text-align: left; padding: 8px 12px; font-weight: 500; text-transform: uppercase; font-size: 0.75em; letter-spacing: 0.5px; }
  td { padding: 8px 12px; border-top: 1px solid #21262d; }
  tr:hover td { background: #1c2128; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75em; font-weight: 500; }
  .badge.approved { background: #238636; color: #fff; }
  .badge.pending_review { background: #9e6a03; color: #fff; }
  .badge.llm { background: #1f6feb; color: #fff; }
  .badge.string_similarity { background: #30363d; color: #c9d1d9; }
  .spread-positive { color: #3fb950; font-weight: 600; }
  .spread-negative { color: #f85149; }
  .refresh-note { color: #484f58; font-size: 0.75em; margin-top: 4px; }
  .chart-bar { display: inline-block; height: 14px; background: #238636; border-radius: 2px; min-width: 2px; vertical-align: middle; }
  #error { color: #f85149; display: none; padding: 10px; background: #2d1214; border-radius: 6px; margin-bottom: 16px; }
  .tabs { display: flex; gap: 4px; margin-bottom: 16px; }
  .tab { padding: 6px 16px; background: #21262d; border: 1px solid #30363d; border-radius: 6px; cursor: pointer; color: #8b949e; font-size: 0.85em; }
  .tab.active { background: #1f6feb; color: #fff; border-color: #1f6feb; }
  .hidden { display: none; }
</style>
</head>
<body>
<h1>prediction-arb</h1>
<p class="refresh-note">Auto-refreshes every 10s</p>
<div id="error"></div>

<div class="stats" id="stats"></div>

<div class="tabs">
  <div class="tab active" onclick="showTab('pairs')">Pairs</div>
  <div class="tab" onclick="showTab('opps')">Opportunities</div>
  <div class="tab" onclick="showTab('summary')">Summary</div>
</div>

<div id="tab-pairs"><h2>Tracked Market Pairs</h2><table id="pairs-table"><thead><tr><th>Kalshi</th><th>Polymarket</th><th>Confidence</th><th>Method</th><th>Status</th><th>Bid/Ask</th></tr></thead><tbody></tbody></table></div>
<div id="tab-opps" class="hidden"><h2>Recent Opportunities</h2><table id="opps-table"><thead><tr><th>Time</th><th>Kalshi</th><th>Polymarket</th><th>Strategy</th><th>Gross</th><th>Fees</th><th>Net</th><th>Depth</th></tr></thead><tbody></tbody></table></div>
<div id="tab-summary" class="hidden"><h2>Daily Opportunities</h2><table id="daily-table"><thead><tr><th>Day</th><th>Count</th><th>Avg Spread</th><th>Max Spread</th><th></th></tr></thead><tbody></tbody></table><h2>Top Pairs by Opportunity Count</h2><table id="top-pairs-table"><thead><tr><th>Pair</th><th>Opps</th><th>Avg Spread</th></tr></thead><tbody></tbody></table></div>

<script>
const API = '';
let currentTab = 'pairs';

function showTab(name) {
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('[id^="tab-"]').forEach(t => t.classList.add('hidden'));
  document.querySelector('.tab[onclick*="'+name+'"]').classList.add('active');
  document.getElementById('tab-' + name).classList.remove('hidden');
  currentTab = name;
  refresh();
}

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

async function fetchJson(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
  return res.json();
}

async function loadStats() {
  const s = await fetchJson('/api/stats');
  document.getElementById('stats').innerHTML =
    stat('Pairs', s.pairs) +
    stat('Opps Found', s.oppsFound, 'green') +
    stat('Alerts Sent', s.alertsSent) +
    stat('Suppressed', s.suppressed, 'yellow') +
    stat('Cache Size', s.cacheSize) +
    stat('Uptime', formatUptime(s.uptime));
}

function stat(label, value, cls) {
  return '<div class="stat"><div class="label">' + label + '</div><div class="value' + (cls ? ' ' + cls : '') + '">' + value + '</div></div>';
}

function formatUptime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}

async function loadPairs() {
  const rows = await fetchJson('/api/pairs');
  const tbody = document.querySelector('#pairs-table tbody');
  tbody.innerHTML = rows.map(r =>
    '<tr><td title="' + r.kalshi_ticker + '">' + (r.kalshi_title || r.kalshi_ticker) +
    '</td><td title="' + r.polymarket_id + '">' + (r.poly_question || r.polymarket_id) +
    '</td><td>' + (r.match_confidence * 100).toFixed(0) + '%</td>' +
    '<td><span class="badge ' + r.match_method + '">' + r.match_method + '</span></td>' +
    '<td><span class="badge ' + r.status + '">' + r.status.replace('_', ' ') + '</span></td>' +
    '<td>' + (r.kalshi_yes_bid || '-') + '/' + (r.kalshi_yes_ask || '-') + '</td></tr>'
  ).join('');
}

async function loadOpps() {
  const rows = await fetchJson('/api/opportunities?limit=100');
  const tbody = document.querySelector('#opps-table tbody');
  tbody.innerHTML = rows.map(r =>
    '<tr><td>' + new Date(r.detected_at).toLocaleString() + '</td>' +
    '<td>' + (r.kalshi_title || r.kalshi_ticker) + '</td>' +
    '<td>' + (r.poly_question || r.polymarket_id) + '</td>' +
    '<td>' + fmtStrategy(r.strategy) + '</td>' +
    '<td class="spread-positive">' + r.best_spread_cents + '&cent;</td>' +
    '<td>' + r.estimated_fees_cents + '&cent;</td>' +
    '<td class="' + (r.net_spread_cents > 0 ? 'spread-positive' : 'spread-negative') + '">' + r.net_spread_cents + '&cent;</td>' +
    '<td>' + (r.available_depth_dollars > 0 ? '$' + r.available_depth_dollars : '-') + '</td></tr>'
  ).join('');
}

async function loadSummary() {
  const data = await fetchJson('/api/summary');
  const maxCount = Math.max(...data.oppsByDay.map(r => r.count), 1);
  document.querySelector('#daily-table tbody').innerHTML = data.oppsByDay.map(r =>
    '<tr><td>' + r.day + '</td><td>' + r.count + '</td>' +
    '<td>' + (r.avg_spread || 0).toFixed(1) + '&cent;</td>' +
    '<td class="spread-positive">' + (r.max_spread || 0) + '&cent;</td>' +
    '<td><span class="chart-bar" style="width:' + Math.round(r.count / maxCount * 120) + 'px"></span></td></tr>'
  ).join('');
  document.querySelector('#top-pairs-table tbody').innerHTML = data.topPairs.map(r =>
    '<tr><td>' + r.kalshi_ticker + ' / ' + r.polymarket_id.slice(0, 12) + '</td>' +
    '<td>' + r.opp_count + '</td><td>' + (r.avg_spread || 0).toFixed(1) + '&cent;</td></tr>'
  ).join('');
}

function fmtStrategy(s) {
  if (s === 'kalshi_yes_poly_no') return 'K:YES + P:NO';
  if (s === 'kalshi_no_poly_yes') return 'K:NO + P:YES';
  return s;
}

async function refresh() {
  try {
    await loadStats();
    if (currentTab === 'pairs') await loadPairs();
    else if (currentTab === 'opps') await loadOpps();
    else if (currentTab === 'summary') await loadSummary();
    showError('');
  } catch (e) {
    showError('Failed to load data: ' + e.message);
  }
}

refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>`;
