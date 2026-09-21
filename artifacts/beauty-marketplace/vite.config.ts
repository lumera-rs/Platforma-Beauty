import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import { publicSiteOrigin, applySitePolicy } from './seo-policy.mjs';

const rawPort = process.env.PORT ?? '3000';

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? '/';

const apiBaseUrl = process.env.LUMERA_API_BASE_URL;
const configuredPublicOrigin = process.env.PUBLIC_SITE_URL || process.env.LUMERA_PUBLIC_URL
  ? publicSiteOrigin() : undefined;

export default defineConfig({
  base: basePath,
  define: {
    'import.meta.env.VITE_PUBLIC_SITE_URL': JSON.stringify(configuredPublicOrigin ?? ''),
  },
  plugins: [
    {
      name: 'lumera-preview-indexing-safety',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          res.setHeader('X-Robots-Tag', 'noindex, nofollow');
          if (req.url?.split('?')[0] === '/robots.txt') {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('User-agent: *\nDisallow: /\n');
            return;
          }
          next();
        });
      },
      transformIndexHtml(html) {
        // Static builds and Vite previews stay closed; the production SEO
        // server replaces this policy using the actual request host at runtime.
        return configuredPublicOrigin
          ? applySitePolicy(html, { headers: {} }, { ...process.env, SITE_INDEXABLE: 'false' })
          : html;
      },
    },
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    // Emit a manifest so bundle-budget tooling can identify entry chunks by
    // logical name rather than by content-hashed filename.
    manifest: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: apiBaseUrl
      ? {
          '/api': {
            target: apiBaseUrl,
            // Keep the browser's public Host header so host-derived URLs
            // (OAuth callbacks and provider webhooks) match the origin the
            // admin is actually using. The API trusts this only through its
            // configured proxy boundary.
            changeOrigin: false,
          },
        }
      : undefined,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
