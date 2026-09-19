import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PublicSalonPage from '../../src/PublicSalonPage';
import '../../src/styles.css';
import '../../src/public-booking.css';
import '../../src/public-profile.css';
import '../../src/public-multi-service.css';

declare global {
  interface Window {
    __f12SharedUrl?: string;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('F12-04 browser harness root missing');

const slug = window.location.pathname.split('/').filter(Boolean).at(-1) ?? 'multi-salon';

Object.defineProperty(navigator, 'share', {
  configurable: true,
  value: async (data: ShareData) => {
    window.__f12SharedUrl = String(data.url ?? '');
    document.documentElement.dataset.f12SharedUrl = window.__f12SharedUrl;
  },
});

createRoot(root).render(<StrictMode><PublicSalonPage slug={slug} /></StrictMode>);
