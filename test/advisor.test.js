'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { evaluateBudget, generateAdvice, formatMarkdownSummary } = require('../src/advisor.cjs')

describe('Budget Evaluator & Optimization Advisor', () => {
  const events = [
    {
      kind: 'session',
      mode: 'light',
      schemaVersion: 1,
      sanitized: true,
      monotonicMs: 0,
      sessionId: 's1',
      clockId: 'c1',
      eventId: 'e1',
    },
    {
      kind: 'ipc-handle',
      channel: 'db:readLarge',
      ok: true,
      durationMs: 85,
      bytesOut: 1024 * 100,
      schemaVersion: 1,
      sanitized: true,
      monotonicMs: 10,
      sessionId: 's1',
      clockId: 'c1',
      eventId: 'e2',
    },
    {
      kind: 'ipc-handle',
      channel: 'fs:statSync',
      ok: false,
      durationMs: 150,
      schemaVersion: 1,
      sanitized: true,
      monotonicMs: 120,
      sessionId: 's1',
      clockId: 'c1',
      eventId: 'e3',
    },
    {
      kind: 'main-stall',
      stallMs: 220,
      blockerCount: 1,
      topBlocker: 'fs:statSync',
      schemaVersion: 1,
      sanitized: true,
      monotonicMs: 270,
      sessionId: 's1',
      clockId: 'c1',
      eventId: 'e4',
    },
  ]

  const summary = {
    events: events.length,
    overflowed: false,
    channels: {
      'db:readLarge': { calls: 1, failed: 0, p50Ms: 85, maxMs: 85 },
      'fs:statSync': { calls: 1, failed: 1, p50Ms: 150, maxMs: 150 },
    },
  }

  it('detects budget violations and reports regressions', () => {
    const res = evaluateBudget(events, {
      maxStallMs: 100, // actual 220ms -> FAIL
      maxIpcMs: 100,   // actual 150ms -> FAIL
      maxFailures: 0,  // actual 1 -> FAIL
    })

    assert.equal(res.passed, false)
    assert.equal(res.violations.length, 4) // stall duration, stall count, ipc duration, total failures
    assert.equal(res.totalStalls, 1)
    assert.equal(res.worstStallMs, 220)
    assert.equal(res.totalFailures, 1)
  })

  it('passes cleanly when within budgets', () => {
    const res = evaluateBudget(events, {
      maxStallMs: 300,
      maxStallCount: 2,
      maxIpcMs: 200,
      maxFailures: 2,
    })

    assert.equal(res.passed, true)
    assert.equal(res.violations.length, 0)
  })

  it('generates actionable optimization advice', () => {
    const advice = generateAdvice(events, summary)
    assert.ok(advice.length >= 1)
    assert.ok(advice.some((a) => a.title.includes('freeze') || a.title.includes('fs:statSync')))
  })

  it('formats GitHub-flavored markdown summary', () => {
    const budget = evaluateBudget(events, { maxStallMs: 500, maxStallCount: 2, maxIpcMs: 500, maxFailures: 5 })
    const md = formatMarkdownSummary(summary, budget, [])
    assert.ok(md.includes('## ⚡ Electron Performance Report'))
    assert.ok(md.includes('db:readLarge'))
    assert.ok(md.includes('All performance budgets passed'))
  })
})
