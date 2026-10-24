'use strict'

const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { main, summarize, readEvents } = require('../bin/cli.cjs')

describe('CLI Commands & Reporting', () => {
  const cleanups = []
  afterEach(() => {
    for (const p of cleanups.splice(0)) {
      try {
        rmSync(p, { recursive: true, force: true })
      } catch {}
    }
  })

  function makeTempDir() {
    const dir = mkdtempSync(join(tmpdir(), 'cli-test-'))
    cleanups.push(dir)
    return dir
  }

  const validJsonl = [
    JSON.stringify({
      schemaVersion: 1,
      eventId: 'ev:1',
      sessionId: 'sess:1',
      clockId: 'clock:monotonic',
      monotonicMs: 10,
      kind: 'session',
      mode: 'light',
      observerVersion: '0.1.0',
      sanitized: true,
    }),
    JSON.stringify({
      schemaVersion: 1,
      eventId: 'ev:2',
      sessionId: 'sess:1',
      clockId: 'clock:monotonic',
      monotonicMs: 25,
      kind: 'ipc-handle',
      channel: 'window:minimize',
      ok: true,
      durationMs: 4,
      sanitized: true,
    }),
    JSON.stringify({
      schemaVersion: 1,
      eventId: 'ev:3',
      sessionId: 'sess:1',
      clockId: 'clock:monotonic',
      monotonicMs: 40,
      kind: 'ipc-handle',
      channel: 'db:readLargeTable',
      ok: false,
      durationMs: 120,
      sanitized: true,
    }),
  ].join('\n')

  it('reads and summarizes events accurately', () => {
    const filePath = join(makeTempDir(), 'events.jsonl')
    writeFileSync(filePath, validJsonl)

    const events = readEvents(filePath)
    assert.equal(events.length, 3)

    const summary = summarize(events)
    assert.equal(summary.events, 3)
    assert.equal(summary.channels['window:minimize'].calls, 1)
    assert.equal(summary.channels['window:minimize'].maxMs, 4)
    assert.equal(summary.channels['db:readLargeTable'].failed, 1)
    assert.equal(summary.channels['db:readLargeTable'].maxMs, 120)
  })

  it('cli main validate command succeeds on valid file', () => {
    const filePath = join(makeTempDir(), 'valid.jsonl')
    writeFileSync(filePath, validJsonl)

    const exitCode = main(['validate', filePath, '--json'])
    assert.equal(exitCode, 0)
  })

  it('cli main validate rejects invalid JSON or invalid schema', () => {
    const filePath = join(makeTempDir(), 'invalid.jsonl')
    writeFileSync(filePath, 'not json\n')

    const exitCode = main(['validate', filePath, '--json'])
    assert.equal(exitCode, 1)
  })

  it('cli main summarize outputs formatted report with exit 0', () => {
    const filePath = join(makeTempDir(), 'valid.jsonl')
    writeFileSync(filePath, validJsonl)

    const exitCode = main(['summarize', filePath])
    assert.equal(exitCode, 0)
  })

  it('cli main assert-budget passes when within limits', () => {
    const filePath = join(makeTempDir(), 'budget.jsonl')
    writeFileSync(filePath, validJsonl)

    const exitCode = main(['assert-budget', filePath, '--max-stall=200', '--max-ipc=200', '--max-failures=2'])
    assert.equal(exitCode, 0)
  })

  it('cli main assert-budget fails and exits 1 on performance regression', () => {
    const filePath = join(makeTempDir(), 'regression.jsonl')
    writeFileSync(filePath, validJsonl)

    // db:readLargeTable takes 120ms, so max-ipc=50 should fail
    const exitCode = main(['assert-budget', filePath, '--max-ipc=50'])
    assert.equal(exitCode, 1)
  })

  it('cli main export-html generates interactive waterfall file', () => {
    const tempDir = makeTempDir()
    const jsonlPath = join(tempDir, 'timeline.jsonl')
    const htmlPath = join(tempDir, 'timeline.html')
    writeFileSync(jsonlPath, validJsonl)

    const exitCode = main(['export-html', jsonlPath, '-o', htmlPath])
    assert.equal(exitCode, 0)
    assert.ok(require('node:fs').existsSync(htmlPath))
  })
})
