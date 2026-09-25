import { intlLocale } from './i18n';

export const onboardingCopy = {
  eyebrow: 'İŞLETME KURULUMU',
  title: 'Randevu sayfanızı adım adım hazırlayın',
  subtitle: 'Kurulumunuz kaybolmaz. Tamamlanan adımlar işletmenizin gerçek kayıtlarından okunur.',
  business: 'İşletme',
  service: 'Hizmet',
  staff: 'Personel',
  hours: 'Çalışma saatleri',
  preview: 'Önizleme',
  publish: 'Yayın',
  createBusiness: 'Yeni işletme oluştur',
  switchBusiness: 'İşletme değiştir',
  selectBusiness: 'Bu işletmeye geç',
  noBusiness: 'Henüz işletmeniz yok.',
  createService: 'İlk hizmeti ekle',
  createStaff: 'Personeli ekle',
  ownerAsStaff: 'Bu personel benim',
  linkOwner: 'Kendi hesabıma bağla',
  saveHours: 'Çalışma gününü kaydet',
  publicReady: 'Yayına hazır',
  publicNotReady: 'Yayın için eksik adımlar var',
  publishNow: 'Rezervasyon sayfasını yayınla',
  unpublish: 'Yayından kaldır',
  published: 'Rezervasyon sayfanız yayında.',
  unpublished: 'Rezervasyon sayfanız henüz yayında değil.',
  reloadFailed: 'Kurulum bilgileri yenilenemedi.',
  businessCreated: 'İşletme oluşturuldu.',
  serviceCreated: 'Hizmet eklendi.',
  staffCreated: 'Personel eklendi.',
  hoursSaved: 'Çalışma saatleri kaydedildi.',
  switched: 'İşletme değiştirildi.',
  previewEmpty: 'Bu tarihte uygun saat görünmüyor. Farklı bir tarih deneyin.',
  missing: {
    SERVICE_REQUIRED: 'En az bir aktif hizmet ekleyin.',
    STAFF_REQUIRED: 'En az bir aktif personel ekleyin.',
    ASSIGNMENT_REQUIRED: 'Bir personeli en az bir hizmetle eşleştirin.',
    BUSINESS_HOURS_REQUIRED: 'İşletmenin çalışma saatlerini ekleyin.',
    STAFF_HOURS_REQUIRED: 'Hizmet veren personelin çalışma saatlerini ekleyin.',
    OVERLAPPING_HOURS_REQUIRED: 'İşletme ve personel saatlerinde en az bir ortak aralık oluşturun.',
    PUBLIC_CONTACT_REQUIRED: 'Public profilinizde telefon, e-posta veya WhatsApp destek kanalından en az birini yayınlayın.',
    PLAN_INACTIVE: 'İşletme planı aktif değil; yeni online randevu alınmaz. Planı yeniden etkinleştirmek için bizimle iletişime geçin.',
  } as Record<string, string>,
} as const;

/**
 * Formats a minor-unit Turkish Lira amount in the active display language.
 */
export function formatTry(minor: number) {
  return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: 'TRY' }).format(minor / 100);
}

/**
 * Converts a YYYY-MM-DD date string into a display date in the active language.
 */
export function formatLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'long' }).format(new Date(year, month - 1, day));
}
