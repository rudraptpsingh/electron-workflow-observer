'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { validateEvent, redactUrl, isLabel } = require('../src/schema.cjs')

describe('Schema validation & Privacy Contract', () => {
  const base = {
    schemaVersion: 1,
    eventId: 'event:1',
    sessionId: 'session-1',
    clockId: 'clock:monotonic',
    monotonicMs: 10,
    kind: 'ipc-handle',
    channel: 'app:save',
    ok: true,
    durationMs: 5,
    sanitized: true,
  }

  it('accepts valid sanitized events', () => {
    assert.deepEqual(validateEvent(base), base)
  })

  it('rejects forbidden payloads, filesystem paths, and raw URLs', () => {
    const invalidCases = [
      { ...base, payload: 'SECRET_PAYLOAD' },
      { ...base, channel: '/Users/test/private.txt' },
      { ...base, channel: 'C:\\Users\\test\\data.arw' },
      { ...base, channel: 'https://api.example.com/login?token=SECRET' },
      { ...base, sanitized: false },
      { ...base, durationMs: Number.NaN },
      { ...base, kind: 'unknown-kind' },
      { ...base, schemaVersion: 2 },
    ]

    for (const bad of invalidCases) {
      assert.throws(
        () => validateEvent(bad),
        (err) => {
          assert.match(err.message, /^Invalid observer event field/)
          assert.doesNotMatch(err.message, /SECRET/)
          assert.doesNotMatch(err.message, /private/)
          return true
        }
      )
    }
  })

  it('correctly checks label rules', () => {
    assert.equal(isLabel('app:save'), true)
    assert.equal(isLabel('window/ready'), true)
    assert.equal(isLabel('/root/path'), false)
    assert.equal(isLabel('C:\\Windows'), false)
    assert.equal(isLabel('https://evil.com'), false)
  })

  it('redacts URLs down to origin only', () => {
    assert.equal(
      redactUrl('https://app.example.com/user/123?token=supersecret#hash'),
      'https://app.example.com'
    )
    assert.equal(redactUrl('http://localhost:3000/api/items'), 'http://localhost:3000')
    assert.equal(redactUrl('file:///path/to/file.png'), 'file:[resource]')
    assert.equal(redactUrl('invalid-url-string'), '[invalid-url]')
  })
})
