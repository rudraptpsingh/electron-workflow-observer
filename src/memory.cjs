'use strict'

// Renderer memory samples from Chrome DevTools Performance.getMetrics. A
// before/after pair is allocation evidence, not proof of retention or a leak.

function sampleMemory(metrics) {
  const m = new Map((metrics || []).map((x) => [x.name, x.value]))
  const required = ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'JSEventListeners']
  if (required.some((name) => !Number.isFinite(m.get(name)))) return null
  const mb = (v) => Math.round((v / (1024 * 1024)) * 10) / 10
  return {
    jsHeapUsedMB: mb(m.get('JSHeapUsedSize')),
    jsHeapTotalMB: mb(m.get('JSHeapTotalSize')),
    domNodes: Math.round(m.get('Nodes')),
    jsEventListeners: Math.round(m.get('JSEventListeners')),
  }
}

function diffMemory(before, after) {
  const round = (v) => Math.round(v * 10) / 10
  return {
    before,
    after,
    deltaHeapMB: round(after.jsHeapUsedMB - before.jsHeapUsedMB),
    deltaDomNodes: after.domNodes - before.domNodes,
    deltaListeners: after.jsEventListeners - before.jsEventListeners,
  }
}

module.exports = { sampleMemory, diffMemory }
