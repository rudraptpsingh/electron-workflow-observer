# electron-workflow-observer

[![npm version](https://img.shields.io/npm/v/electron-workflow-observer.svg)](https://www.npmjs.com/package/electron-workflow-observer)
[![license](https://img.shields.io/npm/l/electron-workflow-observer.svg)](https://github.com/rudraptpsingh/electron-workflow-observer/blob/main/LICENSE)
[![CI](https://github.com/rudraptpsingh/electron-workflow-observer/actions/workflows/ci.yml/badge.svg)](https://github.com/rudraptpsingh/electron-workflow-observer/actions)

> **App-neutral, privacy-preserving performance profiling and workflow observation for Electron.**
> 
> Tracks IPC latency and payload sizes, pinpoints main-process event loop stalls with active blockers, samples Chromium renderer memory via CDP, provides drop-in Playwright fixtures, and enforces CI performance budgets with interactive waterfall timeline reports. Zero runtime dependencies.

---

## The Problem with Electron Profiling Today

1. **The Main-Process Blindspot:** Standard Chromium DevTools only measures the renderer. When an Electron app beachballs or stutters, the root cause is almost always synchronous disk I/O, native module calls, or heavy computation blocking Node's main event loop.
2. **APM Privacy Risks:** Commercial APM agents (Datadog, Sentry, New Relic) intercept full IPC arguments, user payloads, error traces, and filesystem paths. Shipping these diagnostics in desktop environments (photo editors, healthcare, enterprise, creative tools) violates privacy policies.
3. **Heavy Instrumentation Lag:** Traditional profilers monkeypatch entire runtimes, introducing the very latency they attempt to observe.
4. **No Performance Regression Gates in CI:** Teams typically write Playwright E2E tests for *functional correctness*, but performance regressions (e.g., an IPC handler slowing from 15ms to 120ms or freezing the event loop) slip through unnoticed into production.

---

## Key Features

- ⚡ **Zero Runtime Dependencies:** Pure Node.js & standard Electron APIs.
- 🔒 **Strict Privacy Contract:** Rejects filesystem paths, URLs, and arbitrary payloads. Only records opaque IDs, channel labels, boolean outcomes, payload bytes, and durations.
- ⏱️ **Main-Thread Stall & Freeze Detector:** Heartbeat timer tracks event loop delays and names the exact in-flight IPC handlers that overlapped the freeze.
- 📦 **IPC Payload Size Bins:** Measures approximate response bytes (`bytesOut`) without capturing or leaking user content.
- 🧠 **CDP Memory Profiling:** Connects to Chrome DevTools Protocol to query `Performance.getMetrics` for real JS heap size, DOM node count, and listener leaks.
- 🎭 **Playwright CI Assertions:** Built-in `assertBudget(observer, options)` helper to fail tests immediately on latency or stall regressions.
- 🌊 **Interactive Waterfall Timeline:** Single-command standalone HTML waterfall visualizer (`export-html`) showing concurrent IPC calls, stalls, and payload sizes with zero CDN requests.
- 💡 **Smart Optimization Advisor:** Prescriptive suggestions detecting Chatty IPC loops, main-thread blockers, and DOM/heap bloat.
- 📊 **CLI Budget Enforcer:** `assert-budget` command with `$GITHUB_STEP_SUMMARY` markdown integration for CI.

---

## Quickstart

Install the package:

```bash
npm install electron-workflow-observer
```

### 1. Main Process: Observe IPC Latency & Settled Outcomes

Wrap your `ipcMain` in one line before registering handlers:

```javascript
// main.js
const { app, ipcMain } = require('electron')
const { createObserver, observeIpcMain } = require('electron-workflow-observer')

// Create an observer session writing to a private local log
const observer = createObserver({
  mode: 'light',
  sink: './diagnostics/workflow-run.jsonl',
})

// Automatically measures duration, channel, success/failure, and payload size
observeIpcMain(ipcMain, observer)

ipcMain.handle('files:loadProject', async (event, projectId) => {
  return await loadProjectFromDisk(projectId)
})
```

---

### 2. Main Process: Event-Loop Freeze & Blocker Locator

Detect main-thread UI freezes and pinpoint the blocking handlers:

```javascript
const { installMainPerfTrace } = require('electron-workflow-observer')

// Starts a lightweight heartbeat timer
const tracer = installMainPerfTrace({
  ipc: ipcMain,
  observer,       // Optional: records 'main-stall' directly into observer log
  slowIpcMs: 250, // Flag any single IPC handler taking >= 250ms
  stallMs: 150,   // Detect event loop delays >= 150ms
  log: (line) => console.log(line), // Emits [PERF:trace] JSON entries
})

app.on('will-quit', async () => {
  await tracer.stop()
})
```

**Sample Output on Stall:**
```json
{
  "kind": "main-stall",
  "ms": 320,
  "endedAtMs": 1729765200100,
  "inflight": [
    { "channel": "fs:readRawDirectory", "runningMs": 318, "finished": true },
    { "channel": "analytics:ping", "runningMs": 10, "finished": false }
  ]
}
```
*(Notice how `fs:readRawDirectory` was identified as the 318ms blocker that caused the 320ms stall).*

---

### 3. Playwright E2E Integration & CI Budget Assertion

Catch performance regressions directly in your Playwright end-to-end tests:

```typescript
// e2e/performance.spec.ts
import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { createObserver, attachObserver, assertBudget } from 'electron-workflow-observer'

test('Export workflow adheres to IPC latency and memory budgets', async () => {
  const electronApp = await electron.launch({ args: ['.'] })
  const page = await electronApp.firstWindow()

  const observer = createObserver({ mode: 'light', sink: 'test-results/run.jsonl' })
  const attached = await attachObserver({ electronApp, page, observer })

  // 1. Mark and sample baseline memory
  attached.mark('before-export')
  await attached.sampleMemory()

  // 2. Execute user action
  await page.click('[data-testid="export-button"]')
  await page.waitForSelector('[data-testid="export-finished"]')

  // 3. Post-Action Memory
  attached.mark('after-export')
  await attached.sampleMemory()

  // 4. Assert Performance Budget in CI (Throws on regression!)
  assertBudget(observer, {
    maxStallMs: 100,       // Fail if main thread froze > 100ms
    maxStallCount: 0,      // Fail if any freeze occurred
    maxIpcMs: 50,          // Global limit for any IPC call
    maxFailures: 0,        // Zero failed IPC handlers allowed
    channelBudgets: {
      'project:save': { maxMs: 25 },
    },
  })

  await attached.detach()
  await electronApp.close()
})
```

---

### 4. Continuous Integration (CI / GitHub Actions)

Add performance regression gates and visual summaries directly into your GitHub Actions workflow:

```yaml
# .github/workflows/e2e-perf.yml
name: E2E Performance Gates

on: [push, pull_request]

jobs:
  performance:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Run E2E Workflow Tests
        run: npx playwright test

      # 1. Enforce performance budgets (Fails CI job if budgets are violated!)
      - name: Assert Performance Budget
        run: |
          npx electron-workflow-observer assert-budget test-results/run.jsonl \
            --max-stall=150 \
            --max-ipc=100 \
            --max-failures=0 \
            --github-summary

      # 2. Generate Interactive Waterfall Timeline
      - name: Generate Waterfall HTML
        if: always()
        run: npx electron-workflow-observer export-html test-results/run.jsonl -o test-results/waterfall.html

      # 3. Upload HTML Timeline Artifact
      - name: Upload Profile Artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: performance-waterfall
          path: test-results/waterfall.html
```

---

## Command Line Interface (CLI)

The package bundles a standalone CLI:

```bash
# 1. Validate log strictly satisfies privacy rules
npx electron-workflow-observer validate ./diagnostics/run.jsonl

# 2. Print visual performance table + Smart Advisor suggestions
npx electron-workflow-observer summarize ./diagnostics/run.jsonl --advisor

# 3. Enforce performance budget (exits 1 on regression)
npx electron-workflow-observer assert-budget ./diagnostics/run.jsonl --max-stall=150

# 4. Generate standalone interactive HTML timeline
npx electron-workflow-observer export-html ./diagnostics/run.jsonl -o ./report.html
```

### Visual Summary Output:

```text
=== Electron Workflow Observer Summary ===
Total Events: 142 | Overflowed: false

Event Types:
  - session: 1
  - mark: 4
  - memory: 4
  - ipc-handle: 133

IPC Handler Performance:
  IPC Channel           |  Calls  |  Failed  |  P50 (ms)  |  Max (ms)  |  Payload
  ----------------------+---------+----------+------------+------------+---------
  raw:extractEmbedded   |     48  |       0  |        12  |       118  |  3.4 MB
  library:searchQuery   |     15  |       0  |         8  |        34  |   42 KB
  window:setAppearance  |      1  |       0  |         3  |         3  |    0 B
  db:saveMetadata       |     69  |       0  |         1  |         6  |   12 KB

💡 Optimization Suggestions:
  🟡 Chatty IPC pattern detected on 'db:saveMetadata' (69 calls)
     This channel was called 69 times with quick execution (<5ms). Consider batching requests into a single array payload to reduce contextBridge serialization overhead.
```

---

## Privacy Guarantee

Desktop applications frequently deal with sensitive user data (photos, medical records, financial files, private repositories). 

`electron-workflow-observer` enforces an **uncompromising privacy contract**:
1. **Never Captures Arguments or Payloads:** Function arguments, return values, exception stack traces, and IPC bodies never touch the collector.
2. **Path & URL Rejection:** If a channel or mark label contains something resembling a local filesystem path (`/Users/...`, `C:\...`) or URL query string, the validator **strictly rejects** the event without echoing the forbidden data in error logs.
3. **Restricted File Permissions:** Sinks are created exclusively with `0600` permissions (readable only by the process owner).
4. **Fail-Closed Bounding:** If an event flood occurs, the collector writes one `overflow` record and permanently refuses additional events rather than risking uncontrolled memory or disk exhaustion.

---

## API Reference

### `createObserver(options)`
- `mode`: `'off' | 'light' | 'deep'` (default: `'light'`)
- `sink`: Optional path to write private JSONL records.
- `maxEvents`: Maximum events before overflow protection activates (default: 2048).
- `sessionId`: Custom string identifier.

### `observeIpcMain(ipcMain, observer)`
Wraps all registered handlers on `ipcMain` to report timing, outcomes, and payload bytes.

### `installMainPerfTrace(options)`
- `ipc`: `ipcMain` object.
- `observer`: Optional `Observer` instance to record `main-stall` events directly.
- `slowIpcMs`: Threshold to emit `slow-ipc` (default: 500ms).
- `stallMs`: Threshold to emit `main-stall` (default: 200ms).
- `tickMs`: Heartbeat interval (default: 50ms).
- `cpuProfilePath`: Optional path to dump V8 `.cpuprofile` on exit.

### `attachObserver({ electronApp, page, observer })`
Attaches CDP performance metrics to an active Playwright page and Electron process.

### `assertBudget(observer, budgetOptions)`
Evaluates performance against specified budgets and throws an assertion error if violated.

### `generateHtmlReport(events, summary, options)`
Generates an interactive, zero-dependency HTML waterfall timeline.

### `injectPerfHud(options)`
Injects a floating real-time FPS and stall notification widget in the renderer (development mode).

---

## License

MIT © [Rudra Pratap Singh](https://github.com/rudraptpsingh)
