'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { generateHtmlReport } = require('../src/waterfall.cjs')

describe('Interactive Waterfall HTML Generator', () => {
  const events = [
    {
      kind: 'session',
      mode: 'light',
      monotonicMs: 100,
      schemaVersion: 1,
      sanitized: true,
      sessionId: 's',
      clockId: 'c',
      eventId: '1',
    },
    {
      kind: 'ipc-handle',
      channel: 'test:ping',
      ok: true,
      durationMs: 15,
      bytesOut: 50,
      monotonicMs: 120,
      schemaVersion: 1,
      sanitized: true,
      sessionId: 's',
      clockId: 'c',
      eventId: '2',
    },
    {
      kind: 'main-stall',
      stallMs: 180,
      blockerCount: 1,
      topBlocker: 'test:ping',
      monotonicMs: 200,
      schemaVersion: 1,
      sanitized: true,
      sessionId: 's',
      clockId: 'c',
      eventId: '3',
    },
  ]

  const summary = {
    events: events.length,
    overflowed: false,
    channels: {
      'test:ping': { calls: 1, failed: 0, p50Ms: 15, maxMs: 15, totalBytes: 50 },
    },
  }

  it('generates a complete offline standalone HTML report', () => {
    const html = generateHtmlReport(events, summary, { title: 'Test Profile' })
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes('Test Profile'))
    assert.ok(html.includes('Interactive Waterfall Chart'))
    assert.ok(html.includes('test:ping'))
    assert.ok(html.includes('stall-zone'))
    assert.doesNotMatch(html, /https?:\/\//) // 0 external network/CDN requests
  })
})
