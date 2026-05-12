import { CapacitorConfig } from '@capacitor/cli';

// IMPORTANT: replace `server.url` with the actual LAN IP of the Docker host
// before running `npx cap sync ios` on the Mac. The iPad must be on the same
// Wi-Fi network as the server at runtime. Using `server.url` (instead of
// bundled files) means frontend changes ship instantly via nginx — no
// re-sync needed — at the cost of zero offline support.
const config: CapacitorConfig = {
  appId: 'com.kidstube.app',
  appName: 'KidsTube',
  webDir: 'dist',
  server: {
    url: 'http://192.168.1.100:3000', // TODO: replace with actual server LAN IP
    cleartext: true,                  // allow HTTP in WKWebView (paired with NSAllowsArbitraryLoads)
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
