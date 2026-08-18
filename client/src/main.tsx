import React from 'react'
import ReactDOM from 'react-dom/client'
import Modal from 'react-modal'
import 'remixicon/fonts/remixicon.css'
import App from './App'
import './index.css'
import './components.css'
import { GlobalErrorBoundary } from './components/error-boundary.tsx'
import { bootstrapApp } from './app/bootstrap'

bootstrapApp()

// 注册 Live2D 模型缓存专用 Service Worker。
// 目的：把近百 MB 的 Live2D 模型(95MB moc3 + 8MB 贴图)缓存在浏览器 Cache Storage，
// 重新进入页面不再重复下载。仅生产环境、且页面在可注册的安全上下文时注册。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[rin-live2d] Service Worker registration failed:', err);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </React.StrictMode>
)
Modal.setAppElement('#root');
