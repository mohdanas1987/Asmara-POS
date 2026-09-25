import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/plus-jakarta-sans';
import '../styles/globals.css';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';

// "Aura Glass" re-theme (this pass): the font ships as a real npm dependency
// (@fontsource-variable/plus-jakarta-sans) rather than a next/font/google live fetch from
// Google's CDN -- next/font/google still needs ONE successful network call at build time to
// resolve, and a build server with restricted/no egress (a real, not hypothetical,
// deployment shape for this kind of on-prem POS) would fail the whole production build over
// a font. Fontsource bundles the actual .woff2 files into node_modules and npm install is
// already how every other dependency here is fetched, so this has the exact same network
// requirement as `npm install` and nothing more -- consistent with this app's offline-first
// design (see src/lib/offline/), which already treats "no live network at runtime" as a
// normal operating condition, not an edge case. tailwind.config.ts's fontFamily.sans points
// at the family name this package declares ('Plus Jakarta Sans Variable').

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
  // Matches the Aura Glass dark theme's flame-amber accent, since dark is now the app's
  // default -- this is the color a browser/OS chrome (PWA title bar, Android task switcher)
  // paints around the app, so it should match what the user actually sees on first launch.
  themeColor: '#ff6b00',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning: ThemeProvider applies the .dark class on the client
          after mount (see its comment for why), which briefly differs from the server-
          rendered markup by design -- this is the documented, correct way to avoid a
          false-positive hydration warning for exactly this pattern. */}
      <body>
        {/* Blocking theme-init script (runs before paint, before React hydrates): without
            this, the page would render server-side with no `.dark` class -- a real,
            visible flash of the OLD light theme before ThemeProvider's own effect adds the
            class a moment later. Reads the exact same localStorage key ThemeProvider uses,
            so they can never disagree; falls back to 'dark' (this app's default) on any
            error, matching ThemeProvider's own fallback exactly. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var stored = localStorage.getItem('restaurantos-theme');
                  if (stored === 'light') return;
                } catch (e) {}
                document.documentElement.classList.add('dark');
              })();
            `,
          }}
        />
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
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
