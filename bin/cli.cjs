#!/usr/bin/env node
'use strict'

// electron-workflow-observer validate <events.jsonl>
// electron-workflow-observer summarize <events.jsonl> [--json] [--advisor] [--markdown]
// electron-workflow-observer assert-budget <events.jsonl> [--max-stall=150] [--max-ipc=100] [--max-failures=0] [--github-summary]
// electron-workflow-observer export-html <events.jsonl> [-o report.html]

const fs = require('node:fs')
const path = require('node:path')
const { validateEvent } = require('../src/schema.cjs')
const { evaluateBudget, generateAdvice, formatMarkdownSummary } = require('../src/advisor.cjs')
const { generateHtmlReport } = require('../src/waterfall.cjs')

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
      const c = (channels[event.channel] ||= { calls: 0, failed: 0, totalBytes: 0, durations: [] })
      c.calls += 1
      if (!event.ok) c.failed += 1
      if (event.bytesOut) c.totalBytes += event.bytesOut
      c.durations.push(event.durationMs)
    }
  }
  for (const c of Object.values(channels)) {
    const sorted = c.durations.sort((a, b) => a - b)
    c.p50Ms = sorted[Math.floor((sorted.length - 1) / 2)]
    c.maxMs = sorted[sorted.length - 1]
    delete c.durations
    if (!c.totalBytes) delete c.totalBytes
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

  const headers = ['IPC Channel', 'Calls', 'Failed', 'P50 (ms)', 'Max (ms)', 'Payload']
  const rows = entries.map(([name, data]) => [
    name,
    String(data.calls),
    String(data.failed),
    String(data.p50Ms ?? 0),
    String(data.maxMs ?? 0),
    data.totalBytes ? `${Math.round(data.totalBytes / 1024)} KB` : '0 B',
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

function parseFlag(argv, prefix, fallback) {
  for (const arg of argv) {
    if (arg.startsWith(`--${prefix}=`)) {
      return Number(arg.split('=')[1])
    }
  }
  return fallback
}

function parseOutputFlag(argv) {
  const idx = argv.indexOf('-o')
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1]
  for (const arg of argv) {
    if (arg.startsWith('--output=')) return arg.split('=')[1]
  }
  return null
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('-'))
  const isJson = argv.includes('--json')
  const isMarkdown = argv.includes('--markdown')
  const showAdvisor = argv.includes('--advisor') || isMarkdown
  const toGithubSummary = argv.includes('--github-summary')
  const [command, file] = args

  if (!['validate', 'summarize', 'assert-budget', 'export-html'].includes(command) || !file) {
    process.stdout.write(
      'Usage: electron-workflow-observer <command> <events.jsonl> [options]\n\n' +
      'Commands:\n' +
      '  validate       Verify that the JSONL log adheres to the strict privacy contract\n' +
      '  summarize      Generate an aggregated performance and IPC latency report\n' +
      '  assert-budget  Assert performance budgets in CI (exits 1 on regression)\n' +
      '  export-html    Generate self-contained interactive HTML waterfall timeline\n\n' +
      'Options:\n' +
      '  --json             Output raw structured JSON\n' +
      '  --markdown         Output GitHub-flavored markdown report\n' +
      '  --advisor          Include prescriptive optimization suggestions\n' +
      '  --github-summary   Write markdown report to $GITHUB_STEP_SUMMARY in CI\n' +
      '  --max-stall=<ms>   Max allowed event loop freeze in ms (default: 150)\n' +
      '  --max-ipc=<ms>     Max allowed duration for any IPC call in ms (default: 100)\n' +
      '  --max-failures=<n> Max allowed failed IPC calls (default: 0)\n' +
      '  -o, --output=<file>Output HTML report file path\n' +
      '  -h, --help         Show this help message\n'
    )
    return argv.includes('--help') || argv.includes('-h') ? 0 : 2
  }

  try {
    const events = readEvents(file)
    const summary = summarize(events)

    if (command === 'validate') {
      const result = { valid: true, events: summary.events, overflowed: summary.overflowed }
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return summary.overflowed ? 1 : 0
    }

    if (command === 'export-html') {
      const outPath = parseOutputFlag(argv) || 'workflow-profile.html'
      const html = generateHtmlReport(events, summary)
      fs.writeFileSync(outPath, html, 'utf8')
      process.stdout.write(`✓ Exported interactive waterfall timeline to: ${path.resolve(outPath)}\n`)
      return 0
    }

    if (command === 'assert-budget') {
      const budgetOptions = {
        maxStallMs: parseFlag(argv, 'max-stall', 150),
        maxIpcMs: parseFlag(argv, 'max-ipc', 100),
        maxFailures: parseFlag(argv, 'max-failures', 0),
      }
      const budget = evaluateBudget(events, budgetOptions)
      const advice = generateAdvice(events, summary)

      if (toGithubSummary && process.env.GITHUB_STEP_SUMMARY) {
        try {
          const md = formatMarkdownSummary(summary, budget, advice)
          fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`)
        } catch {}
      }

      if (isJson) {
        process.stdout.write(`${JSON.stringify({ budget, summary }, null, 2)}\n`)
      } else {
        if (budget.passed) {
          process.stdout.write(`✅ Performance budget passed (${summary.events} events checked).\n`)
          process.stdout.write(`   - Worst stall: ${budget.worstStallMs}ms (limit: ${budgetOptions.maxStallMs}ms)\n`)
          process.stdout.write(`   - Failed calls: ${budget.totalFailures} (limit: ${budgetOptions.maxFailures})\n`)
        } else {
          process.stderr.write(`❌ Performance budget failed (${budget.violations.length} regressions):\n`)
          for (const v of budget.violations) {
            process.stderr.write(`   - ${v.message}\n`)
          }
        }
      }
      return budget.passed ? 0 : 1
    }

    // summarize command
    const advice = showAdvisor ? generateAdvice(events, summary) : []
    const isTTY = Boolean(process.stdout.isTTY)
    const wantsTable = argv.includes('--table')
    const wantsJson = isJson || (!isTTY && !wantsTable && !isMarkdown)

    if (wantsJson) {
      process.stdout.write(`${JSON.stringify(summary)}\n`)
    } else if (isMarkdown) {
      process.stdout.write(formatMarkdownSummary(summary, null, advice))
    } else {
      process.stdout.write(`\n=== Electron Workflow Observer Summary ===\n`)
      process.stdout.write(`Total Events: ${summary.events} | Overflowed: ${summary.overflowed}\n\n`)
      process.stdout.write(`Event Types:\n`)
      for (const [kind, count] of Object.entries(summary.byKind)) {
        process.stdout.write(`  - ${kind}: ${count}\n`)
      }
      process.stdout.write(`\nIPC Handler Performance:\n`)
      process.stdout.write(formatTable(summary.channels))

      if (advice.length > 0) {
        process.stdout.write(`\n💡 Optimization Suggestions:\n`)
        for (const a of advice) {
          const icon = a.level === 'critical' ? '🔴' : '🟡'
          process.stdout.write(`  ${icon} ${a.title}\n     ${a.advice}\n`)
        }
      }
      process.stdout.write('\n')
    }

    if (toGithubSummary && process.env.GITHUB_STEP_SUMMARY) {
      try {
        const md = formatMarkdownSummary(summary, null, advice)
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`)
      } catch {}
    }

    return summary.overflowed ? 1 : 0
  } catch (error) {
    if (command === 'validate' || isJson) {
      process.stdout.write(`${JSON.stringify({ valid: false, error: error.message })}\n`)
    } else {
      process.stderr.write(`✗ Error: ${error.message}\n`)
    }
    return 1
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))
module.exports = { main, summarize, readEvents, formatTable }
