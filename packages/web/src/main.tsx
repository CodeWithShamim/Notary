import { Buffer } from 'buffer';
// The SDK's crypto path expects a global Buffer in the browser (Vite externalizes
// Node's built-in). Polyfill it before any SDK code runs.
if (!(globalThis as { Buffer?: unknown }).Buffer) (globalThis as { Buffer?: unknown }).Buffer = Buffer;

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import { ToastProvider } from './state/ToastContext.js';
import { ConnectProvider } from './state/ConnectContext.js';
import './styles/web3.css';
import './styles.css';
import './styles/landing.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchInterval: 10_000, retry: 1, staleTime: 5_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConnectProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ConnectProvider>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
