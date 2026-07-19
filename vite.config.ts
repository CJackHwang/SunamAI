import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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
  plugins: [
    react(),
    coepPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg', 'sunam-app.png'],
      manifest: {
        name: 'Sunam',
        short_name: 'Sunam',
        description: 'Sunam Agent Coding Assistant',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'sunam-app.png',
            sizes: '500x500',
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
})
