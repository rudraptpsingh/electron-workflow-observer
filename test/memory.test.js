'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { sampleMemory, diffMemory } = require('../src/memory.cjs')

describe('Chrome DevTools Memory Profiling', () => {
  it('parses CDP Performance.getMetrics accurately', () => {
    const rawMetrics = [
      { name: 'Timestamp', value: 12345 },
      { name: 'JSHeapUsedSize', value: 50 * 1024 * 1024 }, // 50MB
      { name: 'JSHeapTotalSize', value: 80 * 1024 * 1024 }, // 80MB
      { name: 'Nodes', value: 1200 },
      { name: 'JSEventListeners', value: 450 },
    ]

    const sample = sampleMemory(rawMetrics)
    assert.deepEqual(sample, {
      jsHeapUsedMB: 50,
      jsHeapTotalMB: 80,
      domNodes: 1200,
      jsEventListeners: 450,
    })
  })

  it('returns null if any required metric is missing', () => {
    const partial = [{ name: 'JSHeapUsedSize', value: 10 }]
    assert.equal(sampleMemory(partial), null)
  })

  it('computes diffMemory correctly', () => {
    const before = {
      jsHeapUsedMB: 40.2,
      jsHeapTotalMB: 60.0,
      domNodes: 100,
      jsEventListeners: 20,
    }
    const after = {
      jsHeapUsedMB: 55.4,
      jsHeapTotalMB: 75.0,
      domNodes: 140,
      jsEventListeners: 35,
    }

    const diff = diffMemory(before, after)
    assert.equal(diff.deltaHeapMB, 15.2)
    assert.equal(diff.deltaDomNodes, 40)
    assert.equal(diff.deltaListeners, 15)
  })
})
