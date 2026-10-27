import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '家計簿', short_name: '家計簿', lang: 'ja',
        display: 'standalone', start_url: '/',
        theme_color: '#79afea', background_color: '#fffaf2',
        icons: [
          { src: '/icon.svg?v=2', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      },
      workbox: { navigateFallbackDenylist: [/^\/api/] }
    })
  ],
  server: { proxy: { '/api': 'http://127.0.0.1:8788' } }
})
