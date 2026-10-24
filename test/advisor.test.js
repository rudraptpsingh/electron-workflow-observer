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

  it('assertBudgets returns structured pass/fail with advice and summary', () => {
    const { assertBudgets } = require('../src/advisor.cjs')
    const pass = assertBudgets(events, { maxStallMs: 500, maxStallCount: 2, maxIpcMs: 500, maxFailures: 5 })
    assert.equal(pass.passed, true)
    assert.equal(pass.violations.length, 0)
    assert.equal(pass.summary.totalEvents, 4)
    assert.equal(pass.summary.stalls, 1)

    const fail = assertBudgets(events, { maxStallMs: 50 })
    assert.equal(fail.passed, false)
    assert.ok(fail.violations.length >= 1)
  })

  it('buildDetailedSummary computes channels and storage tiers with advice', () => {
    const { buildDetailedSummary } = require('../src/advisor.cjs')
    const sampleEvents = [
      ...events,
      {
        kind: 'ipc-handle',
        channel: 'card:readRaw',
        ok: true,
        durationMs: 320,
        bytesOut: 50000000,
        storageTier: 'camera-card',
        schemaVersion: 1,
        sanitized: true,
        monotonicMs: 400,
        sessionId: 's1',
        clockId: 'c1',
        eventId: 'e5',
      },
      {
        kind: 'ipc-handle',
        channel: 'card:readRaw',
        ok: true,
        durationMs: 290,
        bytesOut: 50000000,
        storageTier: 'camera-card',
        schemaVersion: 1,
        sanitized: true,
        monotonicMs: 750,
        sessionId: 's1',
        clockId: 'c1',
        eventId: 'e6',
      },
      {
        kind: 'ipc-handle',
        channel: 'hdd:writeArchive',
        ok: true,
        durationMs: 180,
        bytesOut: 1000000,
        storageTier: 'external-hdd',
        schemaVersion: 1,
        sanitized: true,
        monotonicMs: 1100,
        sessionId: 's1',
        clockId: 'c1',
        eventId: 'e7',
      },
    ]

    const detailed = buildDetailedSummary(sampleEvents, 'light', false)
    assert.equal(detailed.events, 7)
    assert.equal(detailed.stalls, 1)
    assert.equal(detailed.worstStallMs, 220)
    assert.ok(detailed.channels['card:readRaw'])
    assert.equal(detailed.channels['card:readRaw'].calls, 2)
    assert.ok(detailed.storageTiers['camera-card'])
    assert.equal(detailed.storageTiers['camera-card'].calls, 2)
    assert.ok(detailed.storageTiers['camera-card'].avgMs > 200)
    assert.ok(detailed.storageTiers['external-hdd'])
    assert.equal(detailed.storageTiers['external-hdd'].calls, 1)

    // Storage tier advice should be generated
    assert.ok(detailed.advice.some((a) => a.tier === 'camera-card'))
    assert.ok(detailed.advice.some((a) => a.tier === 'external-hdd'))
  })

  it('collector createObserver exposes getSummary and getAdvice', () => {
    const { createObserver } = require('../src/collector.cjs')
    const obs = createObserver({ mode: 'light' })
    obs.record('ipc-handle', {
      channel: 'test:ping',
      ok: true,
      durationMs: 2,
      bytesOut: 10,
      storageTier: 'internal-nvme',
    })

    const summary = obs.getSummary()
    assert.equal(typeof summary, 'object')
    assert.equal(summary.channels['test:ping'].calls, 1)
    assert.ok(summary.storageTiers['internal-nvme'])
    assert.equal(summary.storageTiers['internal-nvme'].calls, 1)

    const advice = obs.getAdvice()
    assert.ok(Array.isArray(advice))
  })
})
