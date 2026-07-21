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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
