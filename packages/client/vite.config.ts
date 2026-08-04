import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // 0.0.0.0 so a phone on the same WiFi can open http://<laptop-ip>:5173
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  build: {
    // Capacitor loads from file:// — relative asset paths are required.
    assetsDir: 'assets',
    target: 'es2019', // WebView floor: Android 8 / iOS 13
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Phaser is ~1 MB; splitting it lets the menu paint before the map loads.
          phaser: ['phaser'],
        },
      },
    },
  },
  base: './',
});
