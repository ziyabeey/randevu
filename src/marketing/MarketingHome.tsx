import { useEffect, useRef, useState, type MouseEvent } from "react";

import "./marketing.css";
import "./marketing-sections.css";
import "./marketing-overrides.css";
import "./marketing-polish.css";
import "./mobile-nav.css";
import "./final-cta.css";
import "./skip-link.css";

import { MarketingHero } from "./MarketingHero";
import { ProductStorySections, TrustSections } from "./ProductStorySections";
import { MARKETING_CONTACT_HREF } from "./releaseGates";
import { WORKSPACE_HOME_PATH } from "./routePlan";
import { TransformationSection } from "./transformation/TransformationSection";
import { useMarketingDocumentMeta } from "./useMarketingDocumentMeta";

function MarketingNav() {
  const [compact, setCompact] = useState(false);
  const mobileMenuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    let frame: number | null = null;

    const sync = () => {
      frame = null;
      setCompact(window.scrollY > 72);
    };

    const onScroll = () => {
      if (frame === null) {
        frame = window.requestAnimationFrame(sync);
      }
    };

    sync();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  const closeMobileMenu = () => {
    mobileMenuRef.current?.removeAttribute("open");
  };

  const handleMobileSectionClick = (event: MouseEvent<HTMLAnchorElement>, targetHash: string) => {
    const keyboardActivation = event.detail === 0;
    closeMobileMenu();

    if (!keyboardActivation) {
      return;
    }

    event.preventDefault();
    const target = document.querySelector<HTMLElement>(targetHash);
    window.history.pushState(null, "", targetHash);
    target?.scrollIntoView({ block: "start" });
    mobileMenuRef.current?.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
  };

  return (
    <header className={`mkt-nav-shell${compact ? " is-compact" : ""}`}>
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

        <details className="mkt-mobile-nav" ref={mobileMenuRef}>
          <summary aria-label="Randevu menüsü">
            <span>Menü</span>
            <i aria-hidden="true">+</i>
          </summary>
          <div className="mkt-mobile-nav-panel">
            <a href="#nasil-calisiyor" onClick={(event) => handleMobileSectionClick(event, "#nasil-calisiyor")}>Nasıl çalışır?</a>
            <a href="#isletmen-icin" onClick={(event) => handleMobileSectionClick(event, "#isletmen-icin")}>İşletmen için</a>
            <a href="#donusum" onClick={(event) => handleMobileSectionClick(event, "#donusum")}>Dönüşüm</a>
            <a href="#yardim" onClick={(event) => handleMobileSectionClick(event, "#yardim")}>Yardım</a>
            <a href={WORKSPACE_HOME_PATH} onClick={closeMobileMenu}>Giriş yap</a>
          </div>
        </details>

        <div className="mkt-nav-actions">
          <a className="mkt-nav-login" href={WORKSPACE_HOME_PATH}>Giriş yap</a>
          <a className="mkt-nav-cta" href="#kurulum">Birlikte kuralım</a>
        </div>
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

      {MARKETING_CONTACT_HREF ? (
        <a className="mkt-button mkt-button--dark" href={MARKETING_CONTACT_HREF}>
          Birlikte kuralım
          <span aria-hidden="true">→</span>
        </a>
      ) : (
        <button
          className="mkt-button mkt-button--dark"
          type="button"
          disabled
          title="İletişim akışı yayın entegrasyonuyla birlikte aktif olacak"
        >
          Birlikte kuralım
          <span aria-hidden="true">→</span>
        </button>
      )}

      <div className="mkt-final-lockup" aria-label="Randevu kolay">
        <span>randevu</span>
        <small>kolay</small>
      </div>
    </section>
  );
}

function MarketingFooter() {
  return (
    <footer className="mkt-footer">
      <div>
        <strong>Kepenk.ai ürünü</strong>
        <span>randevu.kepenk.ai</span>
      </div>
      <a href="#top">Yukarı dön <span aria-hidden="true">↑</span></a>
    </footer>
  );
}

export function MarketingHome() {
  useMarketingDocumentMeta();

  const handleSkipToContent = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const main = document.getElementById("mkt-main");
    if (!main) {
      return;
    }

    window.history.pushState(null, "", "#mkt-main");
    main.scrollIntoView({ block: "start" });
    main.focus({ preventScroll: true });
  };

  return (
    <div className="mkt-root" id="top">
      <a className="mkt-skip-link" href="#mkt-main" onClick={handleSkipToContent}>İçeriğe geç</a>
      <MarketingNav />
      <main id="mkt-main" tabIndex={-1}>
        <MarketingHero />
        <EaseStrip />
        <ProductStorySections />
        <TransformationSection />
        <TrustSections />
        <FinalCta />
      </main>
      <MarketingFooter />
    </div>
  );
}
