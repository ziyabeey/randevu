import "./hero-media.css";

export function MarketingHero() {
  return (
    <section className="mkt-hero" aria-labelledby="mkt-hero-title">
      <div className="mkt-hero-media" aria-hidden="true" />
      <div className="mkt-hero-shape mkt-hero-shape--one" aria-hidden="true" />
      <div className="mkt-hero-shape mkt-hero-shape--two" aria-hidden="true" />

      <div className="mkt-hero-copy">
        <p className="mkt-eyebrow">Kepenk.ai sunar</p>
        <h1 id="mkt-hero-title">Randevu kolay.</h1>
        <p className="mkt-hero-lead">
          Müşteri kendi alsın. Takvimin karışmasın. Kurulumla da seni uğraştırmayalım.
        </p>
        <p className="mkt-hero-trust">Kuaför, berber ve güzellik işletmeleri için.</p>
        <div className="mkt-hero-actions">
          <a className="mkt-button mkt-button--lime" href="#kurulum">
            Birlikte kuralım
            <span aria-hidden="true">→</span>
          </a>
          <a className="mkt-text-link" href="#nasil-calisiyor">
            Nasıl çalışıyor?
            <span aria-hidden="true">↓</span>
          </a>
        </div>
      </div>

      <div className="mkt-hero-demo" aria-label="Randevu akışı örneği">
        <div className="mkt-demo-card">
          <div className="mkt-demo-topline">
            <span>Bugün</span>
            <span className="mkt-live-dot">Takvim</span>
          </div>
          <div className="mkt-demo-appointment">
            <div>
              <span>14:30</span>
              <strong>Saç kesimi</strong>
            </div>
            <span className="mkt-demo-status">Onaylandı</span>
          </div>
          <div className="mkt-demo-slots" aria-hidden="true">
            <span>11:00</span>
            <span>12:00</span>
            <span className="is-selected">14:30</span>
            <span>16:00</span>
          </div>
        </div>
        <div className="mkt-hero-note">Bakınca belli.</div>
      </div>
    </section>
  );
}
