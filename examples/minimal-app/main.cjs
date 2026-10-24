'use strict'

// Minimal unrelated Electron app for validating the observer. It has one
// window, one button and one IPC handler, and no knowledge of ShotSelect.
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const mode = process.env.OBSERVER_MODE || 'off'
let observer
if (mode !== 'off') {
  const { createObserver, observeIpcMain } = require('../../src/index.cjs')
  observer = createObserver({ mode, sink: process.env.OBSERVER_SINK })
  observeIpcMain(ipcMain, observer)
}

ipcMain.handle('sample:ping', async (_event, note) => ({ echoed: String(note).length }))
ipcMain.handle('sample:fail', async () => {
  throw new Error('sample failure with private detail')
})

app.on('window-all-closed', () => app.quit())
app.whenReady().then(() => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.loadFile(path.join(__dirname, 'index.html'))
})
