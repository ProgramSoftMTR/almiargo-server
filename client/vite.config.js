import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  envDir: '.',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    'process.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify('196590783383-3796k1hnlns2dkmjiq5rt634hbmm6k8b.apps.googleusercontent.com'),
  },
});
