import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cjs = require('./index.cjs')

export const {
  SCHEMA_VERSION,
  KIND_FIELDS,
  MODES,
  validateEvent,
  isLabel,
  redactUrl,
  createObserver,
  OBSERVER_VERSION,
  wrapIpcHandle,
  observeIpcMain,
  installMainPerfTrace,
  sampleMemory,
  diffMemory,
  attachObserver,
  observerFixture,
} = cjs

export default cjs
