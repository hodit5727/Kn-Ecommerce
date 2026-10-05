import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initClientTelemetry } from './services/telemetryService';

initClientTelemetry();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register PWA service worker for Android APK & offline delivery support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service worker registration error handled silently in client
    });
  });
}
