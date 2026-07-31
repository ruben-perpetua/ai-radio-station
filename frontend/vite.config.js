import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward API calls to the Flask backend (webapp/app.py) during dev
      '/api': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
      },
    },
  },
})
