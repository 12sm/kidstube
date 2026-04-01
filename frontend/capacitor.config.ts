import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kidstube.app',
  appName: 'KidsTube',
  webDir: 'dist',
  server: {
    // Point to the live nginx server via Tailscale so the app always shows the latest frontend.
    // The iPad must be connected to the Tailscale network at runtime.
    url: 'http://ubuntu.tailb45aee.ts.net:3000',
    cleartext: true, // allow HTTP in WKWebView
  },
  ios: {
    scheme: 'kidstube',
    backgroundColor: '#0f0f0f',
    preferredContentMode: 'mobile',
    scrollEnabled: false,
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
