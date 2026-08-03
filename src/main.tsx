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

initializeAppUpdates()
// Load the capability registry off the initial bundle; consumers call
// `ensureCapabilityRegistry()` idempotently, so late arrival is harmless.
void import('./features/agent-core/capability/manifest.ts').then(({ bootstrapCapabilityRegistry }) => bootstrapCapabilityRegistry())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
