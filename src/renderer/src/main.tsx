import React from 'react'
import ReactDOM from 'react-dom/client'
// Bundled fonts (self-hosted, no network dependency).
import '@fontsource/cormorant-garamond/latin-400.css'
import '@fontsource/cormorant-garamond/latin-600.css'
import '@fontsource/cormorant-garamond/latin-700.css'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import App from './App'
import { initTheme } from './theme'
import { I18nProvider } from './i18n'
import './index.css'

// Apply the saved theme before first render to avoid a light-theme flash.
initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
)
