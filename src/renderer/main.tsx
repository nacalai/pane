import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './app.css'
import '@shared/api' // global Window.vev declaration

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Could not find #root')
createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
