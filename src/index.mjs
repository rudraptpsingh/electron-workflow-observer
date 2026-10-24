import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cjs = require('./index.cjs')

export const {
  SCHEMA_VERSION,
  KIND_FIELDS,
  OPTIONAL_FIELDS,
  MODES,
  validateEvent,
  isLabel,
  redactUrl,
  createObserver,
  OBSERVER_VERSION,
  wrapIpcHandle,
  observeIpcMain,
  estimateSize,
  installMainPerfTrace,
  sampleMemory,
  diffMemory,
  attachObserver,
  observerFixture,
  assertBudget,
  evaluateBudget,
  generateAdvice,
  formatMarkdownSummary,
  generateHtmlReport,
  injectPerfHud,
} = cjs

export default cjs
