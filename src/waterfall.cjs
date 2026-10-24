'use strict'

/**
 * Generates a self-contained, zero-dependency, interactive HTML timeline
 * and waterfall visualization for an Electron workflow run.
 */

function formatMs(ms) {
  if (ms == null) return '0ms'
  if (ms < 1) return ms.toFixed(2) + 'ms'
  if (ms < 10) return ms.toFixed(1) + 'ms'
  return Math.round(ms) + 'ms'
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

function escapeHtml(str) {
  if (typeof str !== 'string') return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function generateHtmlReport(events, summary = {}, options = {}) {
  const { title = 'Electron Workflow Performance Profile' } = options

  const sessionEvent = events.find((e) => e.kind === 'session')
  const startTime = events.length > 0 ? events[0].monotonicMs : 0
  const endTime = events.length > 0 ? events[events.length - 1].monotonicMs : 1000
  const totalDurationMs = Math.max(1, endTime - startTime)

  const ipcEvents = events
    .filter((e) => e.kind === 'ipc-handle')
    .map((e, index) => {
      const durationMs = Number(e.durationMs) || 0
      const startRelMs = Math.max(0, (e.monotonicMs || 0) - startTime)
      return {
        id: index + 1,
        channel: String(e.channel || 'unknown'),
        durationMs,
        ok: Boolean(e.ok),
        bytesOut: Number(e.bytesOut) || 0,
        startRelMs,
        endRelMs: startRelMs + durationMs,
      }
    })

  const stalls = events
    .filter((e) => e.kind === 'main-stall')
    .map((e) => ({
      stallMs: Number(e.stallMs) || 0,
      topBlocker: String(e.topBlocker || 'main-thread-busy'),
      blockerCount: Number(e.blockerCount) || 1,
      startRelMs: Math.max(0, (e.monotonicMs || 0) - startTime),
    }))

  const totalBytes = ipcEvents.reduce((acc, i) => acc + i.bytesOut, 0)
  const maxIpcMs = ipcEvents.length > 0 ? Math.max(...ipcEvents.map((i) => i.durationMs)) : 0
  const worstStall = stalls.length > 0 ? Math.max(...stalls.map((s) => s.stallMs)) : 0
  const totalFailures = ipcEvents.filter((i) => !i.ok).length

  // Aggregated channel metrics for Grouped View
  const channelMap = new Map()
  for (const item of ipcEvents) {
    let entry = channelMap.get(item.channel)
    if (!entry) {
      entry = {
        channel: item.channel,
        calls: 0,
        failed: 0,
        totalMs: 0,
        maxMs: 0,
        minMs: Infinity,
        durations: [],
        totalBytes: 0,
      }
      channelMap.set(item.channel, entry)
    }
    entry.calls += 1
    if (!item.ok) entry.failed += 1
    entry.totalMs += item.durationMs
    entry.durations.push(item.durationMs)
    if (item.durationMs > entry.maxMs) entry.maxMs = item.durationMs
    if (item.durationMs < entry.minMs) entry.minMs = item.durationMs
    entry.totalBytes += item.bytesOut
  }

  const groupedChannels = Array.from(channelMap.values()).map((entry) => {
    entry.durations.sort((a, b) => a - b)
    const p50 = entry.durations[Math.floor(entry.durations.length * 0.5)] || 0
    const p95 = entry.durations[Math.floor(entry.durations.length * 0.95)] || 0
    const avgMs = entry.totalMs / (entry.calls || 1)
    const pctOfTotalTime =
      ipcEvents.reduce((s, i) => s + i.durationMs, 0) > 0
        ? (entry.totalMs / ipcEvents.reduce((s, i) => s + i.durationMs, 0)) * 100
        : 0
    return {
      channel: entry.channel,
      calls: entry.calls,
      failed: entry.failed,
      totalMs: entry.totalMs,
      avgMs,
      p50,
      p95,
      maxMs: entry.maxMs,
      minMs: entry.minMs === Infinity ? 0 : entry.minMs,
      totalBytes: entry.totalBytes,
      pctOfTotalTime,
    }
  })
  groupedChannels.sort((a, b) => b.totalMs - a.totalMs)

  // Timeline time ticks (5 equidistant markers)
  const ticks = [0, 0.25, 0.5, 0.75, 1.0].map((frac) => ({
    pct: (frac * 100).toFixed(1),
    timeLabel: formatMs(totalDurationMs * frac),
  }))

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #090d13;
      --surface: #121820;
      --surface-hover: #1c232f;
      --surface-active: #242c3a;
      --border: #273140;
      --border-light: #344256;
      --text: #e2e8f0;
      --text-muted: #8b9bb4;
      --accent: #38bdf8;
      --accent-subtle: rgba(56, 189, 248, 0.12);
      --success: #34d399;
      --success-bg: rgba(52, 211, 153, 0.15);
      --warning: #fbbf24;
      --warning-bg: rgba(251, 191, 36, 0.18);
      --danger: #f87171;
      --danger-bg: rgba(248, 113, 113, 0.2);
      --stall-overlay: rgba(239, 68, 68, 0.28);
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 24px;
      line-height: 1.45;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    .header-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #fff;
    }
    .meta-tag {
      font-size: 12px;
      color: var(--text-muted);
      background: var(--surface);
      border: 1px solid var(--border);
      padding: 3px 10px;
      border-radius: 999px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    .stat-value {
      font-size: 22px;
      font-weight: 700;
      color: #fff;
      font-family: var(--font-mono);
    }
    .stat-value.danger { color: var(--danger); }
    .stat-value.warning { color: var(--warning); }
    .stat-value.success { color: var(--success); }

    /* Stall Alert Banner */
    .stall-banner {
      background: linear-gradient(90deg, rgba(239, 68, 68, 0.18) 0%, rgba(239, 68, 68, 0.05) 100%);
      border: 1px solid var(--danger);
      border-left: 6px solid var(--danger);
      border-radius: 8px;
      padding: 14px 18px;
      margin-bottom: 20px;
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }
    .stall-banner-icon { font-size: 22px; line-height: 1; }
    .stall-banner-title { font-weight: 700; font-size: 14px; color: #fff; margin-bottom: 2px; }
    .stall-banner-desc { font-size: 13px; color: #fca5a5; }

    /* Controls Bar */
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .tab-group {
      display: flex;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .tab-btn.active {
      background: var(--surface-active);
      color: #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .search-box {
      position: relative;
      flex: 1;
      max-width: 380px;
      min-width: 220px;
    }
    .search-input {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 7px 12px 7px 32px;
      color: #fff;
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s;
    }
    .search-input:focus { border-color: var(--accent); }
    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      font-size: 13px;
      pointer-events: none;
    }

    /* Split-Pane Waterfall Container */
    .waterfall-view {
      display: block;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .waterfall-table-wrapper {
      display: flex;
      position: relative;
      overflow-x: auto;
    }

    /* Left Column: Fixed Width Table */
    .left-pane {
      width: 380px;
      min-width: 380px;
      border-right: 1px solid var(--border);
      background: var(--surface);
      z-index: 10;
      flex-shrink: 0;
    }
    .left-header {
      height: 38px;
      display: flex;
      align-items: center;
      padding: 0 16px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      background: var(--bg);
      justify-content: space-between;
    }
    .row-item {
      height: 34px;
      display: flex;
      align-items: center;
      padding: 0 16px;
      font-size: 12px;
      border-bottom: 1px solid #1a222d;
      justify-content: space-between;
      transition: background 0.1s;
      cursor: pointer;
    }
    .row-item:hover, .row-item.highlighted {
      background: var(--surface-hover);
    }
    .channel-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      padding-right: 12px;
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .status-ok { background: var(--success); }
    .status-err { background: var(--danger); box-shadow: 0 0 6px var(--danger); }
    .channel-name {
      font-family: var(--font-mono);
      font-size: 12px;
      color: #fff;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .metrics-cell {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    .duration-badge {
      font-family: var(--font-mono);
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
    }
    .dur-fast { background: var(--success-bg); color: var(--success); }
    .dur-medium { background: var(--warning-bg); color: var(--warning); }
    .dur-slow { background: var(--danger-bg); color: var(--danger); }
    .bytes-text {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      width: 55px;
      text-align: right;
    }

    /* Right Column: Timeline Canvas */
    .timeline-pane {
      flex: 1;
      min-width: 600px;
      position: relative;
      background: var(--surface);
    }
    .timeline-ruler {
      height: 38px;
      position: relative;
      border-bottom: 1px solid var(--border);
      background: var(--bg);
    }
    .ruler-tick {
      position: absolute;
      top: 0;
      bottom: 0;
      border-left: 1px solid var(--border);
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      padding: 4px 0 0 6px;
      pointer-events: none;
    }
    .timeline-rows-container {
      position: relative;
    }
    .timeline-row {
      height: 34px;
      position: relative;
      border-bottom: 1px solid #1a222d;
      transition: background 0.1s;
    }
    .timeline-row:hover, .timeline-row.highlighted {
      background: var(--surface-hover);
    }
    .grid-vertical-line {
      position: absolute;
      top: 0;
      bottom: 0;
      border-left: 1px dashed rgba(255, 255, 255, 0.05);
      pointer-events: none;
    }

    /* Stall Overlays across full height */
    .stall-zone {
      position: absolute;
      top: 0;
      bottom: 0;
      background: var(--stall-overlay);
      border-left: 2px solid var(--danger);
      border-right: 2px solid var(--danger);
      z-index: 5;
      pointer-events: none;
    }
    .stall-tag {
      position: absolute;
      top: 2px;
      left: 4px;
      font-size: 9px;
      font-weight: 700;
      font-family: var(--font-mono);
      background: var(--danger);
      color: #fff;
      padding: 1px 5px;
      border-radius: 3px;
      white-space: nowrap;
      box-shadow: 0 2px 4px rgba(0,0,0,0.5);
    }

    /* Bar Styling */
    .bar-wrapper {
      position: absolute;
      top: 7px;
      height: 20px;
      display: flex;
      align-items: center;
      cursor: pointer;
    }
    .gantt-bar {
      height: 100%;
      border-radius: 3px;
      display: flex;
      align-items: center;
      padding: 0 6px;
      font-size: 11px;
      font-family: var(--font-mono);
      font-weight: 600;
      color: #fff;
      white-space: nowrap;
      transition: filter 0.15s;
    }
    .bar-wrapper:hover .gantt-bar { filter: brightness(1.25); }
    .bar-fast { background: #059669; border: 1px solid #10b981; }
    .bar-medium { background: #d97706; border: 1px solid #f59e0b; }
    .bar-slow { background: #dc2626; border: 1px solid #ef4444; }
    .bar-fail { background: #7f1d1d; border: 1px solid #dc2626; }

    /* External duration text for narrow bars */
    .bar-label-outside {
      margin-left: 8px;
      font-size: 11px;
      font-family: var(--font-mono);
      font-weight: 600;
      color: var(--text-muted);
      white-space: nowrap;
      pointer-events: none;
    }

    /* Grouped View Table */
    .grouped-view {
      display: none;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .grouped-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }
    .grouped-table th {
      background: var(--bg);
      padding: 10px 16px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
    }
    .grouped-table td {
      padding: 10px 16px;
      border-bottom: 1px solid #1a222d;
      font-family: var(--font-mono);
      font-size: 12px;
    }
    .grouped-table tr:hover {
      background: var(--surface-hover);
    }
    .progress-bar-bg {
      width: 100%;
      height: 6px;
      background: var(--bg);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 4px;
    }
    .progress-bar-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 3px;
    }
    .chatty-badge {
      font-size: 10px;
      background: var(--warning-bg);
      color: var(--warning);
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      margin-left: 6px;
      font-family: -apple-system, sans-serif;
    }

    /* Tooltip */
    #tooltip {
      position: fixed;
      display: none;
      background: #1e293b;
      border: 1px solid var(--border-light);
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 12px;
      z-index: 1000;
      pointer-events: none;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6);
      min-width: 240px;
    }
    .tip-title { font-weight: 700; color: #fff; margin-bottom: 6px; font-size: 13px; font-family: var(--font-mono); }
    .tip-row { display: flex; justify-content: space-between; margin-bottom: 4px; color: var(--text-muted); }
    .tip-val { font-weight: 600; color: var(--text); font-family: var(--font-mono); }
  </style>
</head>
<body>

  <header>
    <div class="header-title">
      <h1>⚡ Electron Workflow Observer</h1>
      <span class="meta-tag">Mode: <b>${escapeHtml(sessionEvent?.mode || 'light')}</b></span>
      <span class="meta-tag">Total Span: <b>${formatMs(totalDurationMs)}</b></span>
    </div>
    <div>
      <span class="meta-tag">Session: <code>${escapeHtml(sessionEvent?.sessionId || 'active').slice(0, 8)}</code></span>
    </div>
  </header>

  ${
    stalls.length > 0
      ? `
  <div class="stall-banner">
    <div class="stall-banner-icon">⚠️</div>
    <div>
      <div class="stall-banner-title">Main Process Event-Loop Freeze Detected!</div>
      <div class="stall-banner-desc">
        The main thread experienced <b>${stalls.length} freeze event(s)</b> (worst freeze: <b>${worstStall}ms</b>).
        Top identified blocker: <code>${escapeHtml(stalls[0]?.topBlocker || 'main-thread-busy')}</code>.
        Synchronous operations or heavy computational loops on the main thread cause UI jank and beachballs.
      </div>
    </div>
  </div>`
      : ''
  }

  <div class="stats-grid">
    <div class="stat-card">
      <span class="stat-label">Total IPC Invocations</span>
      <span class="stat-value">${ipcEvents.length}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Worst Handler Peak</span>
      <span class="stat-value ${maxIpcMs > 100 ? 'danger' : maxIpcMs > 25 ? 'warning' : 'success'}">${formatMs(maxIpcMs)}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Main Process Stalls</span>
      <span class="stat-value ${stalls.length > 0 ? 'danger' : 'success'}">${stalls.length}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Total Bytes Out</span>
      <span class="stat-value">${formatBytes(totalBytes)}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Handler Failures</span>
      <span class="stat-value ${totalFailures > 0 ? 'danger' : 'success'}">${totalFailures}</span>
    </div>
  </div>

  <div class="toolbar">
    <div class="tab-group">
      <button class="tab-btn active" id="tabWaterfall" onclick="switchView('waterfall')">Waterfall Timeline (${ipcEvents.length})</button>
      <button class="tab-btn" id="tabGrouped" onclick="switchView('grouped')">Grouped by Channel (${groupedChannels.length})</button>
    </div>
    <div class="search-box">
      <span class="search-icon">🔍</span>
      <input type="text" id="searchInput" class="search-input" placeholder="Search channels..." oninput="handleSearch(this.value)">
    </div>
  </div>

  <!-- VIEW 1: Split-Pane Waterfall -->
  <div class="waterfall-view" id="waterfallContainer">
    <div class="waterfall-table-wrapper">
      
      <!-- Left Column: Channel & Metrics -->
      <div class="left-pane" id="leftPane">
        <div class="left-header">
          <span>Channel / IPC Handler</span>
          <span>Duration & Size</span>
        </div>
        ${ipcEvents
          .map((e) => {
            const durCls = !e.ok ? 'dur-slow' : e.durationMs > 100 ? 'dur-slow' : e.durationMs > 16 ? 'dur-medium' : 'dur-fast'
            return `
        <div class="row-item" data-id="${e.id}" data-channel="${escapeHtml(e.channel)}" onmouseenter="highlightRow(${e.id})" onmouseleave="unhighlightRow(${e.id})">
          <div class="channel-cell" title="${escapeHtml(e.channel)}">
            <span class="status-dot ${e.ok ? 'status-ok' : 'status-err'}"></span>
            <span class="channel-name">${escapeHtml(e.channel)}</span>
          </div>
          <div class="metrics-cell">
            <span class="duration-badge ${durCls}">${formatMs(e.durationMs)}</span>
            <span class="bytes-text">${formatBytes(e.bytesOut)}</span>
          </div>
        </div>`
          })
          .join('')}
      </div>

      <!-- Right Column: Timeline Gantt -->
      <div class="timeline-pane" id="timelinePane">
        
        <!-- Ruler -->
        <div class="timeline-ruler">
          ${ticks
            .map(
              (t) => `
          <div class="ruler-tick" style="left: ${t.pct}%;">
            ${t.timeLabel}
          </div>`
            )
            .join('')}
        </div>

        <!-- Rows Container -->
        <div class="timeline-rows-container">
          
          <!-- Background Grid Lines -->
          ${ticks
            .map(
              (t) => `
          <div class="grid-vertical-line" style="left: ${t.pct}%;"></div>`
            )
            .join('')}

          <!-- Stall Zones -->
          ${stalls
            .map((s) => {
              const leftPct = ((s.startRelMs / totalDurationMs) * 100).toFixed(2)
              const widthPct = Math.max(0.6, (s.stallMs / totalDurationMs) * 100).toFixed(2)
              return `
          <div class="stall-zone" style="left: ${leftPct}%; width: ${widthPct}%;" title="Event loop freeze: ${s.stallMs}ms (Blocker: ${escapeHtml(s.topBlocker)})">
            <span class="stall-tag">STALL ${s.stallMs}ms (${escapeHtml(s.topBlocker)})</span>
          </div>`
            })
            .join('')}

          <!-- Timeline Bars -->
          ${ipcEvents
            .map((e) => {
              const leftPct = ((e.startRelMs / totalDurationMs) * 100).toFixed(2)
              const rawWidthPct = (e.durationMs / totalDurationMs) * 100
              const widthPct = Math.max(0.5, rawWidthPct).toFixed(2)

              let barCls = 'bar-fast'
              if (!e.ok) barCls = 'bar-fail'
              else if (e.durationMs > 100) barCls = 'bar-slow'
              else if (e.durationMs > 16) barCls = 'bar-medium'

              const isWide = rawWidthPct > 12

              return `
          <div class="timeline-row" data-id="${e.id}" data-channel="${escapeHtml(e.channel)}" onmouseenter="highlightRow(${e.id})" onmouseleave="unhighlightRow(${e.id})">
            <div class="bar-wrapper" style="left: ${leftPct}%;"
                 onmouseenter="showTooltip(event, '${escapeHtml(e.channel)}', ${e.durationMs}, ${e.ok}, ${e.bytesOut}, ${e.startRelMs})"
                 onmousemove="moveTooltip(event)"
                 onmouseleave="hideTooltip()">
              <div class="gantt-bar ${barCls}" style="width: ${widthPct}%; min-width: 6px;">
                ${isWide ? formatMs(e.durationMs) : ''}
              </div>
              ${!isWide ? `<span class="bar-label-outside">${formatMs(e.durationMs)}</span>` : ''}
            </div>
          </div>`
            })
            .join('')}

        </div>
      </div>

    </div>
  </div>

  <!-- VIEW 2: Grouped by Channel -->
  <div class="grouped-view" id="groupedContainer">
    <table class="grouped-table">
      <thead>
        <tr>
          <th>Channel Name</th>
          <th>Calls</th>
          <th>Total Time</th>
          <th>Avg Duration</th>
          <th>P95 Duration</th>
          <th>Peak Max</th>
          <th>Total Payload</th>
          <th style="width: 180px;">% of Total Time</th>
        </tr>
      </thead>
      <tbody>
        ${groupedChannels
          .map((g) => {
            const isChatty = g.calls >= 15
            return `
        <tr data-channel="${escapeHtml(g.channel)}">
          <td>
            <span style="color: #fff; font-weight: 600;">${escapeHtml(g.channel)}</span>
            ${isChatty ? `<span class="chatty-badge">Chatty (${g.calls})</span>` : ''}
          </td>
          <td>${g.calls}${g.failed > 0 ? ` <span style="color: var(--danger)">(${g.failed} failed)</span>` : ''}</td>
          <td><b>${formatMs(g.totalMs)}</b></td>
          <td>${formatMs(g.avgMs)}</td>
          <td>${formatMs(g.p95)}</td>
          <td style="color: ${g.maxMs > 100 ? 'var(--danger)' : g.maxMs > 16 ? 'var(--warning)' : 'inherit'}">${formatMs(g.maxMs)}</td>
          <td>${formatBytes(g.totalBytes)}</td>
          <td>
            <div style="font-size: 11px; color: var(--text-muted);">${g.pctOfTotalTime.toFixed(1)}%</div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${Math.min(100, Math.max(1, g.pctOfTotalTime))}%;"></div>
            </div>
          </td>
        </tr>`
          })
          .join('')}
      </tbody>
    </table>
  </div>

  <!-- Tooltip Element -->
  <div id="tooltip">
    <div class="tip-title" id="tipChannel"></div>
    <div class="tip-row"><span>Duration:</span><span class="tip-val" id="tipDuration"></span></div>
    <div class="tip-row"><span>Status:</span><span class="tip-val" id="tipStatus"></span></div>
    <div class="tip-row"><span>Payload:</span><span class="tip-val" id="tipPayload"></span></div>
    <div class="tip-row"><span>Offset from Start:</span><span class="tip-val" id="tipOffset"></span></div>
  </div>

  <script>
    function switchView(mode) {
      const waterfallEl = document.getElementById('waterfallContainer');
      const groupedEl = document.getElementById('groupedContainer');
      const tabW = document.getElementById('tabWaterfall');
      const tabG = document.getElementById('tabGrouped');

      if (mode === 'waterfall') {
        waterfallEl.style.display = 'block';
        groupedEl.style.display = 'none';
        tabW.classList.add('active');
        tabG.classList.remove('active');
      } else {
        waterfallEl.style.display = 'none';
        groupedEl.style.display = 'block';
        tabG.classList.add('active');
        tabW.classList.remove('active');
      }
    }

    function handleSearch(term) {
      term = (term || '').toLowerCase().trim();
      const rows = document.querySelectorAll('.row-item, .timeline-row, .grouped-table tbody tr');
      rows.forEach(row => {
        const ch = (row.getAttribute('data-channel') || '').toLowerCase();
        if (!term || ch.includes(term)) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    }

    function highlightRow(id) {
      document.querySelectorAll('[data-id="' + id + '"]').forEach(el => {
        el.classList.add('highlighted');
      });
    }

    function unhighlightRow(id) {
      document.querySelectorAll('[data-id="' + id + '"]').forEach(el => {
        el.classList.remove('highlighted');
      });
    }

    const tip = document.getElementById('tooltip');
    const tipChannel = document.getElementById('tipChannel');
    const tipDuration = document.getElementById('tipDuration');
    const tipStatus = document.getElementById('tipStatus');
    const tipPayload = document.getElementById('tipPayload');
    const tipOffset = document.getElementById('tipOffset');

    function showTooltip(e, channel, durationMs, ok, bytes, offsetMs) {
      tipChannel.textContent = channel;
      tipDuration.textContent = durationMs < 1 ? durationMs.toFixed(2) + 'ms' : durationMs.toFixed(1) + 'ms';
      tipStatus.textContent = ok ? '✓ Success' : '✗ Failed';
      tipStatus.style.color = ok ? 'var(--success)' : 'var(--danger)';
      tipPayload.textContent = bytes > 0 ? (bytes > 1024 ? (bytes/1024).toFixed(1) + ' KB' : bytes + ' B') : 'None';
      tipOffset.textContent = '+' + (offsetMs < 1 ? offsetMs.toFixed(2) : Math.round(offsetMs)) + 'ms';
      tip.style.display = 'block';
      moveTooltip(e);
    }

    function moveTooltip(e) {
      const pad = 15;
      let x = e.clientX + pad;
      let y = e.clientY + pad;
      if (x + 260 > window.innerWidth) x = e.clientX - 260 - pad;
      if (y + 160 > window.innerHeight) y = e.clientY - 160 - pad;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    }

    function hideTooltip() {
      tip.style.display = 'none';
    }
  </script>
</body>
</html>`
}

module.exports = {
  generateHtmlReport,
  formatMs,
  formatBytes,
}
