import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyMotion, domAnimation } from 'motion/react';
import './index.css';
import { App } from './App';

// Register the PWA service worker in production builds.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register('/sw.js', { type: 'module' })
    .catch(() => {
      // Registration is best-effort; the app works fine without it.
    });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LazyMotion features={domAnimation}>
      <App />
    </LazyMotion>
  </StrictMode>,
);
