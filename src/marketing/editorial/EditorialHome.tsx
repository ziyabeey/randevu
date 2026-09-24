import { forwardRef, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";

import { EDITORIAL_ASSETS } from "./assets";
import { SALON_FILM, SALON_FILM_POSTER, useSalonFilmSupport } from "./salonFilm";
import { MARKETING_CONTACT_HREF, MARKETING_RELEASE_GATES } from "../releaseGates";
import { WORKSPACE_HOME_PATH } from "../routePlan";
import { useFrameSequenceScrollScrub } from "../transformation/useFrameSequenceScrollScrub";
import { usePrefersReducedMotion } from "../transformation/useVideoScrollScrub";
import { useMarketingDocumentMeta } from "../useMarketingDocumentMeta";
import "./editorial.css";
import { useDayClock, useDepthParallax, useEditorialFonts, useSceneProgress, useSingleKolay } from "./hooks";
import { useJourney } from "./useJourney";

/*
 * Randevu Kolay — "Bir salonun günü" (art direction 2026-09-24).
 * The page is one Saturday in a salon: the shutter (kepenk) rolls up at 09:00,
 * the clock in the header advances chapter by chapter, the sky follows the
 * light of the day, and a single lime "kolay" carries one appointment from the
 * headline to the shutter that comes down at 19:30.
 */

function ChapterMark({ time, index, title }: { time: string; index: string; title: string }) {
  return (
    <p className="ed-mark">
      <time>{time}</time>
      <span>Bölüm {index}</span>
      <em>{title}</em>
    </p>
  );
}

/* ---------------------------------------------------------------- header */

const menuChapters = [
  { href: "#nasil-calisiyor", time: "10:30", label: "Müşteri kendi alsın" },
  { href: "#isletmen-icin", time: "12:00", label: "Kim boş, kim dolu?" },
  { href: "#donusum", time: "14:30", label: "Salonda" },
  { href: "#gun-sonu", time: "19:00", label: "Gün sonu" },
  { href: "#yardim", time: "—", label: "Sorular" },
];

function EdNav() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    document.documentElement.classList.toggle("ed-menu-open", open);
    // Keyboard users land inside the opened menu and back on its button when it closes.
    if (open) menuRef.current?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
    else if (wasOpen.current) buttonRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
    if (!open) return undefined;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const followChapter = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    setOpen(false);
    // A keyboard fragment jump would drop focus on <body>; scroll here instead
    // so focus can go back to the menu button.
    if (event.detail !== 0) return;
    event.preventDefault();
    window.history.pushState(null, "", href);
    document.querySelector<HTMLElement>(href)?.scrollIntoView({ block: "start" });
  };

  return (
    <header className="ed-nav">
      <a className="ed-wordmark" href="#top" aria-label="Randevu Kolay ana sayfa">randevu<em>kolay</em></a>
      <p className="ed-clock">
        <i aria-hidden="true" />
        <span data-ed-clock>09:00</span>
        <em data-ed-chapter>Açılış</em>
      </p>
      <nav className="ed-links" aria-label="Bölümler">
        <a href="#nasil-calisiyor">Nasıl çalışır</a>
        <a href="#isletmen-icin">Takvim</a>
        <a href="#yardim">Sorular</a>
      </nav>
      <div className="ed-nav-actions">
        <a className="ed-login" href={WORKSPACE_HOME_PATH}>Giriş yap</a>
        <a className="ed-cta" href="#kurulum"><span>Birlikte kuralım</span><b aria-hidden="true">→</b></a>
        <button ref={buttonRef} className="ed-menu-button" type="button" aria-expanded={open} aria-controls="ed-menu" onClick={() => setOpen((value) => !value)}>
          {open ? "Kapat" : "Menü"}
        </button>
      </div>
      <div ref={menuRef} className="ed-menu" id="ed-menu" data-open={open ? "true" : "false"} aria-hidden={!open}>
        <p className="ed-menu-kicker">Bugünün akışı</p>
        <ol>
          {menuChapters.map((chapter) => (
            <li key={chapter.href}>
              <a href={chapter.href} tabIndex={open ? 0 : -1} onClick={(event) => followChapter(event, chapter.href)}>
                <time>{chapter.time}</time>
                <span>{chapter.label}</span>
              </a>
            </li>
          ))}
        </ol>
        <a className="ed-menu-login" href={WORKSPACE_HOME_PATH} tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}>Giriş yap →</a>
      </div>
    </header>
  );
}

