'use strict'

const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, statSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createObserver } = require('../src/collector.cjs')

describe('Event Collector & Storage', () => {
  const cleanups = []
  afterEach(() => {
    for (const p of cleanups.splice(0)) {
      try {
        rmSync(p, { recursive: true, force: true })
      } catch {}
    }
  })

  function makeTempDir() {
    const dir = mkdtempSync(join(tmpdir(), 'obs-test-'))
    cleanups.push(dir)
    return dir
  }

  it('mode off records nothing and does not open files', () => {
    const sink = join(makeTempDir(), 'test.jsonl')
    const obs = createObserver({ mode: 'off', sink })
    const res = obs.record('mark', { label: 'step-1' })
    assert.equal(res, undefined)
    assert.equal(obs.events.length, 0)
    assert.throws(() => readFileSync(sink))
  })

  it('records session event and user marks into memory and sink with 0600 permissions', () => {
    const sink = join(makeTempDir(), 'events.jsonl')
    const obs = createObserver({ mode: 'light', sink })
    obs.record('mark', { label: 'init' })
    obs.record('ipc-handle', { channel: 'db:query', ok: true, durationMs: 12 })

    assert.equal(obs.events.length, 3) // session + mark + ipc-handle
    const summary = obs.summary()
    assert.equal(summary.mode, 'light')
    assert.equal(summary.events, 3)
    assert.equal(summary.byKind.session, 1)
    assert.equal(summary.byKind.mark, 1)
    assert.equal(summary.byKind['ipc-handle'], 1)
    assert.equal(summary.overflowed, false)

    // Check disk content and permissions
    const content = readFileSync(sink, 'utf8').trim().split('\n')
    assert.equal(content.length, 3)

    const stats = statSync(sink)
    // 0o600 mode check (in octal & 0777)
    assert.equal(stats.mode & 0o777, 0o600)
  })

  it('handles overflow cleanly by emitting overflow event and refusing further records', () => {
    const sink = join(makeTempDir(), 'overflow.jsonl')
    const obs = createObserver({ mode: 'light', sink, maxEvents: 4 })

    // Already has 1 session event.
    obs.record('mark', { label: 'm1' }) // 2 events
    obs.record('mark', { label: 'm2' }) // 3 events
    // 4th event exceeds maxEvents - 1, triggering overflow event + throw
    assert.throws(
      () => obs.record('mark', { label: 'm3' }),
      /Observer overflowed/
    )

    const summary = obs.summary()
    assert.equal(summary.overflowed, true)
    assert.equal(summary.byKind.overflow, 1)

    // Subsequent calls fail immediately
    assert.throws(() => obs.record('mark', { label: 'm4' }), /Observer overflowed/)
    assert.throws(() => obs.finalize(), /Observer overflowed/)
  })
})
