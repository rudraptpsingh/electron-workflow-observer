#!/usr/bin/env node
'use strict'

// electron-workflow-observer validate <events.jsonl>
// electron-workflow-observer summarize <events.jsonl> [--json]
// Prints counts, durations, and performance summaries. Exits 1 on any invalid event.
const fs = require('node:fs')
const { validateEvent } = require('../src/schema.cjs')

function readEvents(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  return lines.map((line, index) => {
    try {
      return validateEvent(JSON.parse(line))
    } catch (error) {
      const reason = error instanceof SyntaxError ? 'not JSON' : error.message
      throw new Error(`line ${index + 1}: ${reason}`)
    }
  })
}

function summarize(events) {
  const byKind = {}
  const channels = {}
  for (const event of events) {
    byKind[event.kind] = (byKind[event.kind] || 0) + 1
    if (event.kind === 'ipc-handle') {
      const c = (channels[event.channel] ||= { calls: 0, failed: 0, durations: [] })
      c.calls += 1
      if (!event.ok) c.failed += 1
      c.durations.push(event.durationMs)
    }
  }
  for (const c of Object.values(channels)) {
    const sorted = c.durations.sort((a, b) => a - b)
    c.p50Ms = sorted[Math.floor((sorted.length - 1) / 2)]
    c.maxMs = sorted[sorted.length - 1]
    delete c.durations
  }
  return {
    events: events.length,
    byKind,
    overflowed: Boolean(byKind.overflow),
    channels,
  }
}

function formatTable(channels) {
  const entries = Object.entries(channels).sort((a, b) => b[1].maxMs - a[1].maxMs)
  if (entries.length === 0) return '  (no IPC calls recorded)\n'

  const headers = ['IPC Channel', 'Calls', 'Failed', 'P50 (ms)', 'Max (ms)']
  const rows = entries.map(([name, data]) => [
    name,
    String(data.calls),
    String(data.failed),
    String(data.p50Ms ?? 0),
    String(data.maxMs ?? 0),
  ])

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  )

  const pad = (str, len, alignRight = false) =>
    alignRight ? str.padStart(len) : str.padEnd(len)

  const headerLine = headers.map((h, i) => pad(h, colWidths[i], i > 0)).join('  |  ')
  const divider = colWidths.map((w) => '-'.repeat(w)).join('--+--')
  const rowLines = rows.map((r) =>
    r.map((cell, i) => pad(cell, colWidths[i], i > 0)).join('  |  ')
  )

  return [headerLine, divider, ...rowLines].map((l) => `  ${l}`).join('\n') + '\n'
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('-'))
  const isJson = argv.includes('--json')
  const [command, file] = args

  if (!['validate', 'summarize'].includes(command) || !file) {
    process.stdout.write(
      'Usage: electron-workflow-observer <validate|summarize> <events.jsonl> [--json]\n\n' +
      'Commands:\n' +
      '  validate   Verify that the JSONL log adheres to the strict privacy contract\n' +
      '  summarize  Generate an aggregated performance and IPC latency report\n\n' +
      'Options:\n' +
      '  --json     Output raw structured JSON summary\n' +
      '  -h, --help Show this help message\n'
    )
    return argv.includes('--help') || argv.includes('-h') ? 0 : 2
  }

  try {
    const events = readEvents(file)
    const summary = summarize(events)

    if (command === 'validate') {
      const result = { valid: true, events: summary.events, overflowed: summary.overflowed }
      if (isJson) {
        process.stdout.write(`${JSON.stringify(result)}\n`)
      } else {
        process.stdout.write(`✓ Validated ${summary.events} events. Privacy contract satisfied. (Overflowed: ${summary.overflowed})\n`)
      }
      return summary.overflowed ? 1 : 0
    }

    if (isJson) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    } else {
      process.stdout.write(`\n=== Electron Workflow Observer Summary ===\n`)
      process.stdout.write(`Total Events: ${summary.events} | Overflowed: ${summary.overflowed}\n\n`)
      process.stdout.write(`Event Types:\n`)
      for (const [kind, count] of Object.entries(summary.byKind)) {
        process.stdout.write(`  - ${kind}: ${count}\n`)
      }
      process.stdout.write(`\nIPC Handler Performance:\n`)
      process.stdout.write(formatTable(summary.channels))
      process.stdout.write('\n')
    }
    return summary.overflowed ? 1 : 0
  } catch (error) {
    if (isJson) {
      process.stdout.write(`${JSON.stringify({ valid: false, error: error.message })}\n`)
    } else {
      process.stderr.write(`✗ Error: ${error.message}\n`)
    }
    return 1
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))
module.exports = { main, summarize, readEvents, formatTable }
