import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// base: '/' по умолчанию (Docker/nginx); для GitHub Pages: `npm run build:ghpages` -> '/TableOne/'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    base: env.VITE_BASE || (mode === 'ghpages' ? '/TableOne/' : '/'),
    server: {
      port: 3000,
      open: true,
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY || 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  }
})
