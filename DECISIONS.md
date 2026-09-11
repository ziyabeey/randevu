# YZT Randevu — Teknik Kararlar

Güncel dosya/route/test haritası için önce [PROJECT_STATE.md](PROJECT_STATE.md) oku. Ürün hedefi [PRODUCT_SPEC.md](PRODUCT_SPEC.md), faz ve kabul sırası [ROADMAP.md](ROADMAP.md) içindedir. Bu dosya mevcut teknik temeli ve kabul edilmiş yeni teknik yönü ayırır.

## 11 Eylül 2026 — Üç kol kararı

Müşteri paneli, randevu paneli ve SalonApp aynı backend/tenant/customer/appointment verisini kullanır. Kullanım yüzeyleri ayrılır; çekirdek iş kuralları ayrılmaz. Ayrı repo, mikroservis veya üç kalıcı branch kurmak bu ürün kararının gereği değildir.

Müşteri paneli estetik olarak farklılaşır. Randevu paneli ve SalonApp referansın menü/alan/işlem sırasını korur. Mobil alt menü `Randevular / Adisyonlar / Yeni / Müşteriler / Diğer` olarak sabitlenir. İlk mobil teknik hedef mevcut web altyapısında responsive/PWA'dır; native dağıtım ayrıca değerlendirilir.

11 Eylül kullanıcı kararı adisyon ve manuel tahsilatı, ayrıca referanstaki sınırlı ürün/stok/masraf/kasa/prim/paket işlevlerinin sıralı geliştirilmesini kapsar. Önceki genel MVP ödeme/stok yasağı bu kapsam için güncellenmiştir. Çevrimiçi ödeme, tam muhasebe, e-fatura, bordro ve stok ERP onaylanmış uygulama işi değildir.

## Yeni kapsam için kabul edilen teknik yön — henüz uygulanmadı

### Ortak kimlik, işletme ve yetki

Panel ve SalonApp aynı Supabase kimliğini ve aktif Membership kontrolünü kullanır. StaffProfile operasyon kaydı, Membership erişim kaydıdır; personel eklemek tek başına hesap/davet oluşturmaz. Faz 10 bu iki işlevi açık ve güvenli akışlarla bağlar. Son aktif owner kaldırılamaz; owner yetkisi manager/staff tarafından verilemez.

İşletme/şube seçimi mevcut Business'lar arasında yetkili geçiştir. Business'ları birleştiren şirket/şube üst tenant'ı veya çapraz işletme raporu bu kararla eklenmez. Aktif üyelik iptali iki işletme yüzeyinde de etkili olur.

Mevcut randevu API'sinde aktif staff üyeleri işletmenin randevularını yönetebilir; UI tasarımı bu veri kapsamını sessizce değiştirmez. Yeni mali işlemler için hedef varsayılan:

| İşlem | Owner | Manager | Staff |
| --- | --- | --- | --- |
| Mevcut işletme randevu işlemleri | Var | Var | Mevcut kapsam korunur |
| Kullanıcı/rol yönetimi | Var | Owner yetkisi veremez; sınırı Faz 10'da test edilir | Yok |
| Açık adisyon oluşturma, katalog fiyatıyla hizmet ekleme | Var | Var | Var |
| Tahsilat, fiyat/iskonto değişimi, kapalı adisyon düzeltmesi/iptali | Var | Var | Varsayılan yok; açık mali izin gerekir |
| Kasa/prim raporu, masraf ve stok yazımı | Var | Var | Varsayılan yok; açık mali izin gerekir |

Bu tablo hedef yetki politikasıdır; mevcut kodda mali yetkiler varmış gibi kullanılmaz. Her mali izin endpoint ve DB seviyesinde, çapraz tenant ve yetki iptali testleriyle uygulanır.

### Çok hizmetli randevu

Faz 11 tek hizmetli çekirdeğe ileri migration ile randevu grubu/hizmet satırı modeli ekler; tablo/endpoint isimleri uygulama PR'ında kesinleşir. Her satır tenant, hizmet, personel, zaman, tampon, fiyat ve süre snapshot'ını taşır. Grup oluşturma ve ilk kapsamda grup taşıma/iptal atomiktir; tekrar anahtarı tüm müşteri işlemini kapsar.

Personel doluluğu her hizmet satırında PostgreSQL tarafından korunur. Aynı müşterinin farklı personellerdeki hizmet sırası açıkça modellenir; aynı personelde keyfi çakışma açılmaz. Eski tek hizmetli kayıtlar ve bağlantılar geriye uyumlu kalır. Grup yönetim yetkisi yalnız o grubun satırlarına erişir.

### Adisyon ve manuel tahsilat

Faz 14 adisyon, satır, tahsilat/düzeltme ve audit kayıtlarını tenant composite ilişkileriyle ekler. Randevuya bağlı adisyon açma tekrar güvenlidir; randevusuz adisyon da desteklenir. Randevu kaydının mali işlemler nedeniyle ikinci bir kopyası oluşturulmaz.

Randevu, adisyon ve ödeme ayrı durumlardır. Başlangıç adisyon yaşam döngüsü `açık → kapalı` veya yetkili `iptal`; tahsilat yaşam döngüsü ve düzeltmeler ayrı kayıtlardır. Kapalı kaydı düzeltmek/geri açmak açık yetki ve audit gerektirir; hangi geçişin desteklendiği Faz 14 testinde sabitlenir.

Tutarlar para birimiyle minor unit olarak sunucuda hesaplanır; istemci toplamına güvenilmez. Fiyat/iskonto, personel ve ürün/hizmet snapshot'ları korunur. Kısmi/bölünmüş tahsilat, kalan bakiye, tekrar anahtarı ve eşzamanlı bakiye kontrolü aynı işlem sınırında ele alınır. Manuel kart kaydı gerçek bir kart çekimi başlatmaz.

