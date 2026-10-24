'use strict'

// Versioned observer event contract. Events carry opaque IDs, labels, counts,
// booleans and durations only. There is no field for arguments, results,
// messages, paths, URLs or pixels, and unknown keys are rejected.
const SCHEMA_VERSION = 1
const ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/
// An IPC channel or mark label. Slashes are allowed inside a name but a value
// that looks like a filesystem path or URL is not.
const LABEL = /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,119}$/
const PATH_OR_URL = /(^|[\s"'])(\/|~\/)|[A-Za-z]:[\\/]|\\\\|\/\/|\.\.\//

const COMMON = [
  'schemaVersion',
  'eventId',
  'sessionId',
  'clockId',
  'monotonicMs',
  'kind',
  'sanitized',
]
const KIND_FIELDS = {
  session: { mode: 'mode', observerVersion: 'id' },
  mark: { label: 'label' },
  'ipc-handle': { channel: 'label', ok: 'boolean', durationMs: 'count' },
  'process-metrics': { processCount: 'count', cpuPercent: 'count', workingSetKB: 'count' },
  memory: {
    jsHeapUsedMB: 'count',
    jsHeapTotalMB: 'count',
    domNodes: 'count',
    jsEventListeners: 'count',
  },
  'cpu-profile': { sampleCount: 'count', durationMs: 'count', nodeCount: 'count' },
  overflow: {},
  error: { code: 'id' },
}
const MODES = new Set(['off', 'light', 'deep'])

function isLabel(value) {
  return typeof value === 'string' && LABEL.test(value) && !PATH_OR_URL.test(value)
}

function validateEvent(event) {
  // Never echo a rejected value: it may be exactly the private data being refused.
  const fail = (field) => {
    throw new Error(`Invalid observer event field: ${field}`)
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) fail('event')
  const fields = KIND_FIELDS[event.kind]
  if (!fields) fail('kind')
  for (const key of Object.keys(event))
    if (!COMMON.includes(key) && !Object.hasOwn(fields, key)) fail('unknown-key')
  if (event.schemaVersion !== SCHEMA_VERSION) fail('schemaVersion')
  if (event.sanitized !== true) fail('sanitized')
  for (const key of ['eventId', 'sessionId', 'clockId'])
    if (typeof event[key] !== 'string' || !ID.test(event[key])) fail(key)
  if (!Number.isFinite(event.monotonicMs) || event.monotonicMs < 0) fail('monotonicMs')
  for (const [key, type] of Object.entries(fields)) {
    const value = event[key]
    if (value === undefined) fail(key)
    if (type === 'count' && (!Number.isFinite(value) || value < 0)) fail(key)
    if (type === 'boolean' && typeof value !== 'boolean') fail(key)
    if (type === 'id' && (typeof value !== 'string' || !ID.test(value))) fail(key)
    if (type === 'label' && !isLabel(value)) fail(key)
    if (type === 'mode' && !MODES.has(value)) fail(key)
  }
  return event
}

/** Reduce a URL to its origin; anything else about a request can identify a person. */
function redactUrl(raw) {
  try {
    const url = new URL(raw)
    return /^https?:$/.test(url.protocol) ? url.origin : `${url.protocol}[resource]`
  } catch {
    return '[invalid-url]'
  }
}

module.exports = { SCHEMA_VERSION, KIND_FIELDS, MODES, validateEvent, isLabel, redactUrl }
