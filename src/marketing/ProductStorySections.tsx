import { MARKETING_RELEASE_GATES } from "./releaseGates";

const bookingTimes = ["11:30", "14:30", "16:00"];

function BookingDemo() {
  if (!MARKETING_RELEASE_GATES.publicBooking) {
    return null;
  }

  return (
    <section className="mkt-product-story" id="nasil-calisiyor" aria-labelledby="mkt-booking-title">
      <div className="mkt-section-copy">
        <p className="mkt-eyebrow">İşin güzellik. Karışıklık değil.</p>
        <h2 id="mkt-booking-title">Müşteri kendi alsın.</h2>
        <p>
          Hizmeti seçsin, uygun saatini görsün, randevusunu tamamlasın. Sen her mesajın peşinden koşma.
        </p>
        <div className="mkt-inline-note">Linki paylaş. Gerisini müşteri tamamlasın.</div>
      </div>

      <div className="mkt-booking-proof" aria-label="Online rezervasyon akışı örneği">
        <div className="mkt-proof-header">
          <span>Randevu</span>
          <small>3 adım</small>
        </div>
        <div className="mkt-proof-step is-done">
          <span>01</span>
          <div>
            <small>Hizmet</small>
            <strong>Saç kesimi</strong>
          </div>
          <b aria-hidden="true">✓</b>
        </div>
        <div className="mkt-proof-step">
          <span>02</span>
          <div>
            <small>Uygun saat</small>
            <div className="mkt-time-pills" aria-hidden="true">
              {bookingTimes.map((time, index) => (
                <i className={index === 1 ? "is-picked" : ""} key={time}>{time}</i>
              ))}
            </div>
          </div>
        </div>
        <div className="mkt-proof-step is-final">
          <span>03</span>
          <div>
            <small>Sonuç</small>
            <strong>Randevu tamam.</strong>
          </div>
          <b aria-hidden="true">✦</b>
        </div>
      </div>
    </section>
  );
}

function CalendarStage() {
  if (!MARKETING_RELEASE_GATES.calendarAvailability) {
    return null;
  }

  return (
    <section className="mkt-calendar-stage" id="isletmen-icin" aria-labelledby="mkt-calendar-title">
      <div className="mkt-calendar-copy">
        <p className="mkt-eyebrow">Takvim dediğin biraz da kafa rahatlığıdır.</p>
        <h2 id="mkt-calendar-title">Kim boş, kim dolu? Bakınca belli.</h2>
        <p>Çalışan, saat ve randevu aynı yerde dursun. Çakışmayı sonradan fark etmek yerine baştan gör.</p>
      </div>

      <div className="mkt-calendar-board" aria-label="Günlük randevu görünümü örneği">
        <div className="mkt-calendar-head">
          <strong>Bugün</strong>
          <span>14 Eylül</span>
        </div>
        <div className="mkt-calendar-row is-busy">
          <time>10:00</time>
          <div><strong>Saç kesimi</strong><span>Dolu</span></div>
        </div>
        <div className="mkt-calendar-row is-free">
          <time>11:30</time>
          <div><strong>Uygun</strong><span>Boş</span></div>
        </div>
        <div className="mkt-calendar-row is-busy">
          <time>13:00</time>
          <div><strong>Randevu</strong><span>Dolu</span></div>
        </div>
        <div className="mkt-calendar-row is-free is-highlighted">
          <time>14:30</time>
          <div><strong>Uygun</strong><span>Boş</span></div>
        </div>
      </div>
    </section>
  );
}

