# electron-workflow-observer

[![npm version](https://img.shields.io/npm/v/electron-workflow-observer.svg)](https://www.npmjs.com/package/electron-workflow-observer)
[![license](https://img.shields.io/npm/l/electron-workflow-observer.svg)](https://github.com/rudraptpsingh/electron-workflow-observer/blob/main/LICENSE)
[![CI](https://github.com/rudraptpsingh/electron-workflow-observer/actions/workflows/ci.yml/badge.svg)](https://github.com/rudraptpsingh/electron-workflow-observer/actions)

> **App-neutral, privacy-preserving performance profiling and workflow observation for Electron.**
> 
> Tracks IPC latency, pinpoints main-process event loop stalls, samples Chromium renderer memory via CDP, and provides drop-in Playwright fixtures for automated CI performance gates. Zero runtime dependencies.

---

## The Problem with Electron Profiling Today

1. **The Main-Process Blindspot:** Standard Chromium DevTools only measures the renderer. When an Electron app beachballs or stutters, the root cause is almost always synchronous disk I/O, native module calls, or heavy computation blocking Node's main event loop.
2. **APM Privacy Risks:** Commercial APM agents (Datadog, Sentry, New Relic) intercept full IPC arguments, user payloads, error traces, and filesystem paths. Shipping these diagnostics in desktop environments (photo editors, healthcare, enterprise, creative tools) violates privacy policies.
3. **Heavy Instrumentation Lag:** Traditional profilers monkeypatch entire runtimes, introducing the very latency they attempt to observe.
4. **Lack of Automated CI Assertions:** No standard tool exists to assert IPC budgets and memory leak regressions inside Playwright E2E tests before code merges.

---

## Key Features

- ⚡ **Zero Runtime Dependencies:** Pure Node.js & standard Electron APIs.
- 🔒 **Strict Privacy Contract:** Rejects filesystem paths, URLs, and arbitrary payloads. Only records opaque IDs, channel labels, boolean outcomes, and durations.
- ⏱️ **Main-Thread Stall & Freeze Detector:** Heartbeat timer tracks event loop delays and names the exact in-flight IPC handlers that overlapped the freeze.
- 🧠 **CDP Memory Profiling:** Connects to Chrome DevTools Protocol to query `Performance.getMetrics` for real JS heap size, DOM node count, and listener leaks.
- 🎭 **Playwright Test Fixtures:** Seamless `test.extend` integration to enforce latency and memory budgets in CI.
- 📊 **Built-in CLI & Visualizer:** Instant terminal ASCII performance tables and structured JSON reports.

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

// Automatically measures duration, channel, and success/failure of every IPC call
observeIpcMain(ipcMain, observer)

ipcMain.handle('files:loadProject', async (event, projectId) => {
  // Your normal business logic runs completely unchanged
  return await loadProjectFromDisk(projectId)
})
```

---

### 2. Main Process: Event-Loop Freeze & Stall Blocker Locator

Detect main-thread UI freezes and pinpoint the blocking handlers:

```javascript
const { installMainPerfTrace } = require('electron-workflow-observer')

// Starts a lightweight heartbeat timer
const tracer = installMainPerfTrace({
  ipc: ipcMain,
  slowIpcMs: 250, // Flag any single IPC handler taking >= 250ms
  stallMs: 150,   // Detect event loop delays >= 150ms
  log: (line) => console.log(line), // Emits [PERF:trace] JSON entries
})

// Clean up on app exit
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

### 3. Playwright E2E Integration (CI Performance Gates)

Catch performance regressions directly in your Playwright end-to-end tests:

```typescript
// e2e/performance.spec.ts
import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { createObserver, attachObserver, diffMemory } from 'electron-workflow-observer'

test('Export workflow adheres to IPC latency and memory budgets', async () => {
  const electronApp = await electron.launch({ args: ['.'] })
  const page = await electronApp.firstWindow()

  const observer = createObserver({ mode: 'light' })
  const attached = await attachObserver({ electronApp, page, observer })

  // 1. Baseline Memory
  attached.mark('before-export')
  await attached.sampleMemory()

  // 2. Execute user action
  await page.click('[data-testid="export-button"]')
  await page.waitForSelector('[data-testid="export-finished"]')

  // 3. Post-Action Memory
  attached.mark('after-export')
  await attached.sampleMemory()

  // 4. Assert Performance Budget
  const summary = observer.finalize()
  expect(summary.overflowed).toBe(false)

  // Enforce that save handlers never took more than 50ms
  const saveIpc = summary.channels['project:save']
  if (saveIpc) {
    expect(saveIpc.failed).toBe(0)
    expect(saveIpc.p50Ms).toBeLessThan(20)
    expect(saveIpc.maxMs).toBeLessThan(50)
  }

  await attached.detach()
  await electronApp.close()
})
```

---

## Command Line Interface (CLI)

The package bundles a standalone CLI to validate logs and generate performance breakdowns in CI:

```bash
# Validate log strictly satisfies the privacy contract
npx electron-workflow-observer validate ./diagnostics/workflow-run.jsonl

# Generate visual ASCII performance report
npx electron-workflow-observer summarize ./diagnostics/workflow-run.jsonl
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
  IPC Channel           |  Calls  |  Failed  |  P50 (ms)  |  Max (ms)
  ----------------------+---------+----------+------------+----------
  raw:extractEmbedded   |     48  |       0  |        12  |       118
  library:searchQuery   |     15  |       0  |         8  |        34
  window:setAppearance  |      1  |       0  |         3  |         3
  db:saveMetadata       |     69  |       0  |         1  |         6
```

Pass `--json` to integrate directly with automated CI dashboards or GitHub Action PR comments:

```bash
npx electron-workflow-observer summarize ./diagnostics/workflow-run.jsonl --json
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
Wraps all registered handlers on `ipcMain` to report timing and outcomes.

### `installMainPerfTrace(options)`
- `ipc`: `ipcMain` object.
- `slowIpcMs`: Threshold to emit `slow-ipc` (default: 500ms).
- `stallMs`: Threshold to emit `main-stall` (default: 200ms).
- `tickMs`: Heartbeat interval (default: 50ms).
- `cpuProfilePath`: Optional path to dump V8 `.cpuprofile` on exit.

### `attachObserver({ electronApp, page, observer })`
Attaches CDP performance metrics to an active Playwright page and Electron process.

### `diffMemory(beforeSample, afterSample)`
Computes heap, DOM node, and listener count differences between two measurements.

---

## License

MIT © [Rudra Pratap Singh](https://github.com/rudraptpsingh)
