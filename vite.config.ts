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
        'favicon.svg',
        'icons.svg',
        'icon-bg-svg.svg',
        'icon-nobg-svg.svg',
        'sunam-appicon.png',
      ],
      manifest: {
        name: 'Sunam',
        short_name: 'Sunam',
        description: 'Sunam Agent Coding Assistant',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'sunam-appicon.png',
            sizes: '512x512',
            type: 'image/png'
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
    // Lightning CSS currently collapses the source declaration pair to a WebKit-only
    // declaration. Esbuild preserves both the standard property used by
    // Chromium/Firefox and the Safari-compatible prefixed declaration.
    cssMinify: 'esbuild',
    cssTarget: ['chrome100', 'firefox103', 'safari15.4'],
  },
})