function TodaySummary() {
  if (!MARKETING_RELEASE_GATES.dailyAppointmentSummary) {
    return null;
  }

  return (
    <section className="mkt-today" aria-labelledby="mkt-today-title">
      <div className="mkt-section-copy">
        <p className="mkt-eyebrow">Dağılmasın.</p>
        <h2 id="mkt-today-title">Bugün ne olmuş? Tek yerde.</h2>
        <p>Günün randevularını farklı yerlere dağılmadan gör. Bir bak, ne olmuş anla, devam et.</p>
      </div>

      <div className="mkt-today-list" aria-label="Gün özeti örneği">
        <article>
          <time>09:30</time>
          <div><strong>Saç kesimi</strong><span>Tamamlandı</span></div>
          <i aria-hidden="true">✓</i>
        </article>
        <article>
          <time>11:00</time>
          <div><strong>Sakal</strong><span>Yaklaşıyor</span></div>
          <i aria-hidden="true">•</i>
        </article>
        <article>
          <time>14:30</time>
          <div><strong>Saç kesimi</strong><span>Onaylandı</span></div>
          <i aria-hidden="true">✓</i>
        </article>
      </div>
    </section>
  );
}

function ProofBeforeTestimonials() {
  // Numbering follows the released list, so a closed gate never leaves a visible gap (01, 03).
  const proofPoints = [
    MARKETING_RELEASE_GATES.publicBooking
      ? { title: "Web'den randevu", text: "Müşteri linkten girer, uygun zamanı seçer." }
      : null,
    MARKETING_RELEASE_GATES.reminders
      ? { title: "Hatırlatma akışı", text: "Randevu yaklaşınca sistem zamanı takip eder." }
      : null,
    MARKETING_RELEASE_GATES.onboardingAssistance
      ? { title: "Birlikte kurulum", text: "İlk günü ayar menülerinde kaybetme." }
      : null,
  ]
    .flatMap((point) => point === null ? [] : [point])
    .map((point, index) => ({ ...point, number: String(index + 1).padStart(2, "0") }));

  return (
    <section
      className="mkt-proof-before-pilot"
      aria-labelledby="mkt-proof-title"
      data-pilot-proof-ready={MARKETING_RELEASE_GATES.pilotProof ? "true" : "false"}
    >
      <div>
        <p className="mkt-eyebrow">Sözden önce ürün.</p>
        <h2 id="mkt-proof-title">Önce gösterelim. Sonra anlatalım.</h2>
        <p>Gerçek işletme sonuçları geldikçe onları açıkça paylaşacağız. Şimdilik çalışan akışı gösteriyoruz.</p>
      </div>
      <div className="mkt-proof-points" aria-label="Randevu ürün kanıtları">
        {proofPoints.map((point) => (
          <article key={point.number}>
            <span>{point.number}</span>
            <strong>{point.title}</strong>
            <p>{point.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section className="mkt-faq" id="yardim" aria-labelledby="mkt-faq-title">
      <div className="mkt-faq-intro">
        <p className="mkt-eyebrow">Merak ettiğin üç şey.</p>
        <h2 id="mkt-faq-title">Kısa cevaplar.</h2>
      </div>
      <div className="mkt-faq-list">
        {MARKETING_RELEASE_GATES.publicBooking ? (
          <details open>
            <summary>Müşterim uygulama indirmek zorunda mı?</summary>
            <p>Hayır. Web üzerinden randevu akışı kullanılabilir. Müşteri linkten girer, uygun zamanı seçer ve işlemini tamamlar.</p>
          </details>
        ) : null}
        {MARKETING_RELEASE_GATES.onboardingAssistance ? (
          <details>
            <summary>Kurarken yardım ediyor musunuz?</summary>
            <p>Evet. İlk kurulumu birlikte yapma yaklaşımı Randevu'nun kolaylık vaadinin bir parçası.</p>
          </details>
        ) : null}
        <details data-pricing-policy-ready={MARKETING_RELEASE_GATES.pricingPolicy ? "true" : "false"}>
          <summary>Fiyat ne kadar?</summary>
          <p>Fiyat ve paket yapısı ticari karar kilitlendiğinde burada açıkça yayınlanacak. Pazarlama uğruna uydurma fiyat göstermiyoruz.</p>
        </details>
      </div>
    </section>
  );
}

export function ProductStorySections() {
  return (
    <>
      <BookingDemo />
      <CalendarStage />
    </>
  );
}

export function TrustSections() {
  return (
    <>
      <TodaySummary />
      <ProofBeforeTestimonials />
      <FaqSection />
    </>
  );
}
