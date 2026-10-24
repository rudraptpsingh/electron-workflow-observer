'use strict'

const path = require('node:path')
const fs = require('node:fs')
const { createObserver } = require('./collector.cjs')
const { installMainPerfTrace } = require('./stall-detector.cjs')
const { generateHtmlReport } = require('./waterfall.cjs')
const { injectPerfHud } = require('./hud.cjs')

/**
 * Ultra-simple 1-line setup for Electron applications.
 * Automatically initializes IPC tracking, event-loop stall detection,
 * and generates an interactive waterfall timeline report upon app quit.
 *
 * @example
 * // In your main.js / main.ts:
 * const { app, ipcMain } = require('electron')
 * const { setupWorkflowObserver } = require('electron-workflow-observer')
 *
 * setupWorkflowObserver({ app, ipcMain })
 *
 * // Or with zero arguments if electron is installed in runtime:
 * setupWorkflowObserver()
 */
function setupWorkflowObserver(options = {}) {
  let {
    app = options.app,
    ipcMain = options.ipcMain,
    mode = process.env.WORKFLOW_OBSERVER_MODE || 'light',
    sink = process.env.WORKFLOW_OBSERVER_SINK,
    htmlReport = true,
    slowIpcMs = 150,
    stallMs = 100,
    maxEvents = 8192,
    hud = process.env.WORKFLOW_OBSERVER_HUD === '1',
    silent = process.env.NODE_ENV === 'test',
  } = options

  // Auto-detect electron if not passed explicitly
  if (!ipcMain) {
    try {
      const electron = require('electron')
      if (electron) {
        if (!app) app = electron.app
        ipcMain = electron.ipcMain
      }
    } catch {}
  }

  if (!ipcMain) {
    throw new Error(
      'electron-workflow-observer: ipcMain is required in setupWorkflowObserver({ app, ipcMain })'
    )
  }

  // Determine intelligent default sink path
  let sinkPath = sink
  if (!sinkPath) {
    let baseDir = path.join(process.cwd(), 'diagnostics')
    if (app && typeof app.getPath === 'function') {
      try {
        baseDir = app.isPackaged
          ? path.join(app.getPath('userData'), 'diagnostics')
          : path.join(process.cwd(), 'diagnostics')
      } catch {}
    }
    sinkPath = path.join(baseDir, 'workflow.jsonl')
  }

  // Ensure parent directory exists
  if (sinkPath) {
    try {
      const dir = path.dirname(sinkPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      if (fs.existsSync(sinkPath)) {
        fs.rmSync(sinkPath, { force: true })
      }
    } catch {}
  }

  const observer = createObserver({
    mode,
    sink: sinkPath,
    maxEvents,
  })

  // Start stall detector with observer attached
  const tracer = installMainPerfTrace({
    ipc: ipcMain,
    observer,
    slowIpcMs,
    stallMs,
  })

  // Optional Performance HUD
  let hudInstance = null
  if (hud) {
    hudInstance = injectPerfHud()
  }

  const exportHtml = (outPath) => {
    const summary = observer.summary()
    const html = generateHtmlReport(observer.events, summary, {
      title: (app && typeof app.getName === 'function' ? app.getName() : 'Electron') + ' Performance Profile',
    })
    if (outPath) {
      try {
        const dir = path.dirname(outPath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(outPath, html, 'utf8')
      } catch {}
    }
    return html
  }

  let flushed = false
  const flush = async () => {
    if (flushed) return
    flushed = true

    await tracer.stop()
    if (hudInstance) hudInstance.destroy()

    if (htmlReport && sinkPath) {
      try {
        const htmlPath = sinkPath.replace(/\.jsonl$/, '.html')
        exportHtml(htmlPath)
        if (!silent) {
          console.log(`\n⚡ [electron-workflow-observer] Waterfall report saved -> ${htmlPath}`)
        }
      } catch {}
    }
  }

  // Auto teardown and report generation on app quit
  if (app && typeof app.on === 'function') {
    app.on('will-quit', () => {
      void flush()
    })
  }

  if (!silent && sinkPath) {
    const htmlTarget = sinkPath.replace(/\.jsonl$/, '.html')
    const displayPath = path.isAbsolute(htmlTarget) ? path.relative(process.cwd(), htmlTarget) || htmlTarget : htmlTarget
    console.log(`⚡ [electron-workflow-observer] Recording active -> ${displayPath} on quit`)
  }

  return {
    observer,
    tracer,
    hud: hudInstance,
    stop: flush,
    exportHtml,
  }
}

module.exports = {
  setupWorkflowObserver,
}
