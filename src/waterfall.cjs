'use strict'

/**
 * Generates a self-contained, zero-dependency, interactive HTML timeline
 * visualization for an Electron workflow run.
 */

function generateHtmlReport(events, summary, options = {}) {
  const { title = 'Electron Workflow Performance Profile' } = options

  const sessionEvent = events.find((e) => e.kind === 'session')
  const startTime = events.length > 0 ? events[0].monotonicMs : 0
  const endTime = events.length > 0 ? events[events.length - 1].monotonicMs : 1000
  const totalDurationMs = Math.max(1, Math.round(endTime - startTime))

  const ipcEvents = events
    .filter((e) => e.kind === 'ipc-handle')
    .map((e) => ({
      channel: e.channel,
      durationMs: e.durationMs,
      ok: e.ok,
      bytesOut: e.bytesOut || 0,
      startRelMs: Math.max(0, Math.round(e.monotonicMs - startTime)),
    }))

  const stalls = events
    .filter((e) => e.kind === 'main-stall')
    .map((e) => ({
      stallMs: e.stallMs,
      topBlocker: e.topBlocker || 'main-thread-busy',
      startRelMs: Math.max(0, Math.round(e.monotonicMs - startTime)),
    }))

  const memEvents = events
    .filter((e) => e.kind === 'memory')
    .map((e) => ({
      jsHeapUsedMB: e.jsHeapUsedMB,
      domNodes: e.domNodes,
      startRelMs: Math.max(0, Math.round(e.monotonicMs - startTime)),
    }))

  const channelsList = Object.keys(summary.channels || {})

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --success: #3fb950;
      --warning: #d29922;
      --danger: #f85149;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 24px;
    }
    header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h1 { margin: 0; font-size: 20px; font-weight: 600; color: #fff; }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      background: #21262d;
      border: 1px solid var(--border);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .card .label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px; }
    .card .val { font-size: 24px; font-weight: bold; color: #fff; }
    .timeline-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
      overflow-x: auto;
    }
    .timeline-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 16px;
      align-items: center;
    }
    .timeline-canvas {
      position: relative;
      min-width: 800px;
      height: ${Math.max(200, ipcEvents.length * 28 + 40)}px;
      border-left: 2px solid var(--border);
      border-bottom: 2px solid var(--border);
    }
    .time-grid-line {
      position: absolute;
      top: 0;
      bottom: 0;
      border-left: 1px dashed #21262d;
      font-size: 10px;
      color: var(--text-muted);
      padding-left: 4px;
    }
    .bar {
      position: absolute;
      height: 20px;
      border-radius: 4px;
      font-size: 11px;
      line-height: 20px;
      padding: 0 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #fff;
      cursor: pointer;
      transition: filter 0.2s;
    }
    .bar:hover { filter: brightness(1.2); }
    .bar-fast { background: #238636; }
    .bar-medium { background: #9e6a03; }
    .bar-slow { background: #da3633; }
    .bar-fail { background: #8e1519; border: 1px solid #f85149; }
    .stall-zone {
      position: absolute;
      top: 0;
      bottom: 0;
      background: rgba(248, 81, 73, 0.15);
      border-left: 2px solid var(--danger);
      pointer-events: none;
    }
    .tooltip {
      position: fixed;
      display: none;
      background: #1f242c;
      border: 1px solid var(--border);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      z-index: 100;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    input[type="text"] {
      background: #0d1117;
      border: 1px solid var(--border);
      color: #fff;
      padding: 6px 12px;
      border-radius: 6px;
      outline: none;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>⚡ Electron Workflow Performance Timeline</h1>
      <span style="font-size: 12px; color: var(--text-muted)">Mode: <b>${sessionEvent?.mode || 'light'}</b> | Duration: <b>${totalDurationMs}ms</b></span>
    </div>
    <div>
      <span class="badge">Events: ${events.length}</span>
      <span class="badge">IPC Calls: ${ipcEvents.length}</span>
      <span class="badge" style="color: ${stalls.length > 0 ? 'var(--danger)' : 'var(--success)'}">Stalls: ${stalls.length}</span>
    </div>
  </header>

  <div class="grid">
    <div class="card">
      <div class="label">Total IPC Calls</div>
      <div class="val">${ipcEvents.length}</div>
    </div>
    <div class="card">
      <div class="label">Worst Handler Peak</div>
      <div class="val">${Math.max(0, ...ipcEvents.map((i) => i.durationMs))}ms</div>
    </div>
    <div class="card">
      <div class="label">Main Thread Stalls</div>
      <div class="val" style="color: ${stalls.length > 0 ? 'var(--danger)' : 'inherit'}">${stalls.length}</div>
    </div>
    <div class="card">
      <div class="label">Total Bytes Transferred</div>
      <div class="val">${Math.round(ipcEvents.reduce((s, i) => s + (i.bytesOut || 0), 0) / 1024)} KB</div>
    </div>
  </div>

  <div class="timeline-container">
    <div class="timeline-header">
      <h2 style="font-size: 16px; margin: 0;">Interactive Waterfall Chart</h2>
      <input type="text" id="filterInput" placeholder="Filter channel..." onkeyup="filterChannels()">
    </div>
    <div class="timeline-canvas" id="canvas">
      ${[0, 0.25, 0.5, 0.75, 1.0]
        .map((frac) => {
          const leftPct = (frac * 100).toFixed(1)
          const timeLabel = Math.round(totalDurationMs * frac) + 'ms'
          return `<div class="time-grid-line" style="left: ${leftPct}%">${timeLabel}</div>`
        })
        .join('')}

      ${stalls
        .map((s) => {
          const leftPct = ((s.startRelMs / totalDurationMs) * 100).toFixed(2)
          const widthPct = Math.max(0.5, (s.stallMs / totalDurationMs) * 100).toFixed(2)
          return `<div class="stall-zone" style="left: ${leftPct}%; width: ${widthPct}%;" title="Main Stall: ${s.stallMs}ms (${s.topBlocker})"></div>`
        })
        .join('')}

      ${ipcEvents
        .map((e, index) => {
          const leftPct = ((e.startRelMs / totalDurationMs) * 100).toFixed(2)
          const widthPct = Math.max(0.4, (e.durationMs / totalDurationMs) * 100).toFixed(2)
          const topPx = index * 26 + 10
          let cls = 'bar-fast'
          if (!e.ok) cls = 'bar-fail'
          else if (e.durationMs > 100) cls = 'bar-slow'
          else if (e.durationMs > 16) cls = 'bar-medium'

          return `<div class="bar ${cls}" data-channel="${e.channel}" style="left: ${leftPct}%; width: ${widthPct}%; top: ${topPx}px;"
            onmouseenter="showTip(event, '${e.channel}', ${e.durationMs}, ${e.ok}, ${e.bytesOut})"
            onmouseleave="hideTip()">
            ${e.channel} (${e.durationMs}ms)
          </div>`
        })
        .join('')}
    </div>
  </div>

  <div id="tooltip" class="tooltip"></div>

  <script>
    const tip = document.getElementById('tooltip');
    function showTip(event, channel, ms, ok, bytes) {
      tip.style.display = 'block';
      tip.style.left = (event.clientX + 12) + 'px';
      tip.style.top = (event.clientY + 12) + 'px';
      tip.innerHTML = '<b>' + channel + '</b><br>' +
        'Duration: <b>' + ms + 'ms</b><br>' +
        'Status: ' + (ok ? '<span style="color:#3fb950">✓ OK</span>' : '<span style="color:#f85149">✗ FAILED</span>') + '<br>' +
        (bytes ? 'Payload: ' + Math.round(bytes / 1024) + ' KB' : '');
    }
    function hideTip() { tip.style.display = 'none'; }
    function filterChannels() {
      const q = document.getElementById('filterInput').value.toLowerCase();
      const bars = document.querySelectorAll('.bar');
      bars.forEach(b => {
        b.style.display = b.getAttribute('data-channel').toLowerCase().includes(q) ? 'block' : 'none';
      });
    }
  </script>
</body>
</html>`
}

module.exports = { generateHtmlReport }
