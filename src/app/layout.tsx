import type { Metadata, Viewport } from 'next';
import './globals.css';
import ThemeToggle from '@/components/ThemeToggle';
import InstallApp from '@/components/InstallApp';
import AppUpdater from '@/components/AppUpdater';

export const metadata: Metadata = {
  title: 'SWELECT Project Control',
  description: 'Enterprise Solar EPC & IPP project management, scheduling and project control',
  applicationName: 'SWELECT Project Control',
  icons: { icon: [{ url: '/icons/icon-192.png', sizes: '192x192' }, { url: '/swelect-mark.png' }], apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'SWELECT PC', statusBarStyle: 'black' },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = { themeColor: '#090d16' };

// Applies the saved Dark / Light choice before the page is drawn (no flash).
const themeScript = `try{var t=localStorage.getItem('swelect-theme');if(t==='light'){document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        {children}
        <ThemeToggle />
        <InstallApp />
        <AppUpdater />
      </body>
    </html>
  );
}
