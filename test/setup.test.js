'use strict'

const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { setupWorkflowObserver } = require('../src/setup.cjs')

describe('setupWorkflowObserver', () => {
  const tmpDirs = []
  const createTmpDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-test-'))
    tmpDirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      try {
        fs.rmSync(d, { recursive: true, force: true })
      } catch {}
    }
  })

  const createMockIpc = () => {
    const handlers = new Map()
    return {
      handlers,
      handle(channel, listener) {
        handlers.set(channel, listener)
      },
      async invoke(channel, ...args) {
        const fn = handlers.get(channel)
        if (!fn) throw new Error('Channel not found: ' + channel)
        return fn({}, ...args)
      },
    }
  }

  it('initializes observer and auto-exports html on stop', async () => {
    const tmp = createTmpDir()
    const sink = path.join(tmp, 'diagnostics', 'workflow.jsonl')
    const ipcMain = createMockIpc()
    let quitListener = null
    const app = {
      isPackaged: false,
      getName: () => 'TestApp',
      on(event, listener) {
        if (event === 'will-quit') quitListener = listener
      },
    }

    const instance = setupWorkflowObserver({
      app,
      ipcMain,
      sink,
      silent: true,
      htmlReport: true,
    })

    assert.ok(instance.observer)
    assert.ok(instance.tracer)

    // Register a handler and invoke it
    ipcMain.handle('test:ping', async () => {
      return { pong: true }
    })

    const res = await ipcMain.invoke('test:ping')
    assert.deepEqual(res, { pong: true })

    // Simulate quit
    assert.ok(typeof quitListener === 'function')
    await instance.stop()

    const htmlPath = sink.replace(/\.jsonl$/, '.html')
    assert.ok(fs.existsSync(sink), 'JSONL sink should exist')
    assert.ok(fs.existsSync(htmlPath), 'HTML report should be generated on quit/stop')

    const html = fs.readFileSync(htmlPath, 'utf8')
    assert.ok(html.includes('TestApp Performance Profile'))
    assert.ok(html.includes('test:ping'))
  })

  it('throws helpful error if ipcMain is missing', () => {
    assert.throws(
      () => {
        setupWorkflowObserver({ app: {}, ipcMain: null })
      },
      {
        message: /ipcMain is required/,
      }
    )
  })
})
