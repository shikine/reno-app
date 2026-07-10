import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages (https://shikine.github.io/reno-app/) はサブパス配信のため、
// CI ビルド時のみ base を切り替える。ローカル dev/build は '/' のまま。
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/reno-app/' : '/',
  server: { host: true, port: 5180, strictPort: true },
})
