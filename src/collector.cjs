'use strict'

// Bounded, loss-aware event collector with an optional private JSONL sink.
// Mode 'off' records nothing and opens no sink. Overflow is recorded once and
// then makes the session unusable instead of silently dropping evidence.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { SCHEMA_VERSION, MODES, validateEvent } = require('./schema.cjs')

const OBSERVER_VERSION = '0.0.0'

function createObserver({
  mode = 'light',
  sink,
  sessionId = `session-${crypto.randomUUID()}`,
  maxEvents = 2048,
  now = () => performance.now(),
} = {}) {
  if (!MODES.has(mode)) throw new Error('Invalid observer mode')
  if (!Number.isInteger(maxEvents) || maxEvents < 4) throw new Error('Invalid observer event limit')
  const events = []
  let ordinal = 0
  let overflowed = false
  const sinkPath = mode === 'off' || !sink ? null : path.resolve(sink)
  if (sinkPath) {
    fs.mkdirSync(path.dirname(sinkPath), { recursive: true, mode: 0o700 })
    fs.writeFileSync(sinkPath, '', { flag: 'wx', mode: 0o600 })
  }
  const write = (event) => {
    events.push(event)
    if (sinkPath) fs.appendFileSync(sinkPath, `${JSON.stringify(event)}\n`)
  }
  const build = (kind, fields) =>
    validateEvent({
      schemaVersion: SCHEMA_VERSION,
      eventId: `event:${sessionId}:${++ordinal}`.slice(0, 160),
      sessionId,
      clockId: 'clock:monotonic',
      monotonicMs: now(),
      kind,
      ...fields,
      sanitized: true,
    })
  const observer = {
    mode,
    sessionId,
    record(kind, fields = {}) {
      if (mode === 'off') return undefined
      if (overflowed) throw new Error('Observer overflowed')
      if (events.length >= maxEvents - 1) {
        overflowed = true
        write(build('overflow', {}))
        throw new Error('Observer overflowed')
      }
      const event = build(kind, fields)
      write(event)
      return event
    },
    get events() {
      return events.slice()
    },
    summary() {
      const byKind = {}
      for (const event of events) byKind[event.kind] = (byKind[event.kind] || 0) + 1
      return { mode, events: events.length, byKind, overflowed }
    },
    finalize() {
      if (overflowed) throw new Error('Observer overflowed')
      return observer.summary()
    },
  }
  if (mode !== 'off') observer.record('session', { mode, observerVersion: OBSERVER_VERSION })
  return observer
}

module.exports = { createObserver, OBSERVER_VERSION }
