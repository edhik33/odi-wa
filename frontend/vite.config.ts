import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3032,
    // Teruskan semua request /api/* ke backend Go (:3031).
    // Frontend pakai baseURL relatif '/api', jadi tidak perlu CORS & port-agnostic.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3031',
        changeOrigin: true,
      },
    },
  },
})
