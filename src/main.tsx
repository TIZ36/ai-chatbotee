import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { TerminalProvider } from './contexts/TerminalContext.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <TerminalProvider>
          <App />
        </TerminalProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
) 