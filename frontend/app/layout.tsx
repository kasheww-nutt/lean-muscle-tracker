import type { Metadata, Viewport } from "next";
import { TrackerAppSupport } from './install-tracker';
import "./globals.css";
import "./lavender-daily.css";
import "./lavender-screens.css";

export const metadata: Metadata = {
  title: "Lean Muscle Tracker",
  description: "Private nutrition, body-weight, and training tracker.",
  applicationName: 'Lean Muscle Tracker',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Lean Muscle' },
  icons: {
    icon: [{ url:'/icons/tracker-v3.svg', type:'image/svg+xml' }, { url:'/icons/tracker-32-v3.png', sizes:'32x32', type:'image/png' }],
    shortcut: '/favicon-v3.ico',
    apple: [{url:'/icons/apple-touch-icon-v3.png',sizes:'180x180',type:'image/png'}],
  },
};
export const viewport: Viewport = {width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#f8f8fc'};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body className="antialiased">{children}<TrackerAppSupport /></body>
    </html>
  );
}
