import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AvailabilityPage from './AvailabilityPage';
import './styles.css';
import './phase4.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('The application root element is missing.');
}

const isAvailability = window.location.pathname === '/availability';

createRoot(root).render(
  <StrictMode>
    {isAvailability ? <AvailabilityPage /> : <App />}
    <nav className="phase-nav" aria-label="Çalışma alanları">
      <a href="/" aria-current={isAvailability ? undefined : 'page'}>Hizmet & Ekip</a>
      <a href="/availability" aria-current={isAvailability ? 'page' : undefined}>Müsaitlik</a>
    </nav>
  </StrictMode>,
);
