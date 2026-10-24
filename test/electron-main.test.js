'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { wrapIpcHandle, observeIpcMain } = require('../src/electron-main.cjs')
const { createObserver } = require('../src/collector.cjs')

function createFakeIpc() {
  const handlers = new Map()
  return {
    handlers,
    handle(channel, listener) {
      handlers.set(channel, listener)
    },
    async invoke(channel, ...args) {
      const fn = handlers.get(channel)
      if (!fn) throw new Error(`No handler for channel ${channel}`)
      return fn({}, ...args)
    },
  }
}

describe('Electron Main IPC Tracing', () => {
  it('preserves return values and reports successful completion', async () => {
    const ipc = createFakeIpc()
    const reports = []
    wrapIpcHandle(ipc, (receipt) => reports.push(receipt))

    ipc.handle('math:add', async (_e, a, b) => a + b)

    const result = await ipc.invoke('math:add', 2, 3)
    assert.equal(result, 5)
    assert.equal(reports.length, 1)
    assert.equal(reports[0].channel, 'math:add')
    assert.equal(reports[0].ok, true)
    assert.equal(typeof reports[0].durationMs, 'number')
  })

  it('preserves thrown errors and reports failed completion', async () => {
    const ipc = createFakeIpc()
    const reports = []
    wrapIpcHandle(ipc, (receipt) => reports.push(receipt))

    ipc.handle('auth:check', async () => {
      throw new Error('Access denied')
    })

    await assert.rejects(
      async () => ipc.invoke('auth:check'),
      /Access denied/
    )
    assert.equal(reports.length, 1)
    assert.equal(reports[0].channel, 'auth:check')
    assert.equal(reports[0].ok, false)
  })

  it('passes onStart token to onComplete', async () => {
    const ipc = createFakeIpc()
    const completedTokens = []
    wrapIpcHandle(
      ipc,
      (_receipt, _event, token) => completedTokens.push(token),
      ({ channel }) => ({ id: `token-${channel}` })
    )

    ipc.handle('data:fetch', async () => 'data')
    await ipc.invoke('data:fetch')

    assert.deepEqual(completedTokens, [{ id: 'token-data:fetch' }])
  })

  it('observeIpcMain records ipc-handle events into observer', async () => {
    const ipc = createFakeIpc()
    const obs = createObserver({ mode: 'light' })
    observeIpcMain(ipc, obs)

    ipc.handle('system:ping', async () => 'pong')
    await ipc.invoke('system:ping')

    const ipcEvents = obs.events.filter((e) => e.kind === 'ipc-handle')
    assert.equal(ipcEvents.length, 1)
    assert.equal(ipcEvents[0].channel, 'system:ping')
    assert.equal(ipcEvents[0].ok, true)
  })

  it('resolves and records storageTier when storageTierResolver is provided', async () => {
    const ipc = createFakeIpc()
    const reports = []
    const resolver = (channel, args) => args[0]?.startsWith('/Volumes/HDD') ? 'external-hdd' : 'internal-nvme'
    wrapIpcHandle(ipc, (receipt) => reports.push(receipt), null, resolver)

    ipc.handle('photo:read', async (_e, path) => ({ bytes: 100 }))
    await ipc.invoke('photo:read', '/Volumes/HDD/photo.jpg')

    assert.equal(reports.length, 1)
    assert.equal(reports[0].storageTier, 'external-hdd')
  })
})
