'use strict'

// App-side hook for the Electron main process. It wraps ipcMain.handle so every
// handler reports channel, outcome and duration after it actually settles.
// Arguments, return values and errors never reach the callback.
//
// Optional `onStart({ channel }, event)` runs before the handler; whatever it
// returns is handed back as onComplete's third argument, so a caller can track
// which handlers are in flight (e.g. to name what was running during a stall).

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
      const report = (ok) => {
        try {
          onComplete(
            { channel, ok, durationMs: Math.round(performance.now() - started) },
            event,
            token
          )
        } catch {
          /* observation must never change the handler's behaviour */
        }
      }
      try {
        const value = await listener(event, ...args)
        report(true)
        return value
      } catch (error) {
        report(false)
        throw error
      }
    })
  return ipc
}

/** Record every later-registered handler's completion into an observer. */
function observeIpcMain(ipc, observer) {
  return wrapIpcHandle(ipc, (receipt) => observer.record('ipc-handle', receipt))
}

module.exports = { wrapIpcHandle, observeIpcMain }
