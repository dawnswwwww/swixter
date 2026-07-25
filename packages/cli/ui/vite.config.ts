import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3141',
        changeOrigin: true,
      },
    },
  },
  build: {
    // UI 产物规范位置：server crate 内的 ui_dist（rust-embed 嵌入源，
    // 随 cargo package/publish 一起打包，见 M4 code review C1）
    outDir: '../crates/server/ui_dist',
    emptyOutDir: true,
  },
})
