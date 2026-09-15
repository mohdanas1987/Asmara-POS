import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'RestaurantOS',
  description: 'Fast, modern restaurant POS — built for speed.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'RestaurantOS',
  },
  icons: {
    icon: ['/icon-192.png', '/icon-512.png'],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0F766E',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <script
          // Registers the service worker so the app is installable (Add to Home Screen on
          // iOS/Android, "Install app" on desktop Chrome/Edge) on Windows, macOS, Linux,
          // tablets, and phones alike -- one responsive codebase, not separate builds.
          dangerouslySetInnerHTML={{
            __html: `
              // Only registers in production -- a service worker's own caching/fetch
              // interception actively fights Next.js's dev-mode fetches (hot reload, RSC
              // payloads) and was causing real pages to fail with "Failed to convert value
              // to 'Response'" during local development. Installability (Add to Home
              // Screen / desktop "Install app") only matters for a real deployed build
              // anyway, not local dev.
              if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
                window.addEventListener('load', function () {
                  navigator.serviceWorker.register('/sw.js').catch(function () {});
                });
              } else if ('serviceWorker' in navigator) {
                // Clean up any service worker registered by an earlier version of this app
                // during local dev, so it stops intercepting requests on this origin.
                navigator.serviceWorker.getRegistrations().then(function (regs) {
                  regs.forEach(function (r) { r.unregister(); });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
