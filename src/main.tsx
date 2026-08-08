import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { startUrlSync } from './state/urlState'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

const render = () =>
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )

// A sent link is deflated, so reading one is asynchronous. Rendering first
// would solve and lay out whatever plan this browser had open, then throw the
// result away a moment later.
void startUrlSync().finally(render)
