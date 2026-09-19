import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ManageAppointmentPage from '../../src/ManageAppointmentPage';
import PublicSalonPage from '../../src/PublicSalonPage';
import '../../src/styles.css';
import '../../src/public-booking.css';
import '../../src/public-profile.css';
import '../../src/customer-manage.css';

const root = document.getElementById('root');
if (!root) throw new Error('F12-05 browser harness root missing');

const management = window.location.pathname === '/m' || window.location.pathname === '/m/';
const slug = window.location.pathname.split('/').filter(Boolean).at(-1) ?? 'success-salon';

createRoot(root).render(
  <StrictMode>
    {management
      ? <ManageAppointmentPage token={window.location.hash.replace(/^#/, '')} />
      : <PublicSalonPage slug={slug} />}
  </StrictMode>,
);
