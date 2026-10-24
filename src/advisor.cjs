'use strict'

/**
 * Performance Budget Evaluator & Smart Optimization Advisor.
 * Analyzes event streams to catch regressions in CI and suggest high-impact fixes.
 */

function evaluateBudget(events, options = {}) {
  const {
    maxStallMs = Infinity,
    maxStallCount = 0,
    maxIpcMs = Infinity,
    maxFailures = 0,
    maxPayloadBytes = Infinity,
    channelBudgets = {},
  } = options

  const violations = []
  let totalStalls = 0
  let worstStallMs = 0
  let totalFailures = 0

  const channelStats = {}

  for (const event of events) {
    if (event.kind === 'main-stall') {
      totalStalls += 1
      if (event.stallMs > worstStallMs) worstStallMs = event.stallMs
      if (event.stallMs > maxStallMs) {
        violations.push({
          type: 'stall-duration',
          message: `Main process stalled for ${event.stallMs}ms (budget: ${maxStallMs}ms)${event.topBlocker ? ` caused by '${event.topBlocker}'` : ''}`,
          actual: event.stallMs,
          budget: maxStallMs,
        })
      }
    }

    if (event.kind === 'ipc-handle') {
      const c = (channelStats[event.channel] ||= { calls: 0, failed: 0, maxMs: 0, maxBytes: 0 })
      c.calls += 1
      if (!event.ok) {
        c.failed += 1
        totalFailures += 1
      }
      if (event.durationMs > c.maxMs) c.maxMs = event.durationMs
      if ((event.bytesOut || 0) > c.maxBytes) c.maxBytes = event.bytesOut

      // Global IPC limit
      if (event.durationMs > maxIpcMs) {
        violations.push({
          type: 'ipc-duration',
          channel: event.channel,
          message: `IPC channel '${event.channel}' took ${event.durationMs}ms (global budget: ${maxIpcMs}ms)`,
          actual: event.durationMs,
          budget: maxIpcMs,
        })
      }

      // Payload size limit
      if ((event.bytesOut || 0) > maxPayloadBytes) {
        violations.push({
          type: 'ipc-payload',
          channel: event.channel,
          message: `IPC channel '${event.channel}' transferred ${Math.round(event.bytesOut / 1024)}KB (budget: ${Math.round(maxPayloadBytes / 1024)}KB)`,
          actual: event.bytesOut,
          budget: maxPayloadBytes,
        })
      }

      // Specific channel budget
      const target = channelBudgets[event.channel]
      if (target) {
        if (target.maxMs != null && event.durationMs > target.maxMs) {
          violations.push({
            type: 'channel-duration',
            channel: event.channel,
            message: `Channel '${event.channel}' took ${event.durationMs}ms (specific budget: ${target.maxMs}ms)`,
            actual: event.durationMs,
            budget: target.maxMs,
          })
        }
        if (target.maxFailures != null && c.failed > target.maxFailures) {
          violations.push({
            type: 'channel-failures',
            channel: event.channel,
            message: `Channel '${event.channel}' failed ${c.failed} times (max allowed: ${target.maxFailures})`,
            actual: c.failed,
            budget: target.maxFailures,
          })
        }
      }
    }
  }

  if (totalStalls > maxStallCount) {
    violations.push({
      type: 'stall-count',
      message: `Encountered ${totalStalls} main-thread stalls (max allowed: ${maxStallCount})`,
      actual: totalStalls,
      budget: maxStallCount,
    })
  }

  if (totalFailures > maxFailures) {
    violations.push({
      type: 'total-failures',
      message: `Encountered ${totalFailures} failed IPC calls (max allowed: ${maxFailures})`,
      actual: totalFailures,
      budget: maxFailures,
    })
  }

  return {
    passed: violations.length === 0,
    violations,
    totalStalls,
    worstStallMs,
    totalFailures,
    channelStats,
  }
}

