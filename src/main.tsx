import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initLiff } from './cloud/liff'
import './index.css'

// LIFF初期化を待ってから描画（LINE外ブラウザでは即座に解決される）
initLiff().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
