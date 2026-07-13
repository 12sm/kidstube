import { CapacitorConfig } from '@capacitor/cli';

// IMPORTANT: Replace `server.url` with the actual LAN IP of the Docker host
// before running `npx cap sync ios` / building in Xcode. The iPad must be on
// the same Wi-Fi as the server at runtime.
//
// Find the LAN IP on the server with: `hostname -I | awk '{print $1}'`
// or `ip -4 addr show | grep inet | grep -v 127.0.0.1`.

const config: CapacitorConfig = {
  appId: 'com.kidstube.app',
  appName: 'KidsTube',
  webDir: 'dist',
  server: {
    url: 'http://192.168.1.100:3000',   // ← REPLACE with actual server LAN IP
    cleartext: true,                     // allow HTTP in WKWebView
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
