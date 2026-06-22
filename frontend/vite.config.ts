import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Teruskan semua request /api/* ke backend Go (:3030).
    // Frontend pakai baseURL relatif '/api', jadi tidak perlu CORS & port-agnostic.
    proxy: {
      '/api': 'http://localhost:3030',
    },
  },
})