/* --------------------------------------------------------------- shutter */

function ShutterSlats() {
  return <span className="ed-slats" aria-hidden="true" />;
}

/** 09:00 — the page opens the way a shop does: the kepenk rolls up. */
function OpeningShutter({ disabled }: { disabled: boolean }) {
  const [state, setState] = useState<"closed" | "opening" | "gone">(disabled ? "gone" : "closed");

  useEffect(() => {
    if (disabled) {
      setState("gone");
      return undefined;
    }
    let opened = false;
    let removeTimer = 0;
    const open = () => {
      if (opened) return;
      opened = true;
      setState("opening");
      removeTimer = window.setTimeout(() => setState("gone"), 1700);
    };
    const autoTimer = window.setTimeout(open, 1100);
    window.addEventListener("wheel", open, { passive: true });
    window.addEventListener("touchstart", open, { passive: true });
    window.addEventListener("keydown", open);
    return () => {
      window.clearTimeout(autoTimer);
      window.clearTimeout(removeTimer);
      window.removeEventListener("wheel", open);
      window.removeEventListener("touchstart", open);
      window.removeEventListener("keydown", open);
    };
  }, [disabled]);

  if (state === "gone") return null;
  return (
    <div className={`ed-shutter ed-shutter--opening${state === "opening" ? " is-open" : ""}`} aria-hidden="true">
      <ShutterSlats />
      <div className="ed-paint">
        <span className="ed-paint-word">randevu</span>
        <em className="ed-paint-kolay" data-kolay>kolay</em>
        <small>Cumartesi · 09:00&apos;da açılıyor</small>
      </div>
      <span className="ed-shutter-lip" />
    </div>
  );
}

/* ----------------------------------------------------------- shop objects */

type ShopObject = "ustura" | "makas-tarak";

/** One cut-out object from the shop, sharp or pre-blurred; decorative only. */
function ObjectImage({ name, focus }: { name: ShopObject; focus: "sharp" | "blur" }) {
  const base = `/marketing/editorial/objects/${name}-${focus}`;
  return (
    <picture className={`ed-object-img ed-object-img--${focus}`}>
      <source type="image/avif" srcSet={`${base}.avif`} />
      <img src={`${base}.webp`} alt="" loading="lazy" decoding="async" draggable={false} />
    </picture>
  );
}

/** A floating object on its depth layer: `speed` is its drift against the scroll, `shrink` how much it recedes. */
function DepthObject({ name, focus, speed, shrink = 0, className }: { name: ShopObject; focus: "sharp" | "blur"; speed: number; shrink?: number; className: string }) {
  return (
    <span className={`ed-depth ${className}`} data-depth={speed} data-shrink={shrink || undefined} aria-hidden="true">
      <ObjectImage name={name} focus={focus} />
    </span>
  );
}

/* ------------------------------------------------------------------ hero */

function EdHero() {
  const [mediaFailed, setMediaFailed] = useState(false);

  return (
    <section className="ed-hero" id="acilis" aria-labelledby="ed-hero-title">
      <div className="ed-meta">
        <span>Sayı 01 — Bir salonun günü</span>
        <span>Cumartesi · 09:00</span>
      </div>
      <h1 id="ed-hero-title" className="ed-hero-title">
        <span className="ed-hero-randevu">Randevu</span>{" "}
        <span className="ed-hero-kolay" data-journey-anchor="word" data-kolay>kolay.</span>
      </h1>
      {mediaFailed ? null : (
        <figure className="ed-mirror">
          <picture className="ed-mirror-glass">
            <source type="image/avif" srcSet={EDITORIAL_ASSETS.heroPortrait.avifSrcSet} sizes="(max-width: 760px) 92vw, 440px" />
            <img
              src={EDITORIAL_ASSETS.heroPortrait.src}
              srcSet={EDITORIAL_ASSETS.heroPortrait.webpSrcSet}
              sizes="(max-width: 760px) 92vw, 440px"
              alt=""
              width={EDITORIAL_ASSETS.heroPortrait.width}
              height={EDITORIAL_ASSETS.heroPortrait.height}
              loading="eager"
              decoding="async"
              fetchPriority="high"
              draggable={false}
              onError={() => setMediaFailed(true)}
            />
          </picture>
          <figcaption>Şekil 01 — Saat dokuz. Kepenk açık, ilk müşteri yolda.</figcaption>
        </figure>
      )}
      <div className="ed-hero-foot">
        <p className="ed-lead">Müşteri kendi alsın. Takvimin karışmasın. Kurulumla da seni uğraştırmayalım.</p>
        <p className="ed-trust">Kuaför, berber ve güzellik işletmeleri için.</p>
        <div className="ed-actions">
          <a className="ed-cta ed-cta--big" href="#kurulum"><span>Birlikte kuralım</span><b aria-hidden="true">→</b></a>
          <a className="ed-textlink" href="#nasil-calisiyor">Nasıl çalışıyor? <span aria-hidden="true">↓</span></a>
        </div>
      </div>
      <p className="ed-scroll-cue" aria-hidden="true">Kaydır — <em>günü</em> takip et</p>
      <DepthObject name="ustura" focus="blur" speed={0.42} className="ed-depth--front ed-depth--ustura" />
    </section>
  );
}

