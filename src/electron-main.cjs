'use strict'

// App-side hook for the Electron main process. It wraps ipcMain.handle so every
// handler reports channel, outcome, duration, and approximate payload size after it settles.
// Arguments, return values and errors never reach the callback.
//
// Optional `onStart({ channel }, event)` runs before the handler; whatever it
// returns is handed back as onComplete's third argument, so a caller can track
// which handlers are in flight (e.g. to name what was running during a stall).

function estimateSize(val) {
  if (val == null) return 0
  if (typeof val === 'string') return Buffer.byteLength(val, 'utf8')
  if (Buffer.isBuffer(val) || val instanceof Uint8Array || val instanceof ArrayBuffer) {
    return val.byteLength || val.length || 0
  }
  if (typeof val === 'object') {
    try {
      return Buffer.byteLength(JSON.stringify(val), 'utf8')
    } catch {
      return 0
    }
  }
  if (typeof val === 'number') return 8
  if (typeof val === 'boolean') return 4
  return 0
}

function wrapIpcHandle(ipc, onComplete, onStart) {
  const rawHandle = ipc.handle.bind(ipc)
  ipc.handle = (channel, listener) =>
    rawHandle(channel, async (event, ...args) => {
      const started = performance.now()
      let token
      if (onStart) {
        try {
          token = onStart({ channel }, event)
        } catch {
          /* observation must never change the handler's behaviour */
        }
      }
      const report = (ok, bytesOut = 0) => {
        try {
          onComplete(
            {
              channel,
              ok,
              durationMs: Math.round((performance.now() - started) * 100) / 100,
              bytesOut,
            },
            event,
            token
          )
        } catch {
          /* observation must never change the handler's behaviour */
        }
      }
      try {
        const value = await listener(event, ...args)
        const bytesOut = estimateSize(value)
        report(true, bytesOut)
        return value
      } catch (error) {
        report(false, 0)
        throw error
      }
    })
  return ipc
}

/** Record every later-registered handler's completion into an observer. */
function observeIpcMain(ipc, observer) {
  return wrapIpcHandle(ipc, (receipt) => observer.record('ipc-handle', receipt))
}

module.exports = { wrapIpcHandle, observeIpcMain, estimateSize }
