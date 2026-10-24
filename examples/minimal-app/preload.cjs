'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sample', {
  ping: (note) => ipcRenderer.invoke('sample:ping', note),
  fail: () => ipcRenderer.invoke('sample:fail'),
})
