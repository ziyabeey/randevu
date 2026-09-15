import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PublicSalonPage from '../../src/PublicSalonPage';
import '../../src/styles.css';
import '../../src/public-booking.css';
import '../../src/public-profile.css';

const root = document.getElementById('root');
if (!root) throw new Error('F12 browser harness root missing');
const slug = window.location.pathname.split('/').filter(Boolean).at(-1) ?? 'missing-salon';

function recordMetrics() {
  const anchors = Array.from(document.querySelectorAll<HTMLElement>('.public-salon-section-nav a'));
  document.documentElement.dataset.f12Overflow = String(document.documentElement.scrollWidth > window.innerWidth + 1);
  document.documentElement.dataset.f12Touch = String(anchors.length > 0 && anchors.every((node) => node.getBoundingClientRect().height >= 44));
  document.documentElement.dataset.f12Width = String(window.innerWidth);
  if (document.body.innerText.includes('Şu anda online randevuya açık hizmet bulunmuyor.')) {
    document.documentElement.dataset.f12Ready = 'true';
  }
}

const observer = new MutationObserver(() => window.setTimeout(recordMetrics, 0));
observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
window.setInterval(recordMetrics, 100);

createRoot(root).render(<StrictMode><PublicSalonPage slug={slug} /></StrictMode>);
