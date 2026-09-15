import { useRef, useState } from "react";

import { MARKETING_ASSETS } from "../assets";
import { MARKETING_RELEASE_GATES } from "../releaseGates";
import "./frame-sequence.css";
import "./transformation-tuning.css";
import { useFrameSequenceScrollScrub } from "./useFrameSequenceScrollScrub";
import { usePrefersReducedMotion, useVideoScrollScrub } from "./useVideoScrollScrub";

interface StoryProps {
  active: boolean;
}

function ReminderStory({ active }: StoryProps) {
  const reminderReleased = MARKETING_RELEASE_GATES.reminders;
  const customerMemoryReleased = MARKETING_RELEASE_GATES.customerMemory;

  return (
    <div className="mkt-story mkt-story--reminder" aria-hidden={!active}>
      <p className="mkt-eyebrow">{reminderReleased || customerMemoryReleased ? "Randevu Kolay" : "Yakında"}</p>
      <h2>
        {reminderReleased
          ? "Unuttu mu? Biz hatırlatırız."
          : customerMemoryReleased
            ? "Müşteri kimdi? Hatırlamak zorunda değilsin."
            : "Müşteri detayları da sırada."}
      </h2>
      <p className="mkt-story-copy">
        {reminderReleased
          ? "Randevu yaklaşınca saatini sistem takip etsin."
          : customerMemoryReleased
            ? "Son randevusu ve notu bir yerde dursun. Hatırlatma akışını da hazırlıyoruz."
            : "Müşteri geçmişi ve notları için kabul süreci tamamlandığında burada gerçek ürün kanıtını göstereceğiz. Hatırlatma akışını da hazırlıyoruz."}
      </p>
      <div className="mkt-proof-stack" aria-label="Randevu ürün kanıtları">
        {reminderReleased ? (
          <div className="mkt-proof-card mkt-proof-card--reminder">
            <span className="mkt-proof-kicker">Randevu hatırlatması</span>
            <strong>Randevunuz yarın 14:30&apos;da.</strong>
            <span>Saç kesimi</span>
          </div>
        ) : (
          <div className="mkt-proof-card mkt-proof-card--reminder">
            <span className="mkt-proof-kicker">Yakında</span>
            <strong>Hatırlatma akışı hazırlanıyor.</strong>
            <span>Yayına girdiğinde burada gerçek akışı göstereceğiz.</span>
          </div>
        )}
        {customerMemoryReleased ? (
          <div className="mkt-proof-card mkt-proof-card--customer">
            <div><span className="mkt-proof-kicker">Müşteri</span><strong>Burcu Yılmaz</strong></div>
            <dl>
              <div><dt>Son ziyaret</dt><dd>12 Ekim</dd></div>
              <div><dt>Hizmet</dt><dd>Saç kesimi</dd></div>
              <div><dt>Not</dt><dd>Katlı kesim</dd></div>
            </dl>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FrictionStory({ active }: StoryProps) {
  return (
    <div className="mkt-story mkt-story--friction" aria-hidden={!active}>
      <p className="mkt-eyebrow">Karışıklık azalırken</p>
      <h2>Uğraş? <span>Az.</span></h2>
      <div className="mkt-friction-chips" aria-label="Azalan işler"><span>Deftere bak...</span><span>Kim boştu?</span><span>Tek tek ara...</span></div>
    </div>
  );
}

function SweepStory({ active }: StoryProps) {
  return (
    <div className="mkt-story mkt-story--sweep" aria-hidden={!active}>
      <p className="mkt-eyebrow">Kurulum da kolay</p>
      <h2>Sen uğraşma.<br />Biz toparlayalım.</h2>
      <p className="mkt-story-copy">Hizmetlerini, çalışanlarını ve çalışma saatlerini birlikte hazırlayalım.</p>
      <div className="mkt-sweep-line" aria-hidden="true"><span /></div>
    </div>
  );
}

function PricingStory({ active }: StoryProps) {
  return (
    <div className="mkt-story mkt-story--pricing" aria-hidden={!active}>
      <p className="mkt-eyebrow">Fiyatlandırma yakında</p>
      <h2>Fiyatı da kolay olsun.</h2>
      <p className="mkt-story-copy">Paket yapısı netleştiğinde fiyatı burada açıkça göstereceğiz.</p>
      <div className="mkt-pricing-card" data-pricing-policy-ready={MARKETING_RELEASE_GATES.pricingPolicy ? "true" : "false"}>
        <div><span className="mkt-proof-kicker">Yayın öncesi</span><strong>Fiyat politikası netleşiyor.</strong><p>Fiyat ve paket yapısı yayın öncesi ticari kararla netleşecek.</p></div>
        <a className="mkt-button mkt-button--lime" href="#kurulum" tabIndex={active ? 0 : -1}>Birlikte kuralım<span aria-hidden="true">→</span></a>
      </div>
    </div>
  );
}

function StaticTransformationFallback() {
  return (
    <section className="mkt-transformation-fallback" id="donusum" aria-labelledby="mkt-fallback-title">
      <div className="mkt-fallback-panel mkt-fallback-panel--motion-start">
        <p className="mkt-eyebrow">Randevu Kolay</p><h2 id="mkt-fallback-title">Karışıklık gider, düzen kalır.</h2><p>Müşteri kendi alsın. Müşteri detayları ve hatırlatma akışları hazır olduğunda burada gerçek ürün kanıtıyla gösterelim. Kurulumda da seni yalnız bırakmayalım.</p>
      </div>
      <div className="mkt-fallback-panel mkt-fallback-panel--pricing mkt-fallback-panel--motion-final">
        <p className="mkt-eyebrow">Sonuç</p><h2>Fiyatı da kolay olsun.</h2><p>Randevu kolay. İşin sana kalsın.</p>
      </div>
    </section>
  );
}

function isFrameRendererRequested(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.mktRenderer === "frames";
}

export function TransformationSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const frameRenderer = isFrameRendererRequested();
  const videoScrub = useVideoScrollScrub(sectionRef, videoRef, reducedMotion || videoFailed || frameRenderer);
  const frameScrub = useFrameSequenceScrollScrub(sectionRef, canvasRef, reducedMotion || !frameRenderer);
  const phase = frameRenderer ? frameScrub.phase : videoScrub.phase;
  const mediaReady = frameRenderer ? frameScrub.frameReady : videoScrub.metadataReady;
  const rendererFailed = frameRenderer ? frameScrub.failed : videoFailed;
  const showDebug = import.meta.env.DEV
    && typeof document !== "undefined"
    && document.documentElement.dataset.mktDebug === "true";

  if (reducedMotion || rendererFailed) return <StaticTransformationFallback />;

  return (
    <section
      ref={sectionRef}
      className="mkt-transformation"
      id="donusum"
      data-phase={phase}
      data-renderer={frameRenderer ? "frames" : "video"}
      aria-label="Randevu kolay dönüşüm hikayesi"
    >
      <div className="mkt-transformation-stage">
        {frameRenderer ? (
          <canvas ref={canvasRef} className="mkt-transformation-frame-canvas" aria-hidden="true" />
        ) : (
          <video ref={videoRef} className="mkt-transformation-video" muted playsInline preload="metadata" poster={MARKETING_ASSETS.transformationPoster} aria-hidden="true" tabIndex={-1} onError={() => setVideoFailed(true)}>
            <source media="(max-width: 680px)" src={MARKETING_ASSETS.transformationMobileVideo} type="video/mp4" />
            <source src={MARKETING_ASSETS.transformationVideo} type="video/mp4" />
          </video>
        )}
        <div className="mkt-video-shade" aria-hidden="true" />
        <div className="mkt-story-layer"><ReminderStory active={phase === "reminder"} /><FrictionStory active={phase === "friction"} /><SweepStory active={phase === "sweep"} /><PricingStory active={phase === "pricing"} /></div>
        <div className="mkt-scroll-cue" aria-hidden="true"><span>{mediaReady ? "Kaydır" : "Hazırlanıyor"}</span><i /></div>
        {showDebug ? <div className="mkt-progress-debug" aria-hidden="true"><span /></div> : null}
      </div>
    </section>
  );
}
