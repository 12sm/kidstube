import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kidstube.app',
  appName: 'KidsTube',
  webDir: 'dist',
  server: {
    // Point to the live nginx server so the app always shows the latest frontend.
    // The iPad must be on the same Wi-Fi as the server at runtime.
    // Replace this IP with the actual LAN IP of the server running Docker.
    url: 'http://172.22.165.254:3000',
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
