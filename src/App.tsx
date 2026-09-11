import { useEffect, useState } from 'react';

type ConnectionStatus = 'checking' | 'ready' | 'unavailable';

const connectionLabels: Record<ConnectionStatus, string> = {
  checking: 'Bağlantı kontrol ediliyor…',
  ready: 'Bağlantı hazır',
  unavailable: 'Bağlantı kurulamadı',
};

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 8_000);

    async function checkConnection() {
      try {
        const response = await fetch('/api/health', {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Health request failed.');
        }

        const body: unknown = await response.json();

        if (
          typeof body !== 'object' ||
          body === null ||
          !('status' in body) ||
          body.status !== 'ok' ||
          !('service' in body) ||
          body.service !== 'yzt-randevu'
        ) {
          throw new Error('Unexpected health response.');
        }

        if (!disposed) setStatus('ready');
      } catch {
        if (!disposed) setStatus('unavailable');
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void checkConnection();

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  function retryConnection() {
    setStatus('checking');
    setAttempt((current) => current + 1);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">İçeriğe geç</a>

      <header className="app-header">
        <a className="brand" href="/" aria-label="YZT Randevu ana sayfa">
          <span className="wordmark">yzt<span>.</span></span>
          <span className="product-name">randevu</span>
        </a>
        <span className="header-label">Çalışma alanı</span>
      </header>

      <main id="main-content" className="main-content" tabIndex={-1}>
        <section className="welcome" aria-labelledby="welcome-title">
          <div className="welcome-body">
            <div className="welcome-icon" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="7" width="22" height="21" rx="4" />
                <path d="M11 4v6M21 4v6M5 14h22M11 20h4M11 24h8" />
              </svg>
            </div>
            <p className="eyebrow">YZT RANDEVU</p>
            <h1 id="welcome-title">Hoş geldiniz.</h1>
            <p className="welcome-description">
              Kurulum tamamlandığında işletmenizin randevularını
              bu alandan yöneteceksiniz.
            </p>
          </div>

          <div className="connection-panel">
            <div className="connection-message" role="status" aria-live="polite" aria-atomic="true">
              <span className={`status-indicator status-${status}`} aria-hidden="true" />
              <div>
                <p className="connection-label">{connectionLabels[status]}</p>
                {status === 'unavailable' && (
                  <p className="connection-help">Lütfen bağlantınızı kontrol edip tekrar deneyin.</p>
                )}
              </div>
            </div>
            <button
              className="connection-button"
              type="button"
              onClick={retryConnection}
              disabled={status === 'checking'}
            >
              {status === 'checking' ? 'Kontrol ediliyor…' : 'Tekrar kontrol et'}
            </button>
          </div>
        </section>
      </main>

      <footer className="app-footer">YZT Digital</footer>
    </div>
  );
}
