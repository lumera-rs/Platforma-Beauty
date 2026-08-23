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
