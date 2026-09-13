# Plan v3 — Yeni özelliklerden önce teknik düzeltmeler

İncelenen kaynak: `main@3b73bf827346542cd36f5bc6ed32d4d8a0b30cea`, 12 Eylül 2026. Bu kartlar **planlandı**; raporlanmış kusurlar düzelmiş sayılmaz. Durum ve sahip tek kaynak olarak [TASKS.md](../../TASKS.md) içinde tutulur. **GS**, S01…S08 kabulünün tamamlanmasıdır. F09 ve F10 tarihsel teslimleri korunur; yeni özellik uygulamaları GS'yi bekler. Tasarım/plan incelemesi ve bağımsız düzeltmeler paralel yürüyebilir.

Her görev için [ajan çalışma düzeni](agent-workflow.md) kullanılır. Karttaki dosyalar okuma ve muhtemel değişim alanıdır; başlarken gerçek dosya izin listesi ve gerekiyorsa dar alt işler yazılır. Bunlar sekiz PR veya sekiz oturum garantisi değildir. K01…K03 [ortak sözleşmelere](architecture-contracts.md) karşılık gelir.

## S01

**Parola kurtarma oturumunun sınırını koruma**

- **Bağımlılık:** F10-01.
- **Bulgu:** `worker/auth.ts` recovery marker ömrü access/refresh oturumundan kısa; `worker/auth-routes.ts` geçersiz confirmation marker'ı temizlerken oturumu bırakabiliyor. Önceki yerel HTTP canlandırması mevcut recovery oturumunda kısıtın kalktığını gösterdi. Bu, rastgele hesabı ele geçirme iddiası değildir.
- **İş:** Recovery yetkisini sunucunun doğruladığı oturum bağlamına bağla; eksik/bozuk/süresi dolmuş marker normal yetkiye yükseltmesin. Hatalı/replay confirmation mevcut kurtarma oturumunu genişletmesin. Normal giriş, parola değişimi ve logout geçişlerini ayrı tanımla; tüm oturumları gereksiz yere kilitleme.
- **Alan / beceri:** `worker/auth.ts`, `worker/auth-routes.ts`, ilgili HTTP/Auth kabul testleri; Supabase. Kalıcı oturum verisi gerekirse dar ileri migration ve Postgres rehberi.
- **Kabul:** Mevcut recovery cookie jar'ıyla geçersiz ve replay confirmation; marker silme/değiştirme/süresinin dolması; refresh; ikinci sekme ve başarılı parola güncelleme sonrası durum test edilir. Parola değişimi sonrası önceki oturumların geçersizleşme sınırı ölçülür; yalnız kullanıcı silmeye/token claim değişimine güvenilmez. Normal session tenant API'lerine yetkisiyle erişir; recovery session yalnız tanımlı session/logout/password yollarını kullanır.
- **Gerçek kanıt:** Public kayıt/şifre kurtarma başlatma → test posta kutusu → redirect/PKCE callback → parola değişimi → giriş zinciri staging'de denenir. Admin `generate_link` + doğrudan token-hash confirmation bu zincirin yerine geçmez. Güvenli test alıcısı/erişimi yoksa canlı kabul açık kalır.
- **Devir:** Oturum durum/geçiş tablosu, tehdit varsayımı, HTTP ve gerçek tarayıcı kanıtı. Kapsam dışı: davet/rol özelliği.

## S02

**Ortak auth, hata ve cookie mutation koruması**

