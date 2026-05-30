import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  build: {
    // pdf-lib is inherently ~1.1MB minified — this cannot be reduced without
    // replacing the library. It's already lazy-loaded via dynamic import() so
    // it only downloads when a user generates a PDF. Suppress the warning.
    chunkSizeWarningLimit: 1200,

    rollupOptions: {
      output: {
        // Vite 8 (rolldown) requires manualChunks as a function.
        // Separates large vendor libs from app code so returning users
        // don't re-download unchanged vendor chunks on each app update.
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/pdf-lib') || id.includes('node_modules/@pdf-lib')) {
            return 'pdf-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'icons';
          }
        },
      },
    },
  },
})
