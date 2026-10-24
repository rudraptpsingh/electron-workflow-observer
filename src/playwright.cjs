'use strict'

// Playwright-side attachment. Takes an ElectronApplication and Page from the
// caller, so this package does not depend on a Playwright version.
const { sampleMemory } = require('./memory.cjs')
const { evaluateBudget } = require('./advisor.cjs')

async function attachObserver({ electronApp, page, observer }) {
  if (observer.mode === 'off') {
    return {
      mark() {},
      async sampleProcess() {},
      async sampleMemory() {},
      async observeAction(action) {
        return action()
      },
      async detach() {},
    }
  }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const deep = observer.mode === 'deep'
  if (deep) await cdp.send('Profiler.enable')
  return {
    mark(label) {
      observer.record('mark', { label })
    },
    async sampleProcess() {
      const metrics = await electronApp.evaluate(({ app }) =>
        app.getAppMetrics().map((m) => ({
          cpu: m.cpu.percentCPUUsage,
          workingSet: m.memory.workingSetSize,
        }))
      )
      observer.record('process-metrics', {
        processCount: metrics.length,
        cpuPercent: Math.round(metrics.reduce((sum, m) => sum + (m.cpu || 0), 0) * 10) / 10,
        workingSetKB: Math.round(metrics.reduce((sum, m) => sum + (m.workingSet || 0), 0)),
      })
    },
    async sampleMemory() {
      const sample = sampleMemory((await cdp.send('Performance.getMetrics')).metrics)
      if (sample) observer.record('memory', sample)
    },
    /** Light: runs the action unchanged. Deep: summarises a V8 CPU profile of it. */
    async observeAction(action) {
      if (!deep) return action()
      await cdp.send('Profiler.start')
      try {
        return await action()
      } finally {
        const { profile } = await cdp.send('Profiler.stop')
        // Only counts leave the process; function names and URLs stay in the profile object.
        observer.record('cpu-profile', {
          sampleCount: (profile.samples || []).length,
          durationMs: Math.max(0, Math.round((profile.endTime - profile.startTime) / 1000)),
          nodeCount: (profile.nodes || []).length,
        })
      }
    },
    async detach() {
      await cdp.detach().catch(() => {})
    },
  }
}

/** Playwright `test.extend` fixture definition; the caller supplies the app. */
function observerFixture({ mode = 'light', createObserver } = {}) {
  return async ({}, use, testInfo) => {
    const observer = createObserver({ mode, sink: testInfo.outputPath('observer.jsonl') })
    await use(observer)
    testInfo.annotations.push({
      type: 'observer',
      description: JSON.stringify(observer.finalize()),
    })
  }
}

/**
 * Enforce performance budgets in Playwright CI tests.
 * Throws an assertion error if any budget is violated.
 */
function assertBudget(observer, budgetOptions = {}) {
  const result = evaluateBudget(observer.events, budgetOptions)
  if (!result.passed) {
    const details = result.violations.map((v) => `  - ${v.message}`).join('\n')
    throw new Error(`Performance Budget Regression in CI:\n${details}`)
  }
  return result
}

module.exports = { attachObserver, observerFixture, assertBudget }
