import { createRoot } from 'react-dom/client';

// Must be imported before the app renders: registers the window popstate
// listener ahead of the router's subscription so unsaved-changes guards can
// intercept Back/Forward before the router re-renders (see the module docs).
import '@/lib/unsaved-changes-guard';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

// Public pages are delivered with a crawler-facing semantic fallback outside
// React's root. Once the SPA is mounted we hide it, avoiding hydration
// mismatches while keeping the existing client-side route architecture intact.
document.documentElement.dataset.appReady = 'true';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}service-worker.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .catch((error: unknown) => {
        console.error('LUMERA service worker registration failed.', error);
      });
  });
}
