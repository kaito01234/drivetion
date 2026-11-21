import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 更新は利用者の確認後に適用する(編集中に勝手にリロードしない)
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/icon.svg'],
      manifest: {
        name: 'drivetion',
        short_name: 'drivetion',
        description: 'Google ドライブに保存する Markdown メモ',
        lang: 'ja',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2f6fe4',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // キャッシュするのはアプリ本体だけ。Google の API / ログイン画面はキャッシュしない
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: { chunkSizeWarningLimit: 600 },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
})
