'use strict'

/**
 * Lightweight, zero-dependency Developer Performance HUD for Electron Renderers.
 * Displays real-time FPS, active IPC counts, and flashes red on main-thread stalls.
 */

function injectPerfHud(options = {}) {
  if (typeof document === 'undefined') return null
  const { position = 'bottom-right' } = options

  const id = '__electron_workflow_perf_hud__'
  if (document.getElementById(id)) return document.getElementById(id)

  const hud = document.createElement('div')
  hud.id = id

  const posStyles = {
    'bottom-right': 'bottom: 16px; right: 16px;',
    'bottom-left': 'bottom: 16px; left: 16px;',
    'top-right': 'top: 16px; right: 16px;',
    'top-left': 'top: 16px; left: 16px;',
  }[position] || 'bottom: 16px; right: 16px;'

  hud.style.cssText = `
    position: fixed;
    ${posStyles}
    z-index: 999999;
    background: rgba(13, 17, 23, 0.92);
    border: 1px solid #30363d;
    border-radius: 20px;
    padding: 6px 14px;
    color: #c9d1d9;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 11px;
    font-weight: 600;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
    backdrop-filter: blur(8px);
    transition: border-color 0.3s, transform 0.1s;
  `

  hud.innerHTML = `
    <span id="__hud_fps__" style="color: #3fb950">60 FPS</span>
    <span style="color: #30363d">|</span>
    <span id="__hud_status__" style="color: #58a6ff">⚡ Perf OK</span>
  `

  document.body.appendChild(hud)

  // Real-time FPS monitor
  let frameCount = 0
  let lastTime = performance.now()
  function calcFps() {
    frameCount++
    const now = performance.now()
    if (now >= lastTime + 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastTime))
      frameCount = 0
      lastTime = now
      const fpsEl = document.getElementById('__hud_fps__')
      if (fpsEl) {
        fpsEl.textContent = `${fps} FPS`
        fpsEl.style.color = fps >= 50 ? '#3fb950' : fps >= 30 ? '#d29922' : '#f85149'
      }
    }
    requestAnimationFrame(calcFps)
  }
  requestAnimationFrame(calcFps)

  return {
    notifyStall(ms, blocker) {
      const statusEl = document.getElementById('__hud_status__')
      if (statusEl) {
        statusEl.textContent = `⚠️ Stall ${ms}ms (${blocker || 'busy'})`
        statusEl.style.color = '#f85149'
        hud.style.borderColor = '#f85149'
        setTimeout(() => {
          statusEl.textContent = '⚡ Perf OK'
          statusEl.style.color = '#58a6ff'
          hud.style.borderColor = '#30363d'
        }, 4000)
      }
    },
    destroy() {
      hud.remove()
    },
  }
}

module.exports = { injectPerfHud }
