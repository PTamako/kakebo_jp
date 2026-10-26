import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '记账本', short_name: '记账本', lang: 'zh-CN',
        display: 'standalone', start_url: '/',
        theme_color: '#2f4b8a', background_color: '#f1f4f1',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: { navigateFallbackDenylist: [/^\/api/] }
    })
  ],
  server: { proxy: { '/api': 'http://127.0.0.1:8788' } }
})
