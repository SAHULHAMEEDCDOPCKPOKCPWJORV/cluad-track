import type { MetadataRoute } from 'next';

// Makes the website installable as an app (Android, iPhone, Windows, Mac, Chromebook).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'SWELECT Project Control',
    short_name: 'SWELECT PC',
    description: 'Solar EPC & IPP project scheduling, Gantt chart, S-curves and dashboard',
    start_url: '/?source=app',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#090d16',
    theme_color: '#090d16',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
