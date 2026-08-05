import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

import { VitePWA } from 'vite-plugin-pwa'

// WebContainers require every app response to be cross-origin isolated.
function coepPlugin(): Plugin {
  return {
    name: 'coep-headers',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        next();
      });
    },
    // Also handle build preview (vite preview)
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        next();
      });
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    coepPlugin(),
    VitePWA({
      // Keep the old worker active until the user accepts the update. Activating
      // a new precache while an old page is running can break lazy chunk loads.
      registerType: 'prompt',
      includeAssets: [
        'icon-bg-svg.svg',
        'icon-nobg-svg.svg',
      ],
      workbox: {
        // Succinix host 运行时资产（host.js / lifo-core.js / pyodide）是注入 WebContainer
        // 的懒加载基础设施，不进 SW 预缓存（单文件可达 9.6MB，超出 workbox 默认上限）。
        globIgnores: ['**/succinix/**'],
      },
      manifest: {
        name: 'Sunam',
        short_name: 'Sunam',
        description: 'Sunam Agent Coding Assistant',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'sunam-appicon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'sunam-appicon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  server: {
    port: 7891,
    strictPort: true,
  },
  build: {
    target: 'es2023',
    minify: 'terser',
    terserOptions: {
      compress: { passes: 4 },
    },
    // Lightning CSS currently collapses the source declaration pair to a WebKit-only
    // declaration. Esbuild preserves both the standard property used by
    // Chromium/Firefox and the Safari-compatible prefixed declaration.
    cssMinify: 'esbuild',
    cssTarget: ['chrome100', 'firefox103', 'safari15.4'],
  },
})
