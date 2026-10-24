'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { installMainPerfTrace } = require('../src/stall-detector.cjs')

function createFakeIpc() {
  const handlers = new Map()
  return {
    handlers,
    handle(channel, listener) {
      handlers.set(channel, listener)
    },
    async invoke(channel, ...args) {
      const fn = handlers.get(channel)
      return fn({}, ...args)
    },
  }
}

const busy = (ms) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    /* block event loop synchronously */
  }
}

describe('Main Process Stall & Freeze Detector', () => {
  it('detects slow IPC handlers and event loop stalls with active blockers', async () => {
    const ipc = createFakeIpc()
    const traces = []
    const log = (line) => {
      if (line.startsWith('[PERF:trace] ')) {
        traces.push(JSON.parse(line.slice('[PERF:trace] '.length)))
      }
    }

    const tracer = installMainPerfTrace({
      ipc,
      log,
      slowIpcMs: 80,
      stallMs: 60,
      tickMs: 15,
    })

    ipc.handle('fast:calc', async () => 42)
    ipc.handle('blocking:io', async () => {
      busy(100) // blocks thread for 100ms
      return { done: true }
    })

    await ipc.invoke('fast:calc')
    await ipc.invoke('blocking:io')

    // Wait for the timer tick to catch the lag
    await new Promise((resolve) => setTimeout(resolve, 50))
    await tracer.stop()

    const slowIpc = traces.find((t) => t.kind === 'slow-ipc')
    assert.ok(slowIpc, 'Should detect slow-ipc')
    assert.equal(slowIpc.channel, 'blocking:io')
    assert.ok(slowIpc.ms >= 80)

    const stall = traces.find((t) => t.kind === 'main-stall')
    assert.ok(stall, 'Should detect main-stall')
    assert.ok(stall.ms >= 60)
    assert.ok(Array.isArray(stall.inflight))
    assert.ok(
      stall.inflight.some((call) => call.channel === 'blocking:io'),
      'Stall inflight blockers should identify blocking:io'
    )
  })
})
