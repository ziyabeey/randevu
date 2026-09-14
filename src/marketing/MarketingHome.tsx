import "./marketing.css";
import "./marketing-sections.css";
import "./marketing-overrides.css";

import { MarketingHero } from "./MarketingHero";
import { ProductStorySections, TrustSections } from "./ProductStorySections";
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
          <a href="#nasil-calisiyor">Nasıl çalışır?</a>
          <a href="#isletmen-icin">İşletmen için</a>
          <a href="#yardim">Yardım</a>
        </div>
        <a className="mkt-nav-cta" href="#kurulum">Birlikte kuralım</a>
      </nav>
    </header>
  );
}

function EaseStrip() {
  return (
    <section className="mkt-ease-strip mkt-ease-strip--phrases" aria-label="Randevu kolaylık özeti">
      <strong>Defter azalsın.</strong>
      <strong>Telefon trafiği azalsın.</strong>
      <strong>Takvim belli olsun.</strong>
      <strong>İşin sana kalsın.</strong>
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
        <ProductStorySections />
        <TransformationSection />
        <TrustSections />
        <FinalCta />
      </main>
    </div>
  );
}
