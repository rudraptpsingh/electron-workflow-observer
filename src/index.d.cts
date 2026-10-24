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

export const SCHEMA_VERSION: 1
export const OBSERVER_VERSION: string
export function validateEvent(event: unknown): ObserverEvent
export function isLabel(value: unknown): boolean
export function redactUrl(raw: string): string
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
