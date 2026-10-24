'use strict'

module.exports = {
  ...require('./schema.cjs'),
  ...require('./collector.cjs'),
  ...require('./electron-main.cjs'),
  ...require('./stall-detector.cjs'),
  ...require('./memory.cjs'),
  ...require('./playwright.cjs'),
  ...require('./advisor.cjs'),
  ...require('./waterfall.cjs'),
  ...require('./hud.cjs'),
  ...require('./setup.cjs'),
}
