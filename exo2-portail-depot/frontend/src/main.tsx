// Self-hosted, and imported before anything else so the face is registered
// before the first paint. Google Fonts would make every visit contact a third
// party, on a product whose argument is the traceability of a case file.
import '@fontsource-variable/inter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { Provider } from './components/ui/provider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider>
      <App />
    </Provider>
  </StrictMode>,
)
