import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,      // anggap data segar 30 detik (kurangi refetch)
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// Cloudflare Turnstile site key — dari env VITE_TURNSTILE_SITE_KEY saat build.
(window as any).__TURNSTILE_SITE_KEY__ = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