- **Bağımlılık:** S01.
- **Bulgu:** `worker/calendar.ts`, `bookings.ts`, `availability.ts`, `public-booking.ts` eski yardımcılar taşıyor. Supabase 503 canlandırmasında calendar 401 + cookie silme, ortak catalog 503 + session koruma verdi. `worker/index.ts` Origin/CSRF kapsamı tüm feature mutation'larını içermiyor. SameSite/CORS/preflight nedeniyle bu son bulgu tek başına gerçek tarayıcıda dış-site saldırısı kanıtı değildir.
- **İş:** Sadece auth/HTTP sorumluluğunu ortak yardımcıya geçir; iş kurallarını yeniden yazma. İlgili frontend fetch çağrılarını ortak CSRF/hata sözleşmesine taşı. Cookie tabanlı tüm mutation'lar için ortak guard; public/capability ve sunucu işlemleri için açık, dar istisna envanteri oluştur.
- **Alan / beceri:** `worker/auth.ts`, `worker/index.ts`, `worker/app.ts`, dört feature Worker, `src/api.ts` ve ilgili feature fetch çağrıları; Supabase. Router/auth dosyaları tek yazıcıyla değişir.
- **Kabul:** Route matrisi tüm cookie mutation yollarını kapsar. Geçersiz auth → 401; yetkisiz üyelik → 403; geçici sağlayıcı arızası → tekrar edilebilir 503 ve geçerli cookie'nin korunması. Origin/Sec-Fetch başlıklarının yokluğu guard'ı atlamaz; Origin/CSRF eksik/yanlış, public istisna, expired/refresh ve üyelik iptali davranış testleri geçer. Meşru public/manage akışı korunur.
- **Devir:** Taşınan yardımcılar, route/guard matrisi, gerçek HTTP sonuçları. Cookie'yi elle ekleyen sentetik istek tarayıcı CSRF kanıtı diye raporlanmaz.

## S03

**Bildirim içeriği, sürüm ve tekrar tutarlılığı**

