import { useRef, useState } from "react";

import { usePrefersReducedMotion, useVideoScrollScrub } from "./useVideoScrollScrub";

const VIDEO_MP4 = "/marketing/transformation/randevu-transformation-master.mp4";
const VIDEO_POSTER = "/marketing/transformation/randevu-transformation-poster.webp";

interface StoryProps {
  active: boolean;
}

function ReminderStory({ active }: StoryProps) {
  return (
    <div className="mkt-story mkt-story--reminder" aria-hidden={!active}>
      <p className="mkt-eyebrow">Kepenk.ai sunar</p>
      <h2>Unuttu mu? Biz hatırlatırız.</h2>
      <p className="mkt-story-copy">Müşteri kimdi? Hatırlamak zorunda değilsin.</p>

      <div className="mkt-proof-stack" aria-label="Randevu ürün kanıtları">
        <div className="mkt-proof-card mkt-proof-card--reminder">
          <span className="mkt-proof-kicker">Randevu hatırlatması</span>
          <strong>Randevunuz yarın 14:30&apos;da.</strong>
          <span>Saç kesimi</span>
        </div>
        <div className="mkt-proof-card mkt-proof-card--customer">
          <div>
            <span className="mkt-proof-kicker">Müşteri</span>
            <strong>Burcu Yılmaz</strong>
          </div>
          <dl>
            <div>
              <dt>Son ziyaret</dt>
              <dd>12 Ekim</dd>
            </div>
            <div>
              <dt>Hizmet</dt>
              <dd>Saç kesimi</dd>
            </div>
            <div>
              <dt>Not</dt>
              <dd>Katlı kesim</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}

function FrictionStory({ active }: StoryProps) {
  return (
    <div className="mkt-story mkt-story--friction" aria-hidden={!active}>
      <p className="mkt-eyebrow">Karışıklık azalırken</p>
      <h2>Uğraş? <span>Az.</span></h2>
      <div className="mkt-friction-chips" aria-label="Azalan işler">
        <span>Deftere bak...</span>
        <span>Kim boştu?</span>
        <span>Tek tek ara...</span>
      </div>
    </div>
  );
}

function SweepStory({ active }: StoryProps) {
  return (
    <div className="mkt-story mkt-story--sweep" aria-hidden={!active}>
      <p className="mkt-eyebrow">Kurulum da kolay</p>
      <h2>Sen uğraşma.<br />Biz toparlayalım.</h2>
      <p className="mkt-story-copy">
        Hizmetlerini, çalışanlarını ve çalışma saatlerini birlikte hazırlayalım.
      </p>
      <div className="mkt-sweep-line" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}

function PricingStory({ active }: StoryProps) {
  return (
    <div className="mkt-story mkt-story--pricing" aria-hidden={!active}>
      <p className="mkt-eyebrow">Karar vermesi de kolay</p>
      <h2>Fiyatı da kolay olsun.</h2>
      <p className="mkt-story-copy">Ne alacağını, ne ödeyeceğini ilk bakışta gör.</p>

      <div className="mkt-pricing-card">
        <div>
          <span className="mkt-proof-kicker">Randevu</span>
          <strong>Net fiyat, sürpriz yok.</strong>
          <p>Fiyat ve paket yapısı yayın öncesi ticari kararla netleşecek.</p>
        </div>
        <a className="mkt-button mkt-button--lime" href="#kurulum">
          Birlikte kuralım
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  );
}

function StaticTransformationFallback() {
  return (
    <section className="mkt-transformation-fallback" id="nasil-calisiyor" aria-labelledby="mkt-fallback-title">
      <div className="mkt-fallback-panel">
        <p className="mkt-eyebrow">Kepenk.ai sunar</p>
        <h2 id="mkt-fallback-title">Karışıklık gider, düzen kalır.</h2>
        <p>
          Müşteri kendi alsın, sistem hatırlatsın, kurulumda da seni yalnız bırakmayalım.
        </p>
      </div>
      <div className="mkt-fallback-panel mkt-fallback-panel--pricing">
        <p className="mkt-eyebrow">Sonuç</p>
        <h2>Fiyatı da kolay olsun.</h2>
        <p>Randevu kolay. İşin sana kalsın.</p>
      </div>
    </section>
  );
}

export function TransformationSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const { phase, metadataReady } = useVideoScrollScrub(sectionRef, videoRef, reducedMotion || videoFailed);

  if (reducedMotion || videoFailed) {
    return <StaticTransformationFallback />;
  }

  return (
    <section
      ref={sectionRef}
      className="mkt-transformation"
      id="nasil-calisiyor"
      data-phase={phase}
      aria-label="Randevu kolay dönüşüm hikayesi"
    >
      <div className="mkt-transformation-stage">
        <video
          ref={videoRef}
          className="mkt-transformation-video"
          muted
          playsInline
          preload="auto"
          poster={VIDEO_POSTER}
          aria-hidden="true"
          tabIndex={-1}
          onError={() => setVideoFailed(true)}
        >
          <source src={VIDEO_MP4} type="video/mp4" />
        </video>

        <div className="mkt-video-shade" aria-hidden="true" />
        <div className="mkt-story-layer">
          <ReminderStory active={phase === "reminder"} />
          <FrictionStory active={phase === "friction"} />
          <SweepStory active={phase === "sweep"} />
          <PricingStory active={phase === "pricing"} />
        </div>

        <div className="mkt-scroll-cue" aria-hidden="true">
          <span>{metadataReady ? "Kaydır" : "Hazırlanıyor"}</span>
          <i />
        </div>

        {import.meta.env.DEV ? (
          <div className="mkt-progress-debug" aria-hidden="true">
            <span />
          </div>
        ) : null}
      </div>
    </section>
  );
}
