import "./marketing.css";

import { MarketingHero } from "./MarketingHero";
import { TransformationSection } from "./transformation/TransformationSection";

function MarketingNav() {
  return (
    <header className="mkt-nav-shell">
      <nav className="mkt-nav" aria-label="Randevu ana navigasyon">
        <a className="mkt-brand" href="#top" aria-label="Randevu kolay ana sayfa">
          <span>randevu</span>
          <small>kolay</small>
        </a>
        <div className="mkt-nav-links">
          <a href="#nasil-calisiyor">Nasıl çalışıyor?</a>
          <a href="#kurulum">Kurulum</a>
        </div>
        <a className="mkt-nav-cta" href="#kurulum">Birlikte kuralım</a>
      </nav>
    </header>
  );
}

function EaseStrip() {
  return (
    <section className="mkt-ease-strip" aria-label="Randevu kolaylık özeti">
      <article>
        <span>01</span>
        <strong>Müşteri kendi alsın.</strong>
        <p>Uygun saati görsün, seçsin, bitsin.</p>
      </article>
      <article>
        <span>02</span>
        <strong>Bakınca belli.</strong>
        <p>Takvim, çalışan ve randevu aynı yerde.</p>
      </article>
      <article>
        <span>03</span>
        <strong>Sen kurma.</strong>
        <p>Kurulumda da seni uğraştırmayalım.</p>
      </article>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mkt-final-cta" id="kurulum" aria-labelledby="mkt-final-title">
      <div className="mkt-final-orb" aria-hidden="true" />
      <p className="mkt-eyebrow">Hazırsan</p>
      <h2 id="mkt-final-title">Randevu kolay.<br />İşin sana kalsın.</h2>
      <p>İşletmeni birlikte hazırlayalım, randevu tarafını sadeleştirelim.</p>
      <button
        className="mkt-button mkt-button--dark"
        type="button"
        disabled
        title="İletişim akışı route entegrasyonuyla birlikte aktif olacak"
      >
        Birlikte kuralım
        <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}

export function MarketingHome() {
  return (
    <div className="mkt-root" id="top">
      <MarketingNav />
      <main>
        <MarketingHero />
        <EaseStrip />
        <TransformationSection />
        <FinalCta />
      </main>
    </div>
  );
}
