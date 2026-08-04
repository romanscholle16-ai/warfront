import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor turns the Vite build into real Android/iOS apps.
 *
 *   npm run cap:add:android   # once, generates packages/client/android
 *   npm run android           # build + sync + open Android Studio
 *   npx cap sync android      # copy latest web assets into the Android project
 *
 * For LAN multiplayer: the server runs on the host laptop on port 2567. The APK
 * connects via ws://<host-ip>:2567 — the user types the address once in the menu
 * and it is remembered. Production builds over the internet should use wss://
 * (TLS) and cleartext must be removed.
 */
const config: CapacitorConfig = {
  appId: 'com.warfront.game',
  appName: 'WARFRONT',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'http',
    // cleartext permits plain ws:// for LAN multiplayer during development.
    // Remove this for production builds that use wss://.
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0d1117',
    },
  },
};

export default config;
