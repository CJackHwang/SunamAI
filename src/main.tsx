import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App.tsx'
import './app/fonts.css'
import './app/base.css'
import './shared/styles/menus.css'
import './shared/styles/motion.css'
import './shared/styles/controls.css'
import './shared/styles/formControls.css'
import './shared/styles/effects.css'
import { initializeAppUpdates } from './shared/lib/appUpdates.ts'

// Pinch-to-zoom guard for a native-app feel. The viewport meta (`user-scalable=no`)
// is honored by Android and iOS standalone mode, but iOS Safari in a regular tab
// ignores it — so also block the gesture events here. Single-finger pan/scroll is
// untouched; only multi-touch (pinch) is prevented.
function disablePinchZoom() {
  const prevent = (event: Event) => event.preventDefault()
  window.addEventListener('gesturestart', prevent)
  window.addEventListener('gesturechange', prevent)
  window.addEventListener('gestureend', prevent)
  window.addEventListener('touchmove', (event) => {
    if (event.touches.length > 1) event.preventDefault()
  }, { passive: false })
}

disablePinchZoom()
initializeAppUpdates()
// Load the capability registry off the initial bundle; consumers call
// `ensureCapabilityRegistry()` idempotently, so late arrival is harmless.
void import('./features/agent-core/capability/manifest.ts').then(({ bootstrapCapabilityRegistry }) => bootstrapCapabilityRegistry())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