/* --------------------------------------------------------------- booking */

const phoneServices = [
  { name: "Saç + sakal", duration: "45 dk", target: true },
  { name: "Saç kesimi", duration: "30 dk", target: false },
  { name: "Sakal", duration: "20 dk", target: false },
];
const phoneTimes = ["11:00", "12:00", "14:30", "16:00", "17:30", "18:00"];

function BookingChapter({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useSceneProgress(ref, reduced || !MARKETING_RELEASE_GATES.publicBooking);
  if (!MARKETING_RELEASE_GATES.publicBooking) return null;

  return (
    <section ref={ref} className="ed-scene ed-booking" id="nasil-calisiyor" aria-labelledby="ed-booking-title">
      <div className="ed-stage">
        <div className="ed-copy">
          <ChapterMark time="10:30" index="01" title="İlk randevu" />
          <h2 id="ed-booking-title">Müşteri <em>kendi</em> alsın.</h2>
          <p>Hizmeti seçsin, uygun saatini görsün, randevusunu tamamlasın. Sen her mesajın peşinden koşma.</p>
          <ol className="ed-steps" aria-label="Online rezervasyon adımları">
            <li><time>01</time>Hizmetini seçer.</li>
            <li><time>02</time>Uygun saati görür.</li>
            <li><time>03</time>Randevu tamam.</li>
          </ol>
          <p className="ed-note">Linki paylaş. Gerisini müşteri tamamlasın.</p>
        </div>

        <DepthObject name="makas-tarak" focus="blur" speed={-0.14} shrink={0.28} className="ed-depth--back ed-depth--makas" />
        <div className="ed-phone" aria-hidden="true">
          <div className="ed-phone-screen">
            <div className="ed-phone-top"><strong>Randevu al</strong><span>Açık</span></div>
            <div className="ed-phone-track">
              <div className="ed-phone-panel ed-phone-panel--service">
                <small>Hizmet seç</small>
                <ul>
                  {phoneServices.map((service) => (
                    <li className={service.target ? "is-target" : undefined} data-journey-anchor={service.target ? "service" : undefined} key={service.name}>
                      <span>{service.name}</span><em>{service.duration}</em><b>✓</b>
                    </li>
                  ))}
                </ul>
                <span className="ed-phone-next">Saati seç →</span>
              </div>
              <div className="ed-phone-panel ed-phone-panel--time">
                <small>Cumartesi · uygun saatler</small>
                <div className="ed-phone-slots">
                  {phoneTimes.map((time) => (
                    <i className={time === "14:30" ? "is-target" : undefined} data-journey-anchor={time === "14:30" ? "slot" : undefined} key={time}>{time}</i>
                  ))}
                </div>
                <span className="ed-phone-next">Randevuyu onayla →</span>
              </div>
              <div className="ed-phone-panel ed-phone-panel--done">
                <b className="ed-phone-check">✓</b>
                <strong>Randevu tamam.</strong>
                <span className="ed-phone-chip" data-journey-anchor="done">Cmt 14:30 · Saç + sakal</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- calendar */

type Entry = { start: number; length: number; label: string; tone?: "ink" | "hatch" };

// Half-hour rows from 10:00 to 17:00. Hasan usta's 14:30 line is the empty one the appointment lands on.
const book: Array<{ name: string; entries: Entry[]; slot?: Entry }> = [
  { name: "Hasan usta", entries: [{ start: 0, length: 2, label: "Saç + sakal" }, { start: 2, length: 4, label: "Damat tıraşı", tone: "ink" }, { start: 12, length: 2, label: "Saç kesimi" }], slot: { start: 9, length: 2, label: "14:30" } },
  { name: "Emre", entries: [{ start: 1, length: 2, label: "Sakal", tone: "ink" }, { start: 4, length: 3, label: "Saç kesimi" }, { start: 7, length: 2, label: "Mola", tone: "hatch" }, { start: 10, length: 2, label: "Çocuk tıraşı", tone: "ink" }] },
  { name: "Can", entries: [{ start: 0, length: 3, label: "Cilt bakımı" }, { start: 5, length: 2, label: "Saç kesimi", tone: "ink" }, { start: 8, length: 3, label: "Sakal boyama" }, { start: 12, length: 2, label: "Sakal", tone: "ink" }] },
];
const bookHours = ["10", "11", "12", "13", "14", "15", "16", "17"];

function CalendarChapter({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useSceneProgress(ref, reduced || !MARKETING_RELEASE_GATES.calendarAvailability);
  if (!MARKETING_RELEASE_GATES.calendarAvailability) return null;

  let order = 0;
  return (
    <section ref={ref} className="ed-scene ed-calendar" id="isletmen-icin" aria-labelledby="ed-calendar-title">
      <div className="ed-stage">
        <div className="ed-copy">
          <ChapterMark time="12:00" index="02" title="Öğle arası" />
          <h2 id="ed-calendar-title">Kim boş, kim dolu? <em>Bakınca</em> belli.</h2>
          <p>Çalışan, saat ve randevu aynı yerde dursun. Çakışmayı sonradan fark etmek yerine baştan gör.</p>
          <blockquote className="ed-dialogue" aria-hidden="true">
            <p className="ed-dialogue-q">— 14.30 boş mu?</p>
            <p className="ed-dialogue-a">— Boştu. Yazıldı bile.</p>
          </blockquote>
        </div>

        <div className="ed-book-wrap">
          {/* 12:00 — the paper book is tied shut; the digital one slides over it. */}
          <picture className="ed-book-photo" aria-hidden="true">
            <source type="image/avif" srcSet={EDITORIAL_ASSETS.noonPhoto.avifSrcSet} sizes="(max-width: 760px) 92vw, 620px" />
            <img
              src={EDITORIAL_ASSETS.noonPhoto.src}
              srcSet={EDITORIAL_ASSETS.noonPhoto.webpSrcSet}
              sizes="(max-width: 760px) 92vw, 620px"
              alt=""
              width={EDITORIAL_ASSETS.noonPhoto.width}
              height={EDITORIAL_ASSETS.noonPhoto.height}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          </picture>
        <figure className="ed-book" aria-label="Günlük randevu görünümü örneği">
          <header><strong>Cumartesi</strong><span>3 çalışan · 10:00–17:00</span></header>
          <div className="ed-book-grid">
            <ol className="ed-book-hours" aria-hidden="true">
              {bookHours.map((hour, index) => <li key={hour} style={{ "--i": index } as CSSProperties}>{hour}<sup>00</sup></li>)}
            </ol>
            {book.map((column) => (
              <div className="ed-book-col" key={column.name}>
                <span className="ed-book-name">{column.name}</span>
                <div className="ed-book-lane">
                  {column.entries.map((entry) => (
                    <span
                      className={`ed-book-entry${entry.tone ? ` is-${entry.tone}` : ""}`}
                      style={{ "--start": entry.start, "--length": entry.length, "--order": order++ } as CSSProperties}
                      key={`${column.name}-${entry.start}`}
                    >
                      {entry.label}
                    </span>
                  ))}
                  {column.slot ? (
                    <span className="ed-book-entry ed-book-slot" data-journey-anchor="block" style={{ "--start": column.slot.start, "--length": column.slot.length } as CSSProperties}>
                      <strong>14:30<span className="ed-book-slot-service"> · Saç + sakal</span></strong><small>Kerem A.</small>
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <figcaption>Şekil 02 — Deftere bakmak yok. Gün bir bakışta.</figcaption>
        </figure>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- salon */

const salonBeats = [
  { phase: "reminder", title: <>Müşteri kimdi? <em>Hatırlamak</em> zorunda değilsin.</>, line: "— Yanlar iki numara, geçen seferki gibi. Not düşmüştük." },
  { phase: "friction", title: <>Uğraş? <em>Az.</em></>, line: "— Defter nerede? — Gerek yok, hepsi burada." },
  { phase: "sweep", title: <>Sen uğraşma. <em>Biz</em> toparlayalım.</>, line: "— Kurulumu siz mi yaptınız? — Birlikte yaptık." },
  { phase: "pricing", title: <>Fiyatı da <em data-kolay>kolay</em> olsun.</>, line: "— Ne kadar tutar? — Netleşince burada yazacak." },
] as const;

function SalonChapter({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const support = useSalonFilmSupport();
  const scrub = useFrameSequenceScrollScrub(ref, canvasRef, reduced || support !== "film", SALON_FILM);
  const still = reduced || support === "still" || scrub.failed;

  return (
    <section ref={ref} className={`ed-salon${still ? " is-still" : ""}`} id="donusum" data-phase={scrub.phase} aria-labelledby="ed-salon-title">
      <div className="ed-salon-stage">
        <div className="ed-bar ed-bar--top">
          <ChapterMark time="14:30" index="03" title="Salonda" />
          <span className="ed-rec" aria-hidden="true"><i />Cihangir · 14:30 – 19:00</span>
        </div>
        <div className="ed-screen">
          {still ? (
            <picture>
              <source type="image/avif" srcSet={SALON_FILM_POSTER.avif} />
              <img className="ed-salon-still" src={SALON_FILM_POSTER.webp} width={SALON_FILM_POSTER.width} height={SALON_FILM_POSTER.height} alt="" />
            </picture>
          ) : <canvas ref={canvasRef} className="ed-salon-canvas" aria-hidden="true" />}
          <span className="ed-badge-anchor" data-journey-anchor="badge" aria-hidden="true" />
          {MARKETING_RELEASE_GATES.customerMemory ? (
            <div className="ed-index-card" data-journey-anchor="card">
              <small>Müşteri kartı</small>
              <strong>Kerem Aydın</strong>
              <dl>
                <div><dt>Son ziyaret</dt><dd>12 Ekim</dd></div>
                <div><dt>Hizmet</dt><dd>Saç + sakal</dd></div>
                <div><dt>Not</dt><dd>Yanlar 2 numara</dd></div>
              </dl>
            </div>
          ) : null}
        </div>
        <h2 id="ed-salon-title" className="ed-visually-hidden">Salonda, saat 14:30</h2>
        <div className="ed-beats">
          {salonBeats.map((beat) => (
            <div className={`ed-beat ed-beat--${beat.phase}`} key={beat.phase} aria-hidden={scrub.phase !== beat.phase && !still}>
              <p className="ed-beat-title">{beat.title}</p>
              {beat.phase === "friction" ? (
                <ul className="ed-strikes" aria-label="Azalan işler">
                  <li>Deftere bak</li><li>Kim boştu?</li><li>Tek tek ara</li>
                </ul>
              ) : null}
              {beat.phase === "pricing" ? (
                <p className="ed-beat-note" data-pricing-policy-ready={MARKETING_RELEASE_GATES.pricingPolicy ? "true" : "false"}>
                  Fiyatlandırma yakında. Paket yapısı netleştiğinde burada açıkça göstereceğiz.
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <div className="ed-bar ed-bar--bottom">
          {salonBeats.map((beat) => (
            <p className={`ed-subtitle ed-subtitle--${beat.phase}`} key={beat.phase} aria-hidden="true">{beat.line}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ dusk */

const LEDGER = [
  { time: "10:00", name: "Cilt bakımı", state: "Tamamlandı", mark: "✓" },
  { time: "11:00", name: "Damat tıraşı", state: "Tamamlandı", mark: "✓" },
  { time: "14:30", name: "Saç + sakal", state: "Tamamlandı", mark: "✓", anchor: true },
  { time: "15:00", name: "Çocuk tıraşı", state: "Tamamlandı", mark: "✓" },
  { time: "16:00", name: "Sakal", state: "Tamamlandı", mark: "✓" },
];

/**
 * 19:00 → 19:30 in one pinned scene: the day's ledger holds while the shutter
 * comes down over it, and the day's appointment is painted on the steel as
 * "kolay.". `#kurulum` marks the painted shutter for the CTAs.
 */
function DuskChapter({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useSceneProgress(ref, reduced);
  const contactReady = MARKETING_CONTACT_HREF !== null;
  const ledger = MARKETING_RELEASE_GATES.dailyAppointmentSummary;

  return (
    <section ref={ref} className="ed-scene ed-dusk" id="gun-sonu" aria-label="Gün sonu" data-contact-flow-ready={contactReady ? "true" : "false"}>
      <span className="ed-dusk-anchor" id="kurulum" aria-hidden="true" />
      <div className="ed-stage">
        {ledger ? (
          <div className="ed-evening" role="group" aria-labelledby="ed-evening-title">
            <div className="ed-copy">
              <ChapterMark time="19:00" index="04" title="Gün sonu" />
              <h2 id="ed-evening-title">Bugün ne olmuş? <em>Tek yerde.</em></h2>
              <p>Günün randevularını farklı yerlere dağılmadan gör. Bir bak, ne olmuş anla, devam et.</p>
            </div>
            <ol className="ed-ledger" aria-label="Gün özeti örneği">
              {LEDGER.map((row) => (
                <li key={row.time} data-journey-anchor={row.anchor ? "row" : undefined}>
                  <time>{row.time}</time><strong>{row.name}</strong><span>{row.state}</span><b aria-hidden="true">{row.mark}</b>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <div className="ed-shutter ed-shutter--closing" role="group" aria-labelledby="ed-closing-title">
          <ShutterSlats />
          <div className="ed-paint ed-paint--closing">
            <p className="ed-paint-time">19:30 · Kepenk iniyor</p>
            <h2 id="ed-closing-title" className="ed-paint-title">
              Randevu <em data-journey-anchor="lockup" data-kolay>kolay.</em><br />İşin sana kalsın.
            </h2>
            <p className="ed-paint-lead">
              {contactReady
                ? "İşletmeni birlikte hazırlayalım, randevu tarafını sadeleştirelim."
                : "İletişim kanalını açtığımızda işletmeni birlikte hazırlayıp randevu tarafını sadeleştireceğiz."}
            </p>
            {MARKETING_CONTACT_HREF ? (
              <a className="ed-cta ed-cta--paint" href={MARKETING_CONTACT_HREF}><span>Birlikte kuralım</span><b aria-hidden="true">→</b></a>
            ) : (
              <p className="ed-paint-pending" aria-label="İletişim yakında"><strong>Birlikte kurulum yakında açılıyor.</strong> İletişim kanalı yayın entegrasyonuyla birlikte aktif olacak.</p>
            )}
            <a className="ed-textlink ed-textlink--paint" href="#nasil-calisiyor">Ürünü gör <span aria-hidden="true">↑</span></a>
          </div>
          <span className="ed-shutter-lip" />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- footnotes */

function Footnotes() {
  const points = [
    MARKETING_RELEASE_GATES.publicBooking ? { title: "Web'den randevu", text: "Müşteri linkten girer, uygun zamanı seçer." } : null,
    MARKETING_RELEASE_GATES.reminders ? { title: "Hatırlatma akışı", text: "Randevu yaklaşınca sistem zamanı takip eder." } : null,
    MARKETING_RELEASE_GATES.onboardingAssistance ? { title: "Birlikte kurulum", text: "İlk günü ayar menülerinde kaybetme." } : null,
  ].flatMap((point) => (point ? [point] : []));

  return (
    <section className="ed-footnotes" id="yardim" aria-labelledby="ed-notes-title" data-pilot-proof-ready={MARKETING_RELEASE_GATES.pilotProof ? "true" : "false"}>
      <div className="ed-notes-head">
        <p className="ed-mark"><time>*</time><span>Dipnotlar</span><em>Sözden önce ürün</em></p>
        <h2 id="ed-notes-title">Önce gösterelim. <em>Sonra</em> anlatalım.</h2>
        <p>Gerçek işletme sonuçları geldikçe onları açıkça paylaşacağız. Şimdilik çalışan akışı gösteriyoruz.</p>
        <ol className="ed-proof">
          {points.map((point, index) => (
            <li key={point.title}><sup>{index + 1}</sup><strong>{point.title}</strong><span>{point.text}</span></li>
          ))}
        </ol>
      </div>
      <div className="ed-faq">
        <h3>Kısa cevaplar.</h3>
        {MARKETING_RELEASE_GATES.publicBooking ? (
          <details open>
            <summary>Müşterim uygulama indirmek zorunda mı?</summary>
            <p>Hayır. Web üzerinden randevu akışı kullanılabilir. Müşteri linkten girer, uygun zamanı seçer ve işlemini tamamlar.</p>
          </details>
        ) : null}
        {MARKETING_RELEASE_GATES.onboardingAssistance ? (
          <details>
            <summary>Kurarken yardım ediyor musunuz?</summary>
            <p>Evet. İlk kurulumu seninle birlikte yapıyoruz; ayar menülerinde tek başına kalmıyorsun.</p>
          </details>
        ) : null}
        <details data-pricing-policy-ready={MARKETING_RELEASE_GATES.pricingPolicy ? "true" : "false"}>
          <summary>Fiyat ne kadar?</summary>
          <p>Fiyat ve paketler netleştiğinde burada açıkça yayınlayacağız. O zamana kadar uydurma bir fiyat göstermiyoruz.</p>
        </details>
      </div>
    </section>
  );
}

function EdFooter() {
  return (
    <footer className="ed-footer">
      <p className="ed-footer-mark" aria-hidden="true">randevu<em data-kolay>kolay</em></p>
      <div>
        <span>Kuaför, berber ve güzellik işletmeleri için.</span>
        <a href={WORKSPACE_HOME_PATH}>Giriş yap</a>
        <a href="#top">Yukarı dön ↑</a>
      </div>
    </footer>
  );
}

/* ----------------------------------------------------------------- token */

const JourneyToken = forwardRef<HTMLDivElement>(function JourneyToken(_props, ref) {
  return (
    <div ref={ref} className="ed-token" aria-hidden="true">
      <span className="ed-layer ed-layer--word" data-layer="word">kolay.</span>
      <span className="ed-layer ed-layer--service" data-layer="service"><strong>Saç + sakal</strong><em>45 dk</em><b>✓</b></span>
      <span className="ed-layer ed-layer--slot" data-layer="slot">14:30</span>
      <span className="ed-layer ed-layer--done" data-layer="done">✓ Cmt 14:30 · Saç + sakal</span>
      <span className="ed-layer ed-layer--block" data-layer="block"><strong>14:30<span className="ed-book-slot-service"> · Saç + sakal</span></strong><small>Kerem A.</small></span>
      {MARKETING_RELEASE_GATES.customerMemory ? (
        <span className="ed-layer ed-layer--card" data-layer="card">
          <small>Müşteri kartı</small>
          <strong>Kerem Aydın</strong>
          <span><i>Son ziyaret</i>12 Ekim</span>
          <span><i>Hizmet</i>Saç + sakal</span>
          <span><i>Not</i>Yanlar 2 numara</span>
        </span>
      ) : null}
      <span className="ed-layer ed-layer--badge" data-layer="badge">
        <span className="ed-badge-now"><i />Bugün · 5 randevu</span>
        <span className="ed-badge-done">Tamamlandı ✓</span>
        <span className="ed-badge-bar"><span /></span>
      </span>
      <span className="ed-layer ed-layer--row" data-layer="row"><time>14:30</time><strong>Saç + sakal</strong><span>Tamamlandı</span><b>✓</b></span>
      <span className="ed-layer ed-layer--lockup" data-layer="lockup">kolay.</span>
    </div>
  );
});

/* ------------------------------------------------------------------ page */

export function EditorialHome() {
  useMarketingDocumentMeta();
  useEditorialFonts();
  const rootRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  useDayClock(rootRef, reduced);
  useJourney(rootRef, tokenRef, reduced);
  useSingleKolay(rootRef, tokenRef);
  useDepthParallax(rootRef, reduced);

  return (
    <div ref={rootRef} className="ed-root" id="top">
      <a className="ed-skip" href="#ed-main">İçeriğe geç</a>
      <OpeningShutter disabled={reduced} />
      <EdNav />
      <main id="ed-main" tabIndex={-1}>
        <EdHero />
        <BookingChapter reduced={reduced} />
        <CalendarChapter reduced={reduced} />
        <SalonChapter reduced={reduced} />
        <DuskChapter reduced={reduced} />
        <Footnotes />
      </main>
      <EdFooter />
      <JourneyToken ref={tokenRef} />
      <span className="ed-grain" aria-hidden="true" />
    </div>
  );
}