### Stok, rapor ve referans genişlemeleri

Faz 15 temel ürün ve stok hareketi ekler; satış/iptal ve stok etkisi atomik/tekrar güvenlidir. Kasa raporu randevu fiyatı toplamından değil tahsilat/düzeltme hareketlerinden türetilir. Gün sınırı işletme timezone'udur. Prim/paket/promosyon Faz 16'nın dar alt modülleridir; bordro, muhasebe ve ERP motoru kurulmaz.

### Bildirim ve kurtarma

Randevunun DB sonucu müşteri başarısının kaynağıdır; bağlantı veya mesaj yan işlemi bu sonucu gizlemez. Faz 9, randevu sonucu kurtarma ve tarayıcıdan bağımsız güvenli yeniden denemeyi tasarlayıp test eder. Düz yönetim token'ı saklamama ilkesi korunur; token yenileme/teslim stratejisi güvenlik ve başarısızlık testleriyle karara bağlanır.

Gönderim receipt'i istemcinin beyanı değil güvenilir sunucu/sağlayıcı sonucudur. Worker'ın mevcut service-role kullanmama sınırına uyan dar bir gönderim yetkisi uygulanır. Sağlayıcı kabulü ile gerçek teslimat ayrılır; sağlayıcı kesintisi için zaman aşımı ve tekrar sınırı vardır. Faz 16A hatırlatmaları güncel randevu durumundan üretir; iptal/taşımadan sonra eski saate bildirim gitmez.

## Main'de bulunan teknik temel

## Faz 2 — Auth ve tenant

`Business` tenant köküdür. Supabase Auth kimliği, `Membership` güncel tenant rolü/aktifliğini sağlar. Client business seçimi yetki değildir; member erişimi aktif membership + RLS ile doğrulanır. Worker service-role key kullanmaz.

## Faz 3 — Hizmet ve ekip

Services, staff profiles ve staff-service eligibility tenant kimliği taşır. Composite FK'ler cross-tenant bağlantıları DB seviyesinde engeller. Owner/manager katalog yazar; staff read-only'dir.

## Faz 4 — Müsaitlik

Business/staff weekly windows kesişir; blocks düşülür; `buffer_before + duration + buffer_after` bütünü pencereye sığmalıdır. Local schedule business IANA timezone'u ile gerçek `timestamptz` timeline'a çevrilir; DST edge'leri gerçek instant semantiğiyle korunur.

## Faz 5 — Booking çekirdeği

Appointment create anındaki customer/service/staff/duration/buffer/price/currency/timezone snapshot'larını saklar. Same-staff non-cancelled occupied overlap final sınırı PostgreSQL `EXCLUDE USING gist` constraint'idir. `cancelled` slotu açar; completed/no-show tarihi occupancy'yi korur.

Create/reschedule/status `booking_commands` ile idempotenttir. Terminal appointment tekrar aktif hale getirilemez. Mutation'lar append-only appointment audit event bırakır.

## Faz 6 — Public self-booking

Public booking opt-in/default-disabled'dır. Anon role tenant tablolarına direct read/write grant almaz; sanitized security-definer RPC yüzeyi kullanır. Public create exact live slotu transaction içinde yeniden doğrular ve exclusion constraint'e tabidir. Public contact match mevcut customer ID'sini reuse edebilir fakat anonim input mevcut customer master row'unu değiştirmez.

## Faz 7 — Customer appointment management

Müşteri tek appointment kapsamlı bearer capability kullanır. Browser 256-bit token üretir; DB yalnız SHA-256 hash saklar. Link `/m#<token>` fragment kullanır ve management API token'ı yalnız POST JSON body'de kabul eder. Existing capability public page kapatılsa da çalışır. Reschedule appointment snapshot duration/buffer'ını korur, güncel schedule/block/staff eligibility/notice/horizon kullanır, idempotenttir ve final overlap constraint'e tabidir. Cancel da idempotent public audit bırakır.

## Faz 8 — Operator calendar

### Calendar bir projection'dır

Takvim ayrı appointment state'i veya ikinci mutation motoru yaratmaz. Kaynak her zaman Faz 5 `appointments` + snapshot'lardır. Hızlı lifecycle aksiyonları doğrudan mevcut booking status endpoint'ini kullanır. Böylece calendar UI booking invariants'ını fork etmez.

### Business-local range

Calendar query bir `p_start_date` ve `p_days` alır. PostgreSQL business timezone'unu bulur ve `[local midnight, local midnight + N days)` sınırlarını exact `timestamptz` instantlarına çevirir. Bu özellikle UTC gün sınırında veya DST kullanan timezone'larda randevunun yanlış takvim gününe düşmesini engeller.

RPC yalnız aktif tenant member tarafından execute edilebilir. Optional staff filter aynı tenant içindeki appointment projection'ını daraltır. Cross-tenant business ID geçirmek yetki sağlamaz.

### Day / week UX

Day view personel sütunlu timed grid'dir. Week view 7 local-date column kullanır. Cancelled görünürlüğü opsiyoneldir. Detay drawer appointment snapshot'ını gösterir ve lifecycle quick actions sağlar. Yeni appointment/create-reschedule gibi daha karmaşık operasyonlar `/bookings` yüzeyinde kalır.

### Faz 8'in tarihsel kapsamı

Calendar drag-drop reschedule, external calendar sync, notification ve payment Faz 8'in teslim edilen kapsamına dahil değildir. Güncel sonraki fazlar ROADMAP'teki Faz 9–17'dir; tarihsel kapsam yeni üç kol kararını geçersiz kılmaz.
