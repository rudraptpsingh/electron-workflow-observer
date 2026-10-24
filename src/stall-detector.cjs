'use strict'

const { writeFileSync } = require('node:fs')
const { Session } = require('node:inspector')
const { wrapIpcHandle } = require('./electron-main.cjs')

/**
 * Main-process trace for stall detection and performance investigations.
 *
 * Emits:
 *   - slow-ipc: a handler that took >= slowIpcMs
 *   - main-stall: event-loop timer delay >= stallMs, pinpointing every handler
 *     whose run overlapped the stall (active or recently finished)
 *   - cpu-profile: opt-in V8 profile of the main process during runs
 */
function installMainPerfTrace({
  ipc,
  observer = null,
  log = (line) => console.log(line),
  slowIpcMs = 500,
  stallMs = 200,
  tickMs = 50,
  cpuProfilePath = null,
  storageTierResolver = null,
  now = () => Date.now(),
}) {
  const emit = (payload) => {
    try {
      log(`[PERF:trace] ${JSON.stringify(payload)}`)
    } catch {
      /* tracing must never affect the app */
    }
  }

  let nextId = 0
  const inflight = new Map()
  const recent = []
  const RECENT_MAX = 200

  wrapIpcHandle(
    ipc,
    ({ channel, ok, durationMs, bytesOut, storageTier }, _event, id) => {
      const endedAtMs = now()
      const started = id != null ? inflight.get(id) : undefined
      if (id != null) inflight.delete(id)
      recent.push({
        channel,
        startedAtMs: started?.startedAtMs ?? endedAtMs - durationMs,
        endedAtMs,
      })
      if (recent.length > RECENT_MAX) recent.shift()
      if (durationMs >= slowIpcMs) {
        emit({ kind: 'slow-ipc', channel, ok, ms: durationMs, bytesOut, storageTier, startedAtMs: endedAtMs - durationMs })
      }
      if (observer) {
        try {
          const fields = { channel, ok, durationMs }
          if (bytesOut) fields.bytesOut = bytesOut
          if (storageTier) fields.storageTier = storageTier
          observer.record('ipc-handle', fields)
        } catch {
          /* observer may be bounded/off */
        }
      }
    },
    ({ channel }) => {
      const id = (nextId += 1)
      inflight.set(id, { channel, startedAtMs: now() })
      return id
    },
    storageTierResolver
  )

  let last = now()
  const timer = setInterval(() => {
    const at = now()
    const late = at - last - tickMs
    last = at
    if (late < stallMs) return
    const stallStartedAt = at - late
    const running = [...inflight.values()]
      .filter((call) => call.startedAtMs <= at)
      .map((call) => ({ channel: call.channel, runningMs: at - call.startedAtMs, finished: false }))
    const finished = recent
      .filter((call) => call.endedAtMs >= stallStartedAt && call.startedAtMs <= at)
      .map((call) => ({
        channel: call.channel,
        runningMs: call.endedAtMs - call.startedAtMs,
        finished: true,
      }))
    const allBlockers = [...running, ...finished]
    const topBlocker = allBlockers[0]?.channel

    emit({ kind: 'main-stall', ms: late, endedAtMs: at, inflight: allBlockers })

    if (observer) {
      try {
        const fields = { stallMs: Math.round(late), blockerCount: allBlockers.length }
        if (topBlocker) fields.topBlocker = topBlocker
        observer.record('main-stall', fields)
      } catch {
        /* best effort */
      }
    }
  }, tickMs)
  timer.unref?.()

  let profiler = null
  if (cpuProfilePath) {
    try {
      profiler = new Session()
      profiler.connect()
      profiler.post('Profiler.enable')
      profiler.post('Profiler.setSamplingInterval', { interval: 1000 })
      profiler.post('Profiler.start')
    } catch {
      profiler = null
    }
  }

  let stopped = false
  return {
    stop: () =>
      new Promise((resolve) => {
        if (stopped) return resolve()
        stopped = true
        clearInterval(timer)
        const session = profiler
        if (!session || !cpuProfilePath) return resolve()
        session.post('Profiler.stop', (err, result) => {
          try {
            if (!err && result?.profile)
              writeFileSync(cpuProfilePath, JSON.stringify(result.profile))
          } catch {
            /* best effort */
          }
          session.disconnect()
          resolve()
        })
      }),
  }
}

module.exports = { installMainPerfTrace }
