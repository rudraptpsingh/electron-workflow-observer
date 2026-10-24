# electron-workflow-observer

[![npm version](https://img.shields.io/npm/v/electron-workflow-observer.svg)](https://www.npmjs.com/package/electron-workflow-observer)
[![license](https://img.shields.io/npm/l/electron-workflow-observer.svg)](https://github.com/rudraptpsingh/electron-workflow-observer/blob/main/LICENSE)
[![CI](https://github.com/rudraptpsingh/electron-workflow-observer/actions/workflows/ci.yml/badge.svg)](https://github.com/rudraptpsingh/electron-workflow-observer/actions)

> **App-neutral, privacy-preserving performance profiling and workflow observation for Electron.**
> 
> Profile IPC latency and payload sizes, pinpoint main-process event loop stalls with active blockers, sample Chromium renderer memory via CDP, enforce CI performance budgets in Playwright, and inspect interactive offline waterfall timelines. Zero runtime dependencies.

---

## Why electron-workflow-observer?

| Profiler / APM | Main-Process Stalls | Privacy & PII | Runtime Overhead | CI Regression Gates |
| :--- | :--- | :--- | :--- | :--- |
| **Chromium DevTools** | ❌ Renderer only (blind to Node main thread) | ⚠️ Captures full URLs & network headers | High | ❌ Manual profiling only |
| **Sentry / Datadog / New Relic** | ⚠️ Generic APM crash reporting | ❌ Captures full IPC args, paths, error traces | Moderate to high | ❌ Production telemetry only |
| **electron-workflow-observer** | ✅ **Heartbeat locator attributes freezes to handlers** | 🔒 **Strict contract: Zero paths, Zero PII, Zero payloads** | ⚡ **<0.1ms overhead** | ✅ **Drop-in Playwright fixtures & CLI assert-budget** |

---

## ⚡ Quickstart: 1-Line Setup

Install the package:

```bash
npm install electron-workflow-observer
```

### In Your Electron Main Process (`main.js` / `main.ts`):

Add one line before registering your IPC handlers:

```javascript
// main.js
const { app, ipcMain } = require('electron')
const { setupWorkflowObserver } = require('electron-workflow-observer')

// 1-line setup: wraps IPC, detects event-loop stalls, and auto-exports waterfall report on quit!
setupWorkflowObserver({ app, ipcMain })

// Register your handlers as normal:
ipcMain.handle('files:loadProject', async (event, projectId) => {
  return await loadProjectFromDisk(projectId)
})
```

### What Happens Automatically:
1. **Zero-Overhead IPC Tracing:** Automatically records invocation duration, channel name, success/failure status, and response payload size (`bytesOut`).
2. **Main-Thread Freeze Detection:** A lightweight heartbeat timer detects event-loop delays and flags the exact IPC handlers that caused the freeze.
3. **Automatic Waterfall Report on Quit:** When your app closes, an interactive, zero-dependency HTML waterfall timeline is saved to `./diagnostics/workflow.html`.
4. **Strict Privacy Contract:** Only records opaque IDs, channel labels, boolean outcomes, payload bytes, and durations. **Zero filesystem paths or customer data can ever leak.**

---

## 🌊 Interactive Waterfall & Grouped Profiler

Every run automatically produces a standalone, offline HTML profile (`workflow.html`):

- **Two-Column Split Layout:** A fixed left pane with monospace channel names, duration pills, payload sizes, and outcome badges, aligned 1:1 with an interactive Gantt timeline ruler.
- **Freeze Alert Banner:** Prominently highlights main-process UI freezes (e.g. `⚠️ Event loop stall: 72ms attributed to io:heavyChecksumScan`).
- **Grouped by Channel Tab:** Aggregates identical calls (e.g. 35 rapid culling keypresses), displaying Call Count, Total Time, Average Duration, P95, and a visual `% of Total IPC Time` progress bar. Flags "Chatty IPC" loops.
- **External Duration Labels:** Sub-millisecond bars are never squished or truncated into unreadable pills—labels render cleanly outside narrow bars.
- **Instant Search & Filter:** Filter calls by channel name in real time.
- **Air-Gapped & Offline:** Zero external CDN requests or remote fonts. 100% self-contained.

---

## 🎭 CI Regression Gates & Playwright Testing

Prevent performance regressions before code merges into `main`. Assert latency budgets directly in Playwright E2E tests:

```typescript
// e2e/performance.spec.ts
import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { createObserver, attachObserver, assertBudget } from 'electron-workflow-observer'

test('Import workflow adheres to latency and freeze budgets', async () => {
  const electronApp = await electron.launch({ args: ['.'] })
  const page = await electronApp.firstWindow()

  const observer = createObserver({ mode: 'light', sink: 'test-results/run.jsonl' })
  const attached = await attachObserver({ electronApp, page, observer })

  // 1. Mark baseline & sample renderer memory via CDP
  attached.mark('before-import')
  await attached.sampleMemory()

  // 2. Perform user action
  await page.click('[data-testid="import-button"]')
  await page.waitForSelector('[data-testid="import-finished"]')

  // 3. Sample post-action memory
  attached.mark('after-import')
  await attached.sampleMemory()

  // 4. Assert Performance Budget in CI (Throws and fails CI on regression!)
  assertBudget(observer, {
    maxStallMs: 80,        // Fail if main thread froze > 80ms
    maxStallCount: 0,       // Fail if any UI freeze occurred
    maxIpcMs: 50,           // Fail if any single IPC call took > 50ms
    maxFailures: 0,         // Zero failed handlers allowed
    channelBudgets: {
      'project:loadShoot': { maxMs: 30 },
    },
  })

  await attached.detach()
  await electronApp.close()
})
```

---

## 🚀 GitHub Actions Integration

Add performance regression checks and markdown summaries to your PR workflow:

```yaml
# .github/workflows/e2e-perf.yml
name: E2E Performance Gates

on: [push, pull_request]

jobs:
  performance-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          
      - run: npm ci
      - run: npx playwright test e2e/performance.spec.ts

      # Enforce budget on diagnostic log
      - name: Enforce Workflow Budgets
        run: |
          npx electron-workflow-observer assert-budget \
            --sink test-results/run.jsonl \
            --max-stall-ms 80 \
            --max-ipc-ms 50 \
            --github-summary

      # Export interactive waterfall artifact
      - name: Export Waterfall Timeline
        if: always()
        run: |
          npx electron-workflow-observer export-html \
            --sink test-results/run.jsonl \
            --out test-results/waterfall.html

      - name: Upload Waterfall Artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: performance-waterfall
          path: test-results/waterfall.html
```

---

## 🛠️ CLI Reference

The package ships with a self-contained CLI for CI environments:

```bash
# Validate that a JSONL log satisfies the strict privacy schema
npx electron-workflow-observer validate --sink ./diagnostics/workflow.jsonl

# Generate an ASCII terminal summary of channels and latency percentiles
npx electron-workflow-observer summarize --sink ./diagnostics/workflow.jsonl

# Assert performance budgets and exit 1 on regression
npx electron-workflow-observer assert-budget \
  --sink ./diagnostics/workflow.jsonl \
  --max-stall-ms 80 \
  --max-ipc-ms 50 \
  --github-summary

# Export the interactive standalone HTML waterfall report
npx electron-workflow-observer export-html \
  --sink ./diagnostics/workflow.jsonl \
  --out ./diagnostics/waterfall.html
```

---

## 🧩 Advanced Modular APIs

If you need fine-grained control beyond `setupWorkflowObserver`, use the low-level modules:

### `createObserver(options)`
Creates a bounded event collector writing to memory and a secure `0600` file.

### `observeIpcMain(ipcMain, observer)`
Wraps all `ipcMain.handle` calls to record `ipc-handle` events into the observer.

### `installMainPerfTrace(options)`
Starts the main-thread event loop heartbeat timer to detect stalls and identify overlapping handlers.

### `attachObserver({ electronApp, page, observer })`
Hooks CDP into Chromium renderer to sample `jsHeapUsedMB`, `domNodes`, and listener counts.

### `evaluateBudget(events, options)` & `generateAdvice(events, summary)`
Runs budget verification and produces prescriptive optimization advice (Chatty IPC, Long Handlers, Memory Leaks).

### `injectPerfHud()`
Overlays a live, translucent developer HUD on your Electron windows displaying real-time FPS and event-loop stalls.

---

## 🔒 Privacy & Data Minimization Guarantee

Desktop applications handle sensitive customer files (RAW photography, medical scans, financial records, client secrets). 

`electron-workflow-observer` enforces a strict schema contract:
- **No Path Data:** Any event field containing filesystem path separators (`/` or `\`) or drive letters is rejected.
- **No URLs:** Any web URL is automatically stripped down to its origin (`https://api.example.com`).
- **No Arbitrary Payloads:** Arguments passed across IPC are never logged. Only the approximate byte size (`bytesOut`) is computed.
- **Fail-Closed Logs:** Logs are created with exclusive `0600` POSIX permissions (readable only by the local user process).

---

## License

MIT © Rudra Pratap Singh
