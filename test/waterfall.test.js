'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { generateHtmlReport, formatMs, formatBytes } = require('../src/waterfall.cjs')

describe('Interactive Waterfall HTML Generator', () => {
  const events = [
    {
      kind: 'session',
      mode: 'light',
      monotonicMs: 100,
      schemaVersion: 1,
      sanitized: true,
      sessionId: 'sess_12345',
      clockId: 'clk',
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
      sessionId: 'sess_12345',
      clockId: 'clk',
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
      sessionId: 'sess_12345',
      clockId: 'clk',
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

  it('generates a complete offline standalone HTML report with two-column layout and stall alerts', () => {
    const html = generateHtmlReport(events, summary, { title: 'Test Profile' })
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes('Test Profile'))
    assert.ok(html.includes('Waterfall Timeline'))
    assert.ok(html.includes('Grouped by Channel'))
    assert.ok(html.includes('left-pane'))
    assert.ok(html.includes('timeline-pane'))
    assert.ok(html.includes('test:ping'))
    assert.ok(html.includes('stall-banner'))
    assert.ok(html.includes('stall-zone'))
    assert.doesNotMatch(html, /https?:\/\//) // 0 external network/CDN requests
  })

  it('formats milliseconds and byte sizes accurately', () => {
    assert.equal(formatMs(0.42), '0.42ms')
    assert.equal(formatMs(5.6), '5.6ms')
    assert.equal(formatMs(85), '85ms')
    assert.equal(formatBytes(0), '—')
    assert.equal(formatBytes(512), '512 B')
    assert.equal(formatBytes(2048), '2.0 KB')
  })
})
