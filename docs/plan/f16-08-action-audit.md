# F16-08 boş eylem audit'i ve devir

Bu belge [F16-08](phase-16.md#f16-08) kabulünün devir kısmıdır. İçeriği: üç ürün kolundaki görünür CTA/menü/sekme/buton listesi ve her birinin sınıfı, menü/route eşleştirmesi, desteklenen diller, plan durumları ve kalan açıklar.

Sınıflar:

- **çalışıyor:** gerçek bir route'a veya API işlemine bağlı.
- **açıkça disabled/upcoming:** görünür, `aria-disabled`, neden açık değil yazılı; tıklanınca hiçbir şey olmuş gibi davranmaz.
- **kaldırıldı:** artık gösterilmiyor.

PRODUCT_SPEC kuralı ("var olmayan özellik tamamlanabilir işlem gibi sunulmaz") bu listeyle kanıtlanır. Boş buton, sahte route veya sonsuz spinner bırakılmadı. Otomatik kanıtlar:

- `tests/f16-account-language-contract.test.mjs`:
  - her SalonApp eylemi `workspace-route.ts` içindeki bir route'a gider;
  - tek disabled eylem `Destek`'tir;
  - "Yeni paket satışı" gerçek F16-05 satış route'unu kullanır.
- `scripts/browser-f16-account-language.mjs`, gerçek Chrome'da 390px:
  - SalonApp "Diğer" sekmesindeki bütün bağlantılar ve tek disabled öğe;
  - hesap menüsü eylemleri;
  - paket satışı.
- Yüzeylerin kendi F10–F16 tarayıcı testleri (`scripts/browser-smoke.sh`).

## Kol 1 — Randevu paneli (`/app/*`)

| Yüzey | Görünür eylemler | Sınıf |
| --- | --- | --- |
| Üst bar | Marka (`/app`), işletme seçici (yalnız aktif üyelikler; yeni üst tenant hiyerarşisi yok) | çalışıyor |
| Hesap menüsü (F16-08) | Hesap, işletme, üyelik rolü, mali yetkiler (staff), plan ve dönem sonu; Dil; Parolayı değiştir; Çıkış yap | çalışıyor |
| Menü (masaüstü + mobil `İşletme menüsü`) | Takvim, Randevular, Müşteriler, Hizmetler, Ürün ve stok, Masraflar, Kasa ve raporlar, Ekip, Müsaitlik, Kurulum, Online Randevu, Yorumlar | çalışıyor |
| Takvim | Gün/Hafta/Liste, Önceki/Sonraki dönem, Bugün, tarih, 1/7 gün aralığı, Yenile/Yeniden dene, `+ Yeni randevu`, randevu çekmecesi (Onayla, Tamamlandı, Gelmedi, İptal et, Tüm rezervasyonu iptal et, Gelişmiş randevu işlemlerine git, İşletmeye dön) | çalışıyor |
| Randevular | Zaman → müşteri → hizmetler → not oluşturma, `+ Hizmet ekle`, Uygun saatleri getir, Saat kapat, Tekrar (Her gün/Her hafta) + Tüm tekrarları önizle + Seriyi oluştur, Detay, Adisyon, Hizmeti değiştir, Satırı taşı/iptal et, Tümünü taşı/iptal et, Seriyi yönet (Kapsamı önizle, Kapsamdaki randevuları taşı/iptal et), Daha fazla randevu/geçmiş yükle | çalışıyor |
| Randevular → Fotoğraf sekmesi | F16-03 özel fotoğraflar | çalışıyor (F16-03 merge'iyle) |
| Randevular → SMS | Bildirim kanalı satırı "Henüz bağlı değil" | açıkça disabled/upcoming |
| Müşteriler | Ara, Müşteri oluştur, Bilgileri güncelle, Adisyon geçmişi, Daha eski rezervasyonları göster, Daha fazla göster | çalışıyor |
| Hizmetler | Hizmet/personel ekle-kaydet-arşivle, yetkinlikler, Seans paketleri (ekle/düzenle/satışa aç-kapat), Kampanya kodları (ekle/aç-kapat), Hizmet fotoğraf arşivi (F16-03) | çalışıyor |
| Ürün ve stok | Ürünü oluştur, Bilgileri kaydet, Stok hareketini kaydet, Ürünü arşivle, Daha fazla, Kayıtlı isteği doğrula | çalışıyor |
| Masraflar | Masrafı kaydet, Düzelt, İptal / reversal, Daha fazla, Kayıtlı isteği doğrula | çalışıyor |
| Kasa ve raporlar | Raporu getir; Çalışan primleri (Hesap tanımı, Prim hareketleri, oran Kaydet, İstisna ekle/kaldır) | çalışıyor |
| Ekip | Davet oluştur, Kopyala, Geri al, rol/aktiflik/personel bağlantısı, mali izinler | çalışıyor |
| Müsaitlik | Aralık ekle, Sil, Kapanış ekle, Hesapla, Tekrar yükle | çalışıyor |
| Kurulum | İşletme oluştur/seç, İlk hizmeti ekle, Personeli ekle, Kendi hesabıma bağla, Çalışma gününü kaydet, Saatleri önizle, Yayınla/Yayından kaldır, Yayınlanan sayfayı aç | çalışıyor |
| Online Randevu | Ayarları kaydet, Profili kaydet, Bilgilendirmeleri kaydet, Fotoğraf ekle, Kapak yap, Sil, Kopyala, Müşteri görünümünü aç ↗ | çalışıyor |
| Yorumlar | Yayınla, Gizle/Yayından kaldır, Daha fazla yorum | çalışıyor |
| Giriş/davet | Giriş yap, Hesap oluştur, Parolamı unuttum, Kurtarma bağlantısı gönder, Parolayı güncelle, Giriş yap ve daveti kabul et, Başka hesapla giriş yap | çalışıyor |

## Kol 2 — SalonApp (`/app/mobile/*`)

| Yüzey | Görünür eylemler | Sınıf |
| --- | --- | --- |
| Alt menü | Randevular, Adisyonlar, Yeni, Müşteriler, Diğer | çalışıyor |
| Üst bar | İşletme seçici | çalışıyor |
| Yeni | Yeni randevu → `/app/bookings`; Yeni adisyon → `/app/mobile/tickets`; Yeni ürün satışı → `?newProductSale=1`; **Yeni paket satışı → `?newPackageSale=1`** (F16-08'de açıldı; F16-05 `POST /api/tickets/package-sales`); Yeni masraf → `/app/expenses` | çalışıyor |
| Diğer → Hesap ve üyelik (F16-08) | Hesap, işletme, üyelik, plan, Dil, Parolayı değiştir, Çıkış yap | çalışıyor |
| Diğer → Genel | Online Randevu → `/app/public-booking`; **Müşteri geri bildirimleri → `/app/feedback`**; **Hizmet fotoğrafları → `/app/services`** | çalışıyor |
| Diğer → Genel → Destek | "YZT destek kanalı henüz uygulamaya bağlı değil." | açıkça disabled/upcoming |
| Diğer → Raporlar | Kasa, Masraflar, Ürün satışları, Gelir-gider; **Çalışan primleri**, **Detaylı çalışan raporu** → `/app/reports` | çalışıyor |
| Diğer → Kurulum | Salon bilgileri, Çalışma saatleri, Çalışanlar, Hizmetler, Süreler ve fiyatlar, Randevu ayarları, Ürün ve stok, Salon fotoğrafları; **Promosyonlar**, **Seans paketleri** → `/app/services` | çalışıyor |
| Adisyonlar | Yeni adisyon, Hizmet/Ürün ekle, Tutarı kesinleştir, İskontoyu kaydet, Kodu uygula/Kampanyayı kaldır, Paket sat/Paketten düş/Paket kullanımını geri al/Kalan seansları iade et, Tahsilatı kaydet, Düzelt, İade, Ürün iadesini kaydet, Adisyonu kapat/iptal et, Belirsiz işlemi doğrula, Daha fazla | çalışıyor |

F16-08 öncesinde "Henüz kullanıma açık değil" diye disabled görünen yedi SalonApp eylemi vardı. Kalın yazılanlar (Yeni paket satışı, Müşteri geri bildirimleri, Hizmet fotoğrafları, Çalışan primleri, Detaylı çalışan raporu, Promosyonlar, Seans paketleri) F16-03…F16-07 ile gelen gerçek yüzeylere bağlandı. Disabled kalan tek eylem Destek'tir; açıklaması artık nedenini söyler.

## Kol 3 — Müşteri paneli (`/:slug`, `/m#token`)

| Yüzey | Görünür eylemler | Sınıf |
| --- | --- | --- |
| Salon sayfası | Hizmetler/Salon/Fotoğraflar/Yorumlar/Bilgiler bölüm bağlantıları, Favoriye ekle (cihazda), Paylaş, Dil, iletişim bağlantıları (telefon/e-posta/WhatsApp/web), KVKK/Gizlilik/Randevu koşulları bağlantıları | çalışıyor |
| Tek hizmet rezervasyonu | Hizmet/personel/tarih, Uygun saatleri göster, saat seçimi, Kampanya kodu (Kodu kontrol et), Randevuyu oluştur, belirsiz sonuç kontrolü (Önceki randevu sonucunu kontrol et, Sonucu tekrar kontrol et), Güvenli kaydı yeniden dene, Depolamayı yeniden dene, Cihazdaki hatırlatıcıyı kaldır, Randevumu yönet | çalışıyor |
| Çok hizmet planı | Hizmet ekle/Kaldır/↑/↓, personel seçimi, Bugün/Yarın, Birlikte uygun saatleri bul, Uygun saatleri tekrar dene, Hizmetleri yenile, Personeli tekrar yükle | çalışıyor |
| Randevu yönetimi | Dil, Saatleri göster, Seçilen saate taşı, Randevuyu iptal et / Aktif hizmetlerin tamamını iptal et, Kodu ekle (F16-06), Değerlendirmeyi gönder (F16-04), destek ve bilgilendirme bağlantıları | çalışıyor |

Kaldırılan eylem yok. F16-08, gösterilen hiçbir eylemi yerine bir şey koymadan kaldırmadı. Başlıktaki eski "Parolayı değiştir / Çıkış yap" butonları kaldırılmadı, hesap menüsüne taşındı. Randevu oluşturma ekranındaki SMS satırındaki "F16-02 ile açılacak" iç görev etiketi, müşteriye anlamlı "Henüz bağlı değil" metniyle değişti.

## Menü / route eşleştirmesi

| Randevu paneli | SalonApp | Sayfa |
| --- | --- | --- |
| `/app`, `/app/calendar` | `/app/mobile` (Randevular) | Takvim |
| `/app/bookings` | Yeni → Yeni randevu | Randevular |
| `/app/customers` | `/app/mobile/customers` | Müşteriler |
| — | `/app/mobile/tickets` (+ `?newProductSale=1`, `?newPackageSale=1`) | Adisyonlar / kasa |
| `/app/services` | Diğer → Hizmetler, Süreler ve fiyatlar, Hizmet fotoğrafları, Promosyonlar, Seans paketleri | Hizmetler |
| `/app/products` | Diğer → Ürün ve stok | Ürün ve stok |
| `/app/expenses` | Yeni → Yeni masraf; Diğer → Masraflar | Masraflar |
| `/app/reports` | Diğer → Kasa, Ürün satışları, Gelir-gider, Çalışan primleri, Detaylı çalışan raporu | Kasa ve raporlar |
| `/app/team` | Diğer → Çalışanlar | Ekip |
| `/app/availability` | Diğer → Çalışma saatleri | Müsaitlik |
| `/app/setup` | Diğer → Salon bilgileri | Kurulum |
| `/app/public-booking` | Diğer → Online Randevu, Randevu ayarları, Salon fotoğrafları | Online Randevu |
| `/app/feedback` | Diğer → Müşteri geri bildirimleri | Yorumlar |
| Hesap menüsü | Diğer → Hesap ve üyelik | `/api/account` |

## Desteklenen diller

- **Türkçe:** varsayılan dil ve kaynak metin.
- **İngilizce:** ilk ikinci dil. Katalog `src/i18n-en.ts` yalnız İngilizce seçilince yüklenir ve public başlangıç bundle'ına girmez.
- **Seçim sırası:** `?lang=` parametresi, cihazdaki `yzt_locale` tercihi, sonra Türkçe. Seçim üç kolda aynıdır. Dil değişince uygulama yeniden kurulur ve `document.documentElement.lang` güncellenir.
- **Tarih ve sayılar:** tarih, saat ve tutarlar etkin dilde biçimlenir (`tr-TR` / `en-GB`). Kalan `tr-TR` çağrıları yalnız saat dilimi veya para birimi kodu doğrular, ya da Türkçe isimden baş harf üretir.
- **Eksik çeviri:** Türkçe kaynağa düşer, teknik anahtar hiç görünmez. Kontrat testi arayüzdeki her `t()` anahtarının ve dinamik etiket haritalarının İngilizce karşılığını, yer tutucularının aynı olduğunu ve katalogda kullanılmayan kayıt kalmadığını doğrular.
- **API mesajları:** `ApiRequestError` sunucu mesajını `t()` üzerinden gösterir. Oturum, giriş, işletme seçimi ve plan mesajları katalogdadır. Diğer Worker mesajları Türkçe kalır.
- **Çevrilmeyen içerik:** işletmenin girdiği içerik (salon adı, hizmet adları, açıklamalar, KVKK/gizlilik/koşul metinleri, müşteri yorumları) çevrilmez; işletme ne yayınladıysa o gösterilir.

## Plan durumları

Plan bilgisi gerçek veriden gelir: `core.subscriptions`, manuel pilot aktivasyonu veya platform faturalama komut yolu tarafından yazılır. Bu uygulama abonelik tahsil etmez; otomatik çekim yapılmış sayılmaz.

| `status` | Erişim | Randevu paneli ve SalonApp | Yeni online randevu | Mevcut müşteri randevusu (yönetim bağlantısı) |
| --- | --- | --- | --- | --- |
| kayıt yok → `pilot` | full | Tam | Açık (kurulum tamamsa) | Görüntüle, taşı, iptal et |
| `trial` | full | Tam | Açık | Görüntüle, taşı, iptal et |
| `active` | full | Tam | Açık | Görüntüle, taşı, iptal et |
| `past_due` | full | Tam; hesap menüsünde "Plan ödemesi bekleniyor" uyarısı | Açık | Görüntüle, taşı, iptal et |
| `cancelled` | read_only | Okuma açık; üye yazmaları `PLAN_READ_ONLY` (403) | Kapalı (`PLAN_INACTIVE`) | Görüntüle, taşı, iptal et |

Uygulandığı yerler:

- **Yeni online randevu:** paylaşılan hazırlık fonksiyonu `business_onboarding_readiness_internal`, `PLAN_INACTIVE` nedenini ekler. Public profil, slot, rezervasyon, kampanya önizlemesi ve public randevu insert guard'ı bu fonksiyonu kullanır, bu yüzden hepsi veritabanında kapanır.
- **Mevcut randevu:** yönetim bağlantısıyla görüntüleme, taşıma ve iptal var olan satırın güncellemesidir. Kapanmaz; `supabase/tests/f16_account_plan.sql` bunu kanıtlar.
- **Üye yazmaları:** Worker, üyelik sorgusunun zaten okuduğu `businesses.plan_access` ile her POST/PUT/PATCH/DELETE isteğini RPC'den önce reddeder. Okumalar açık kalır. Kolonu yalnız `core.subscriptions` tetikleyicisi değiştirebilir. Plan gömülü değeri boş gelirse yazma kapalıdır.

## Kalan açıklar

- **Destek:** YZT destek kanalı uygulamaya bağlı değil; SalonApp'te açıkça disabled. Müşteri tarafındaki destek, işletmenin yayınladığı kanallarla çalışıyor.
- **SMS bildirimi:** bağlı değil ("Henüz bağlı değil"). Müşteri bildirimi e-posta ile gider.
- **Plan aktivasyonu:** manuel. Self-servis ödeme, fatura ve plan yükseltme bu MVP'de yok (PDF abonelik / AI kredi modeli taşınmadı).
- **Plan kapısının yeri:** Worker üye API'sinde. İptal edilmiş plandaki bir üye kendi oturum anahtarıyla Supabase Data API'sini doğrudan çağırırsa kendi işletmesine yazabilir. Müşteri ve public yollar veritabanında kapalıdır. Kapıyı her guarded RPC'ye taşımak ayrı bir iştir.
- **Çeviri kapsamı:** çoğu Worker hata mesajı henüz katalogda değil (Türkçe gösterilir). Müşteri e-posta şablonları Türkçedir.