- **Bağımlılık:** F09-03.
- **Bulgu:** `20260911170000_phase9_notification_outbox.sql` claim sırasında güncel randevu/işletme alanlarını okuyor; `worker/notifications.ts` aynı provider anahtarını kullanıyor. Saat/ad değişince retry içeriği değişebilir; iptal edilmiş iş de confirmation için seçilebilir. Bu kaynak incelemesi bulgusudur, canlı müşteriye yanlış gönderim gözlenmiş değildir.
- **İş:** Olay/sürüm ve şablon sürümünü sabitle; aynı provider anahtarında aynı alıcı/içerik üretilsin. Düz bearer/full link saklamadan yeniden oluşturulabilir içerik veya şifreli materyal kullan. Henüz gönderilmemiş eski confirmation'ı iptal/taşımada geçersiz kıl; ilk gönderim için durum/sürümü son sorumlu noktada denetle. Yeni olay yeni iş kimliği alır, eski provider anahtarı yeniden kullanılmaz. İçerik snapshot'ı alıcı, işletme/zaman/timezone ve hizmet özetini; kayıt ayrıca event/template sürümünü kapsar. İçerik parmak izi gerçek provider isteğinin sender/origin/rendered body dahil alanlarını kapsar; eşdeğer donmuş temsil kullanılıyorsa aynı byte içeriği yeniden üretir. Ortam/şablon değişimi aynı provider anahtarının içeriğini değiştiremez. Kesinlikle gönderilmemiş confirmation taşımayla eski kaldıysa aynı transaction sınırında supersede edilir; aktif randevuya güncel sürümde tek yeni confirmation/job/provider anahtarı doğar. İptal yeni confirmation doğurmaz. Önceki kabul belirsizse otomatik yerine yeni confirmation üretilmez. Eski-sürüm belirsiz kabul için uzlaştırma durumu veya aynı dar anlamlı terminal neden kullanılır; gönderildi/teslim edildi uydurulmaz.
- **Alan / beceri:** Notification Worker/maintenance, booking/manage olay noktaları, yeni migration/test; Supabase + PostgreSQL, güncel Resend dokümanı.
- **Kabul:** Provider kabulü sonrası cevap kaybı ve işletme adı değişiminde, hâlâ geçerli aynı olayın retry'ı aynı payload hash'ini taşır. Saat değişimi/iptalle olay eski kaldıysa belirsiz kabul kaydı korunur ve otomatik gönderim tekrarı durur; eski payload'ın yeni bir e-posta yaratması göze alınmaz. Önceden iptal edilmiş randevu için yeni confirmation başlamaz. Kesin gönderilmemiş taşınan randevu tek güncel confirmation ile devam eder; eski iş ve yeni iş birlikte gönderilemez. Ortam sender/origin/şablon değişiminde mevcut geçerli retry aynı request fingerprint'ini korur. Claim/send arası cancel/reschedule ve lease expiry testlidir. Gönderim başladıktan sonraki iptalin dış sağlayıcı mesajını geri çekemeyeceği açıkça kaydedilir; süresi geçmiş hatırlatma yeniden yaratılmaz.
- **Belirsiz teslim:** Provider idempotency penceresi dışına çıkan bilinmeyen sonucun kontrolsüz otomatik tekrarına izin verilmez; inceleme/terminal yolu belgelenir. Resend mevcut belgede 24 saat ve aynı anahtar/farklı payload için 409 davranışı bildirir; uygulama anında yeniden doğrulanır. [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
- **Devir:** Olay/iş/sürüm tablosu, provider stub/hata testleri ve pending/leased/sent eski işlerle migration kanıtı. Önceki sürümde denenmiş fakat exact request içeriği kanıtlanamayan işin payload’ı tahmin edilerek yeniden gönderilmez; belirsiz iş olarak korunur. Kapsam dışı: yeni SMS/hatırlatma ürün özelliği; F16-02 aynı motoru genişletir.

## S04

**Güvenli tekrar ve yönetim uçlarında kaynak sınırı**

- **Bağımlılık:** F09-04.
- **Bulgu:** `20260911180100_phase9_public_abuse_hardening.sql` safe retry'da bütün sayaçları atlıyor. `worker/customer-manage.ts` ve hosted ACL migration'ında doğrudan manage RPC'leri eşdeğer kotalarla sınırlı değil. Yetki ihlali kanıtı değil, kaynak tüketimi sınırı eksikliğidir.
- **İş:** Başarılı tekrar yeni create bütçesi tüketmesin; ayrı read/retry bütçesine tabi olsun. View/slot/reschedule/cancel, recovery ve business-create uçlarını envantere al; pahalı işlem öncesinde uygun actor/network/business veya authenticated-user kotası uygula. Public gate'i atlayan doğrudan RPC yolu kapatılırken dar capability anlamı korunur.
- **Alan / beceri:** Public abuse/manage Worker'ları, guarded RPC'ler ve ileri migration/test; Supabase + PostgreSQL.
- **Kabul:** Aynı sonucu meşru yeniden deneme kurtarır; binlerce proof'lu tekrar sınırsız DB çalıştırmaz. Doğrudan RPC, yanlış proof, aynı ortak ağdaki iki kullanıcı ve limit yenilenmesi doğrulanır. Kota hit'i 429/Retry-After; idempotency conflict veya boş slot gibi sunulmaz. İptal/yönetim erişimi düşük bir business create kotasına takılmaz; işlem sınıfları ayrıdır.
- **Devir:** Sayısal eşik/yenilenme/anahtar tablosu, ölçüm ve maliyet etkisi; mevcut korumayı devre dışı bırakan geçiş yapılmaz.

## S05

**Staging secret ve dağıtım tutarlılığı**

- **Bağımlılık:** F17-01.
- **Bulgu:** `.github/workflows/staging.yml` her run yeni gate/dispatch secret üretip DB hash'ini Worker deploy'dan önce değiştiriyor. Aradaki hata mevcut Worker'ı yeni DB yetkisiyle uyumsuz bırakabilir; kısmi deploy senaryosudur.
- **İş:** Rutin dağıtımda secret korunur; rotasyon açık işlem olur. Yeni ortamdaki bootstrap ve bilinen çalışan ortamdaki rotasyon ayrılır. Rotasyon gerektiğinde sürümlü geçiş/iki geçerli anahtar veya güvenli eşdeğer cutover uygulanır; eski yetki son doğrulamadan önce kaldırılmaz. Yönetim şifreleme anahtarı korunur.
- **Alan / beceri:** Staging workflow, seed runtime config, provisioning/runbook ve dar testler; Cloudflare/GitHub resmi dokümanı, DB değişirse Supabase + PostgreSQL.
- **Kabul:** DB provisioning sonrası ve Worker deploy öncesi hata; başarısız deploy; smoke başarısızlığı; eşzamanlı iki run; tekrar run ve başarılı rotasyon test edilir. Önceki sürüm çalışır veya belgelenmiş tutarlı sürüme döner. Başarılı rotasyon sonunda eski secret reddedilir ve DB/Worker sürümleri eşleşir. Şifreli management materyali korunur; şifreleme anahtarı dönecekse ayrı sürümlü geçiş gerekir. Maskelenen secret log/fixture/artifact'a sızmaz; yetki kapsamı büyütülmez. Yeni ücretli kaynak açılmaz.
- **Devir:** Bootstrap/rotasyon/geri dönüş sırası ve gerçek staging kanıtı. Secret sayısını düşürmek kendi başına başarı ölçütü değildir.

## S06

**CI maliyeti ve merge kabul kapısı**

- **Bağımlılık:** F17-02.
- **Bulgu:** CI typecheck'i doğrudan ve iki build içinde tekrar çalıştırıyor; doküman PR'ında tüm pipeline koşuyor. Bazı testler davranış yerine YAML/source metni eşliyor. İnceleme anında main `protected:false`, rulesets boş; yeşil CI zorunlu merge kuralı olarak uygulanmıyor.
- **İş:** Tek kurulum/typecheck ve gerekli iki artifact build'ini ayır; değişen alanlara göre anlamlı test seçimi ve eski PR run'ını iptal etme ekle. Migration/test envanteri gerçek çalıştırılan girdileri doğrulasın. Docs-only için link/görev bağımlılık/durum kapısı kullan; karma ve bilinmeyen dosya değişiminde güvenli tam kontrole düş. Birleşme için sabit bir required sonuç ve gerekli inceleme korumasını repo yetkisiyle kur.
- **13 Eylül 2026 kullanıcı onayı:** Tek kişilik repoda GitHub insan onayı sayısı 0, son push yapan dışından onay false; PR ve güncel base üzerinde strict `CI gate` zorunludur. Boş bypass listesi ve force-push/silme engeli korunur. Bağımsız ajan incelemesi ile kanıt kaydı proje protokolünde kalır; ikinci yetkili insan hesabı kabul önkoşulu değildir. Aktif repo koruması gereği değişmez.
- **Alan / beceri:** CI workflow, package script'leri, coverage gate/testleri, dar runbook; GitHub Actions/resmi araç belgeleri. Yeni test framework'ü zorunlu değildir.
- **Kabul:** Docs-only PR DB'yi çalıştırmadan doğru yeşil sonuç üretir; code/migration değişimi doğru testleri çalıştırır. Yeni SQL testi unutulursa veya gerçek test kırılırsa aggregate gate kırmızıdır. YAML yorumuna dosya adını eklemek envanter testini kandıramaz. Her kaynak branch'ten açılan PR aynı kapsama girer; yalnız eski bir feature branch tetikleyicisine güvenilmez. Sadece alan adı/refactor değişimi davranış testini gereksiz bozmaz. Docs path filter required check'i sonsuza dek pending bırakmaz.
- **Repo kanıtı:** Main ruleset/protection ve exact-head required check doğrulanır; yönetim yetkisi yoksa ihtiyaç/sahip açıkça kaydedilir, görev tamamlandı sayılmaz. Plan revizyonu mevcut korumaları kaldırma veya bu ayarları şimdi değiştirme işi değildir.
- **Devir:** Önce/sonra job süre/çalışma sayısı, required check adı, davranış/negatif test ve repo koruma kanıtı. Mevcut CI, bu görev kabul edilene kadar yürürlükte kalır.

## S07

**Runtime bütçeleri ve operasyonel veri ömrü**

- **Bağımlılık:** S02, S03, S04.
- **Bulgu:** Mevcut bakım recovery şifreli materyalini temizliyor; terminal job alıcısı ve booking command içeriğinin tamamı için sonlu PII politikası yok. Bazı DB/RPC dış istekleri süre sınırı taşımıyor. Bunlar kaynak incelemesi ve eksik kontrol bulgusudur; canlı maliyet/performans ölçümü yapılmış değildir.
- **İş:** K03'ün mevcut modüllere uygulanabilir liste/timeout/bakım/retention sınırlarını uygula. Önce timeout ve dispatcher bakım bağımsızlığı, sonra PII temizliği ayrı dar alt işler olabilir. Yeni çoklu slot/medya limitlerini gelecekteki görevler uygular; henüz olmayan tablo/ekran kurulmaz. Ölçüm var olan log/metrik imkânlarıyla başlar.
- **Alan / beceri:** Ortak HTTP yardımcıları, mevcut list/read RPC'leri, notification maintenance, booking command payload ve testleri; Supabase + PostgreSQL. Mali kayıt silme veya genel arşiv sistemi kapsam dışıdır.
- **Kabul:** Asılı bakım dispatch'i süresiz durdurmaz; timed-out yazım sonucu aynı anahtarla bulunur. Temizlik aktif recovery/lease'i bozmaz; terminal PII ayıklanır; eski anahtar çift booking oluşturamaz. Liste sayfalaması kayıt atlamaz. Batch sınırı, sorgu planı ve K03 örnek yükünün süre/istek sayısı kaydedilir.
- **Devir:** Uygulanan süre/retention tablosu, ölçülen p95 ve sapma, secret içermeyen operasyon metrikleri. F17-03 geri yükleme/yayın/pilot sınırlarını tamamlar.

## S08

**Gelecekteki DB nesnelerinde erişim kapısı**

- **Bağımlılık:** F17-01, F17-02.
- **Bulgu:** `20260912030000_f17_hosted_acl_hardening.sql` ve mevcut testlerde future function execute kontrolü var; yeni table/sequence/view için eşdeğer varsayılan erişim testi yok. Mevcut tenant izolasyon açığı olarak raporlanmaz; gelecek migration güvenlik kapısı eksiktir.
- **İş:** Gerçek migration rolü/sahipliğiyle exposed schema nesne envanteri ve explicit grant varsayılanlarını doğrula; yeni table, sequence, function ve view için disposable negatif test ekle. RLS ile object grant ayrı değerlendirilir; private schema/definer istisnası dar ve gerekçeli kalır.
- **Alan / beceri:** İleri ACL migration, SQL kabul testi/CI bağlantısı; Supabase + PostgreSQL. [Supabase API güvenliği](https://supabase.com/docs/guides/api/securing-your-api), [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
- **Kabul:** Yeni nesne istemeden anon/authenticated erişimi kazanmaz; yetkili explicit grant + uygun policy çalışır. Owner/BYPASSRLS ile yapılan test tenant izolasyonu kanıtı sayılmaz. View/definer/fonksiyon erişimi ayrıca doğrulanır; dar public booking ve server-only dispatch işlevleri gerilemez. Local ve hosted migration rolü farkı belgelenir.
- **Devir:** Rol/nesne/erişim matrisi, negatif ve pozitif SQL/API kanıtı. Yeni migration yazan Sol bu kapıyı sonraki bütün veri görevlerinde kullanır.

## Uygulama sırası ve kapanış

İlk bağımsız işler S01, S03, S04, S05, S06, S08'dir. Bu bir toplu otomatik atama değildir: S03/S04 ortak migration fonksiyonlarını, S05/S06/S08 CI bağlantısını değiştirebilir; tek yazıcı ve merge sırası baştan belirlenir. S02 S01'i, S07 S02/S03/S04'ü bekler. En küçük başlangıç işi S01'in mevcut recovery oturumunda hata/expiry davranışıdır.

GS, sekiz görevin kendi kabulü ve birleşik regression kanıtıyla kapanır. Eski yeşil test geçmişi silinmez; yeni senaryolar geçmeden düzelmiş sayılmaz. GS sonrası F10-02 mevcut PR #32 ile çakışma/yeniden temel alma kontrolünden sonra devam eder. Yeni ürün fazlarını veya PDF güncellemesini bu plan PR'ı başlatmaz.
