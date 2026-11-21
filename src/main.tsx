import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { auth } from './auth/session'
import './styles.css'

void auth.init()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
