export type ObserverMode = 'off' | 'light' | 'deep'

export interface ObserverEvent {
  schemaVersion: 1
  eventId: string
  sessionId: string
  clockId: string
  monotonicMs: number
  kind: string
  sanitized: true
  [field: string]: string | number | boolean
}

export interface ObserverSummary {
  mode: ObserverMode
  events: number
  byKind: Record<string, number>
  overflowed: boolean
  channels?: Record<
    string,
    { calls: number; failed: number; p50Ms?: number; maxMs?: number; totalBytes?: number }
  >
}

export interface Observer {
  readonly mode: ObserverMode
  readonly sessionId: string
  readonly events: ObserverEvent[]
  record(
    kind: string,
    fields?: Record<string, string | number | boolean>
  ): ObserverEvent | undefined
  summary(): ObserverSummary
  finalize(): ObserverSummary
}

export interface IpcCompletion {
  channel: string
  ok: boolean
  durationMs: number
  bytesOut?: number
}

export interface IpcLike {
  handle: (channel: string, listener: (...args: any[]) => unknown) => void
}

export interface MemorySample {
  jsHeapUsedMB: number
  jsHeapTotalMB: number
  domNodes: number
  jsEventListeners: number
}

export interface MemoryDelta {
  before: MemorySample
  after: MemorySample
  deltaHeapMB: number
  deltaDomNodes: number
  deltaListeners: number
}

export interface MainPerfTraceOptions {
  ipc: IpcLike
  observer?: Observer | null
  log?: (line: string) => void
  slowIpcMs?: number
  stallMs?: number
  tickMs?: number
  cpuProfilePath?: string | null
  now?: () => number
}

export interface MainPerfTrace {
  /** Stop sampling and flush the CPU profile if one is running. */
  stop: () => Promise<void>
}

export interface BudgetOptions {
  maxStallMs?: number
  maxStallCount?: number
  maxIpcMs?: number
  maxFailures?: number
  maxPayloadBytes?: number
  channelBudgets?: Record<string, { maxMs?: number; maxFailures?: number }>
}

export interface BudgetViolation {
  type: string
  channel?: string
  message: string
  actual: number
  budget: number
}

export interface BudgetResult {
  passed: boolean
  violations: BudgetViolation[]
  totalStalls: number
  worstStallMs: number
  totalFailures: number
}

export interface OptimizationAdvice {
  level: 'warning' | 'critical'
  channel?: string
  title: string
  advice: string
}

export const SCHEMA_VERSION: 1
export const OBSERVER_VERSION: string
export function validateEvent(event: unknown): ObserverEvent
export function isLabel(value: unknown): boolean
export function redactUrl(raw: string): string
export function estimateSize(val: unknown): number

export function createObserver(options?: {
  mode?: ObserverMode
  sink?: string
  sessionId?: string
  maxEvents?: number
  now?: () => number
}): Observer

export function wrapIpcHandle<T extends IpcLike, Token = unknown>(
  ipc: T,
  onComplete: (receipt: IpcCompletion, event: any, token?: Token) => void,
  /** Runs before the handler; its return value reaches onComplete as `token`. */
  onStart?: (start: { channel: string }, event: any) => Token
): T

export function observeIpcMain<T extends IpcLike>(ipc: T, observer: Observer): T

export function installMainPerfTrace(options: MainPerfTraceOptions): MainPerfTrace

export function sampleMemory(metrics: Array<{ name: string; value: number }>): MemorySample | null
export function diffMemory(before: MemorySample, after: MemorySample): MemoryDelta

export function attachObserver(input: {
  electronApp: any
  page: any
  observer: Observer
}): Promise<{
  mark(label: string): void
  sampleProcess(): Promise<void>
  sampleMemory(): Promise<void>
  observeAction<T>(action: () => Promise<T>): Promise<T>
  detach(): Promise<void>
}>

export function observerFixture(options: {
  mode?: ObserverMode
  createObserver: typeof createObserver
}): (args: object, use: (observer: Observer) => Promise<void>, testInfo: any) => Promise<void>

export function assertBudget(observer: Observer, budgetOptions?: BudgetOptions): BudgetResult
export function evaluateBudget(events: ObserverEvent[], budgetOptions?: BudgetOptions): BudgetResult
export function generateAdvice(events: ObserverEvent[], summary: ObserverSummary): OptimizationAdvice[]
export function formatMarkdownSummary(
  summary: ObserverSummary,
  budgetResult?: BudgetResult | null,
  advice?: OptimizationAdvice[]
): string

export function generateHtmlReport(
  events: ObserverEvent[],
  summary: ObserverSummary,
  options?: { title?: string }
): string

export function injectPerfHud(options?: { position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' }): {
  notifyStall(ms: number, blocker?: string): void
  destroy(): void
} | null
