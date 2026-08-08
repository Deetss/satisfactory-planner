import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { warmUpSolver } from './solver/solve'
import { startUrlSync } from './state/urlState'
import './styles.css'

// Start fetching the solver wasm immediately so the first plan isn't waiting.
void warmUpSolver()

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

const render = () =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

// A sent link is deflated, so reading one is asynchronous. Rendering first
// would solve and lay out whatever plan this browser had open, then throw the
// result away a moment later.
void startUrlSync().finally(render)
