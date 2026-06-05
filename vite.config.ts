import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import { version } from './package.json';

// Cross-origin isolation headers required by the FSRS WASM trainer worker.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Lacuna is a static, serverless single-page application.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  // Surface the package version to the app (used by the diagnostic bundle).
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  // Pre-bundle the heavy dependencies up front so the dev server never pauses to
  // re-optimise (and full-page reload) the first time a lazy route pulls one in.
  // Without this, navigating to a route that imports recharts/katex/highlight.js
  // froze the page for several seconds while Vite re-ran dependency optimisation.
  optimizeDeps: {
    exclude: ['@open-spaced-repetition/binding'],
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'motion/react',
      'recharts',
      'katex',
      'react-markdown',
      'remark-gfm',
      'remark-math',
      'rehype-katex',
      'rehype-highlight',
      'rehype-raw',
      'highlight.js',
      'dexie',
      'dexie-react-hooks',
      'ts-fsrs',
    ],
  },
  build: {
    rollupOptions: {
      output: {
        // Keep production chunks sensible: framework, charts and the markdown/maths
        // stack each get their own chunk so a page that needs none of them stays light.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', 'motion/react'],
          charts: ['recharts'],
          markdown: [
            'react-markdown',
            'remark-gfm',
            'remark-math',
            'rehype-katex',
            'rehype-highlight',
            'rehype-raw',
            'katex',
            'highlight.js',
          ],
        },
      },
    },
  },
});