function generateAdvice(events, summary = {}) {
  const suggestions = []
  const channels = summary?.channels || {}

  for (const [name, stats] of Object.entries(channels)) {
    // 1. Chatty IPC Check
    if (stats.calls >= 25 && stats.p50Ms != null && stats.p50Ms < 5) {
      suggestions.push({
        level: 'warning',
        channel: name,
        title: `Chatty IPC pattern detected on '${name}' (${stats.calls} calls)`,
        advice: `This channel was called ${stats.calls} times with quick execution (<5ms). Consider batching requests into a single array payload to reduce contextBridge serialization overhead.`,
      })
    }

    // 2. Slow / Blocking IPC
    if (stats.maxMs >= 200) {
      suggestions.push({
        level: 'critical',
        channel: name,
        title: `High latency on '${name}' (peak: ${stats.maxMs}ms)`,
        advice: `This handler blocked for ${stats.maxMs}ms. If doing heavy computation or disk/crypto I/O, offload to a Node.js 'worker_thread' or Electron 'utilityProcess' to keep the main event loop responsive.`,
      })
    }
  }

  // 3. Stalls Analysis
  const stalls = events.filter((e) => e.kind === 'main-stall')
  if (stalls.length > 0) {
    const worst = stalls.reduce((w, s) => (s.stallMs > w.stallMs ? s : w), stalls[0])
    suggestions.push({
      level: 'critical',
      title: `${stalls.length} Main-Thread UI freeze(s) detected (worst: ${worst.stallMs}ms)`,
      advice: `The main event loop was unresponsive. Top identified blocker was '${worst.topBlocker || 'synchronous execution'}'. Never execute synchronous fs calls or long while loops on the main thread.`,
    })
  }

  // 4. Memory Growth
  const memEvents = events.filter((e) => e.kind === 'memory')
  if (memEvents.length >= 2) {
    const first = memEvents[0]
    const last = memEvents[memEvents.length - 1]
    const heapGrowth = Math.round((last.jsHeapUsedMB - first.jsHeapUsedMB) * 10) / 10
    const domGrowth = last.domNodes - first.domNodes
    if (heapGrowth > 50) {
      suggestions.push({
        level: 'warning',
        title: `Significant JS Heap growth (+${heapGrowth}MB)`,
        advice: `Heap increased from ${first.jsHeapUsedMB}MB to ${last.jsHeapUsedMB}MB. If this is a repeatable workflow, ensure caches are bounded and unneeded listeners/objects are dereferenced.`,
      })
    }
    if (domGrowth > 500) {
      suggestions.push({
        level: 'warning',
        title: `Large DOM node expansion (+${domGrowth} nodes)`,
        advice: `DOM count grew by ${domGrowth}. Check for virtualized list leaks or component unmount retention.`,
      })
    }
  }

  // 5. Storage Tier Hardware Advisor Rules
  const storageTiers = summary?.storageTiers || {}
  if (storageTiers['camera-card']) {
    const cardStats = storageTiers['camera-card']
    if (cardStats.avgMs > 100 || cardStats.maxMs > 300) {
      suggestions.push({
        level: 'warning',
        tier: 'camera-card',
        title: `Camera memory card latency bottleneck detected (peak: ${cardStats.maxMs}ms)`,
        advice: `Camera SD/CFExpress cards have slow random read characteristics. Enforce single-worker sequential access (concurrency: 1) during card indexing to prevent bus contention.`,
      })
    }
  }

  if (storageTiers['external-hdd']) {
    const hddStats = storageTiers['external-hdd']
    if (hddStats.maxMs > 150) {
      suggestions.push({
        level: 'warning',
        tier: 'external-hdd',
        title: `High latency on external spinning hard drive (peak: ${hddStats.maxMs}ms)`,
        advice: `Mechanical HDDs suffer high seek latency under concurrent random I/O. Use batched asynchronous writes and avoid synchronous fsync on the main process.`,
      })
    }
  }

  return suggestions
}

