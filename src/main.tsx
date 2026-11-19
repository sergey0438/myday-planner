import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { store } from '@/data/store';
import { registerServiceWorker } from '@/components/UpdatePrompt';

// iOS: request persistent storage so the offline cache is less likely to be evicted
void navigator.storage?.persist?.().catch(() => {});

void store.init().catch((e) => console.error('init failed', e));
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
