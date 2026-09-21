export type BookingInformationContact = {
  businessName: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  whatsapp?: string | null;
  address?: string | null;
};

export function hasPublicSupportContact(contact: BookingInformationContact | null | undefined) {
  return Boolean(contact && (contact.phone?.trim() || contact.email?.trim() || contact.whatsapp?.trim()));
}

function phoneHref(value: string) {
  return `tel:${value.replace(/\s+/g, '')}`;
}

function whatsappHref(value: string) {
  return `https://wa.me/${value.replace(/\D/g, '')}`;
}

export default function PublicBookingInformation({
  contact,
  slug,
  prefix = 'booking',
  className = '',
}: {
  contact: BookingInformationContact | null | undefined;
  slug: string;
  prefix?: string;
  className?: string;
}) {
  const controller = contact?.businessName?.trim() || 'İşletme';
  const supportReady = hasPublicSupportContact(contact);
  const informationBase = `/r/${encodeURIComponent(slug)}`;
  const ids = {
    notice: `${prefix}-aydinlatma`,
    privacy: `${prefix}-gizlilik`,
    terms: `${prefix}-kosullar`,
    support: `${prefix}-destek`,
  };

  return (
    <section className={`public-booking-information ${className}`.trim()} aria-label="Rezervasyon bilgilendirmeleri">
      <nav className="public-information-links" aria-label="Bilgilendirme bağlantıları">
        <a href={`${informationBase}/kvkk`} target="_blank" rel="noreferrer">Aydınlatma ve KVKK</a>
        <a href={`${informationBase}/privacy`} target="_blank" rel="noreferrer">Gizlilik</a>
        <a href={`${informationBase}/terms`} target="_blank" rel="noreferrer">Randevu koşulları</a>
        <a href={`${informationBase}/support`} target="_blank" rel="noreferrer">Destek</a>
      </nav>

      {!supportReady && (
        <p className="public-information-warning" role="alert">
          İşletmenin doğrulanmış destek iletişimi yüklenemedi. Bu bilgi gelmeden yeni randevu oluşturulamaz.
        </p>
      )}

      <div className="public-information-sections">
        <article id={ids.notice} tabIndex={-1}>
          <h3>Aydınlatma ve KVKK</h3>
          <p>
            Bu rezervasyon kapsamında kişisel verileriniz, randevu hizmetini sunan <strong>{controller}</strong> tarafından
            randevunun oluşturulması, yürütülmesi, değiştirilmesi veya iptali ve sizinle bu işlem hakkında iletişim kurulması
            amacıyla işlenir. Randevu Kolay bu akışın teknik rezervasyon altyapısını sağlar.
          </p>
          <p>
            İşlenen bilgiler ad-soyad, zorunlu telefon, isteğe bağlı e-posta ve not ile seçtiğiniz hizmet, personel ve zaman
            bilgisidir. İşleme; randevu talebinin kurulması ve yerine getirilmesi için gerekli olduğu ölçüde ve işlem
            güvenliği/kötüye kullanım önleme kayıtları bakımından ilgili mevzuatın izin verdiği hukuki sebeplere dayanır.
          </p>
          <p>
            Veriler, rezervasyonu yürüten yetkili işletme personeli ve hizmetin çalışması için gerekli teknik hizmet
            sağlayıcılarıyla amaçla sınırlı olarak paylaşılabilir. Yurt dışına aktarım söz konusu olduğunda yürürlükteki
            KVKK aktarım kuralları uygulanır. KVKK m.11 kapsamındaki haklarınızı kullanmak için veri sorumlusuna
            Kanun ve Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ'de öngörülen yöntemlerle başvurmanız gerekir.
            Aşağıdaki iletişim kanalları rezervasyon desteği içindir; tek başına resmî KVKK başvuru yöntemi sayıldığını garanti etmez.
          </p>
        </article>

        <article id={ids.privacy} tabIndex={-1}>
          <h3>Gizlilik</h3>
          <p>
            Randevu ekranı yalnız rezervasyon ve güvenli işlem kurtarma için gerekli bilgileri ister. Not alanına sağlık
            bilgisi, kimlik belgesi, ödeme kartı bilgisi veya randevu için gerekmeyen özel nitelikli kişisel veri yazmayın.
          </p>
          <p>
            Yönetim bağlantısı randevuyu görüntüleme/değiştirme yetkisi taşıyan gizli bir bağlantıdır; güvenmediğiniz
            kişilerle paylaşmayın.
          </p>
        </article>

        <article id={ids.terms} tabIndex={-1}>
          <h3>Randevu, iptal ve değişiklik koşulları</h3>
          <p>
            Randevu, başarı sonucu bu ekranda doğrulandığında oluşturulur. Uygun olduğu sürece size verilen yönetim
            bağlantısından farklı bir saate taşıma veya iptal seçenekleri gösterilir; seçeneklerin görünmesi randevunun
            güncel durumuna, zamana ve işletmenin müsaitliğine bağlıdır.
          </p>
          <p>
            Bu ekran işletme adına kapora, cayma bedeli, geç kalma cezası veya başka bir ücret politikası üretmez.
            İşletmenin ayrıca uyguladığı ticari bir koşul varsa işletme bunu size ayrıca bildirmelidir.
          </p>
        </article>

        <article id={ids.support} tabIndex={-1}>
          <h3>Destek ve iletişim</h3>
          <p>Rezervasyon desteği için {controller} ile iletişime geçin. KVKK m.11 başvurularında yukarıda açıklanan resmî başvuru yöntemlerini kullanın.</p>
          {contact && (
            <div className="public-information-contact">
              {contact.phone?.trim() && <a href={phoneHref(contact.phone)}>{contact.phone}</a>}
              {contact.email?.trim() && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
              {contact.whatsapp?.trim() && <a href={whatsappHref(contact.whatsapp)} rel="noreferrer">WhatsApp</a>}
              {contact.website?.trim() && <a href={contact.website} rel="noreferrer">İşletme web sitesi</a>}
              {contact.address?.trim() && <address>{contact.address}</address>}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