function buildDetailedSummary(events = [], mode = 'light', overflowed = false) {
  const byKind = {}
  const channelData = {}
  const tierData = {}
  let stalls = 0
  let worstStallMs = 0
  let failures = 0

  for (const event of events) {
    byKind[event.kind] = (byKind[event.kind] || 0) + 1
    if (event.kind === 'main-stall') {
      stalls += 1
      if (event.stallMs > worstStallMs) worstStallMs = event.stallMs
    }
    if (event.kind === 'ipc-handle') {
      const c = (channelData[event.channel] ||= {
        calls: 0,
        failed: 0,
        durations: [],
        bytesOut: 0,
        maxMs: 0,
      })
      c.calls += 1
      if (!event.ok) {
        c.failed += 1
        failures += 1
      }
      c.durations.push(event.durationMs)
      if (event.durationMs > c.maxMs) c.maxMs = event.durationMs
      c.bytesOut += event.bytesOut || 0

      if (event.storageTier) {
        const t = (tierData[event.storageTier] ||= {
          calls: 0,
          failed: 0,
          totalMs: 0,
          maxMs: 0,
          bytesOut: 0,
        })
        t.calls += 1
        if (!event.ok) t.failed += 1
        t.totalMs += event.durationMs
        if (event.durationMs > t.maxMs) t.maxMs = event.durationMs
        t.bytesOut += event.bytesOut || 0
      }
    }
  }

  const channels = {}
  for (const [name, data] of Object.entries(channelData)) {
    data.durations.sort((a, b) => a - b)
    const total = data.durations.reduce((acc, v) => acc + v, 0)
    const p50 = data.durations[Math.floor(data.durations.length * 0.5)] || 0
    channels[name] = {
      calls: data.calls,
      failed: data.failed,
      maxMs: data.maxMs,
      p50Ms: Math.round(p50 * 100) / 100,
      avgMs: Math.round((total / data.calls) * 100) / 100,
      bytesOut: data.bytesOut,
    }
  }

  const storageTiers = {}
  for (const [tier, data] of Object.entries(tierData)) {
    storageTiers[tier] = {
      calls: data.calls,
      failed: data.failed,
      totalMs: Math.round(data.totalMs * 100) / 100,
      avgMs: Math.round((data.totalMs / data.calls) * 100) / 100,
      maxMs: data.maxMs,
      bytesOut: data.bytesOut,
    }
  }

  const summary = {
    mode,
    events: events.length,
    byKind,
    overflowed,
    stalls,
    worstStallMs,
    failures,
    channels,
    storageTiers,
  }

  summary.advice = generateAdvice(events, summary)
  return summary
}

function formatMarkdownSummary(summary, budgetResult = null, advice = []) {
  let md = `## ⚡ Electron Performance Report\n\n`
  md += `**Total Events:** \`${summary.events}\` | **Overflowed:** \`${summary.overflowed}\`\n\n`

  if (budgetResult) {
    if (budgetResult.passed) {
      md += `> [!NOTE]\n> ✅ **All performance budgets passed.**\n\n`
    } else {
      md += `> [!CAUTION]\n> ❌ **Performance Regression Detected (${budgetResult.violations.length} violations):**\n>\n`
      for (const v of budgetResult.violations) {
        md += `> - ${v.message}\n`
      }
      md += `\n`
    }
  }

  md += `### ⏱️ IPC Handler Performance\n\n`
  md += `| IPC Channel | Calls | Failed | P50 (ms) | Max (ms) |\n`
  md += `| :--- | :---: | :---: | :---: | :---: |\n`
  for (const [name, stats] of Object.entries(summary.channels || {})) {
    md += `| \`${name}\` | ${stats.calls} | ${stats.failed} | ${stats.p50Ms ?? 0} | **${stats.maxMs ?? 0}** |\n`
  }
  md += `\n`

  if (advice.length > 0) {
    md += `### 💡 Smart Optimization Suggestions\n\n`
    for (const a of advice) {
      const icon = a.level === 'critical' ? '🔴' : '🟡'
      md += `- ${icon} **${a.title}**\n  ${a.advice}\n\n`
    }
  }

  return md
}

function assertBudgets(events, options = {}) {
  const result = evaluateBudget(events, options)
  const channels = {}
  for (const [name, stats] of Object.entries(result.channelStats || {})) {
    channels[name] = {
      calls: stats.calls,
      failed: stats.failed,
      maxMs: stats.maxMs,
      p50Ms: stats.maxMs,
    }
  }
  const summary = { events: events.length, overflowed: false, channels }
  const advice = generateAdvice(events, summary)
  return {
    passed: result.passed,
    violations: result.violations,
    advice,
    summary: {
      totalEvents: events.length,
      stalls: result.totalStalls,
      worstStallMs: result.worstStallMs,
      failures: result.totalFailures,
      channels,
    },
  }
}

module.exports = { evaluateBudget, generateAdvice, formatMarkdownSummary, assertBudgets, buildDetailedSummary }
