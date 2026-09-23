import { useState } from "react";

import { MARKETING_ASSETS } from "./assets";
import "./hero-media.css";

const heroPills = [
  { key: "online", label: "7/24 online randevu", icon: "M4 6h16v13H4zM4 10h16M8 3v4M16 3v4" },
  { key: "customers", label: "Daha fazla mutlu müşteri", icon: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M21 20a6 6 0 0 0-5-5.9" },
  { key: "freedom", label: "Daha düzenli ve özgür bir sen", icon: "M8 3h8v18H8zM12 17h.01" },
] as const;

function PillIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function MarketingHero() {
  // When the hero photo is unavailable (binary handoff pending or a CDN miss)
  // the section falls back to the brand composition: full-strength cobalt
  // organic form and no space reserved for the photo.
  const [mediaFailed, setMediaFailed] = useState(false);

  return (
    <section className="mkt-hero" aria-labelledby="mkt-hero-title" data-hero-media={mediaFailed ? "missing" : "photo"}>
      {mediaFailed ? null : (
        <div className="mkt-hero-media" aria-hidden="true">
          <img
            src={MARKETING_ASSETS.heroModel}
            alt=""
            width={1928}
            height={1072}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            draggable={false}
            onError={() => setMediaFailed(true)}
          />
        </div>
      )}
      <div className="mkt-hero-shape mkt-hero-shape--one" aria-hidden="true" />
      <div className="mkt-hero-shape mkt-hero-shape--two" aria-hidden="true" />

      <div className="mkt-hero-copy">
        <p className="mkt-eyebrow">Randevu Kolay</p>
        <h1 id="mkt-hero-title">Randevu <span className="mkt-hero-kolay">kolay.</span></h1>
        <p className="mkt-hero-lead">Müşteri kendi alsın. Takvimin karışmasın. Kurulumla da seni uğraştırmayalım.</p>
        <p className="mkt-hero-trust">Kuaför, berber ve güzellik işletmeleri için.</p>
        <div className="mkt-hero-actions">
          <a className="mkt-button mkt-button--lime" href="#kurulum">Birlikte kuralım<span aria-hidden="true">→</span></a>
          <a className="mkt-text-link" href="#nasil-calisiyor">Nasıl çalışıyor?<span aria-hidden="true">↓</span></a>
        </div>
        <ul className="mkt-hero-pills" aria-label="Randevu Kolay ile">
          {heroPills.map((pill) => (
            <li key={pill.key}>
              <i><PillIcon path={pill.icon} /></i>
              <span>{pill.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mkt-hero-sticker" aria-hidden="true">Güzellik işiniz,<br />size kalsın.</p>

      <div className="mkt-hero-demo" aria-label="Randevu akışı örneği">
        <div className="mkt-demo-card">
          <div className="mkt-demo-topline"><strong>Randevu al</strong><span className="mkt-live-dot">Online</span></div>
          <div className="mkt-demo-field">
            <small>Hizmet seç</small>
            <div className="mkt-demo-select"><i aria-hidden="true">✂</i><span><strong>Saç kesimi</strong><em>45 dk</em></span><b aria-hidden="true">⌄</b></div>
          </div>
          <div className="mkt-demo-field">
            <small>Tarih seç</small>
            <div className="mkt-demo-select"><i aria-hidden="true">▦</i><span><strong>Cumartesi</strong><em>bu hafta</em></span><b aria-hidden="true">⌄</b></div>
          </div>
          <div className="mkt-demo-field">
            <small>Saat seç</small>
            <div className="mkt-demo-slots" aria-hidden="true"><span>11:00</span><span>12:00</span><span className="is-selected">14:30</span><span>16:00</span></div>
          </div>
          <div className="mkt-demo-confirm" aria-hidden="true">Randevuyu onayla<span>→</span></div>
        </div>
        <div className="mkt-hero-note">Bakınca belli.</div>
      </div>
    </section>
  );
}
