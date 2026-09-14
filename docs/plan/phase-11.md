# Faz 11 — Çok hizmetli randevu çekirdeği

**Sonuç:** Bir müşteri işleminde birden çok hizmet ve personel, bütünlüğü korunan tek rezervasyon grubudur. **Kapı:** G11. Durumlar [TASKS.md](../../TASKS.md) içindedir.

Okuma başlangıcı: `worker/bookings.ts`, `worker/availability.ts`, `worker/public-booking.ts`, `worker/customer-manage.ts`, `worker/calendar.ts`, Faz 4–9 ve hosted ACL migration/testleri; `booking_commands`, audit, recovery/capability ve notification outbox tüketicileri. Mevcut tek hizmetli model korunur; aşağıdaki grup/satır adları yeni model önerisidir, mevcut tablo iddiası değildir.

**Faz direktifi / kaynak head `5e789ad`:** F11-01/02/04 şema, kimlik, atomiklik ve concurrency nedeniyle STRICT kabul edilir; F11-03 yalnız uyumluluk/adaptasyon sınırında kalırsa FOCUSED yürütülebilir. Bu bloktaki repo-durumu iddiaları kart açılırken current main'de yeniden doğrulanır.

## F11-01

**Grup/satır sözleşmesi ve ileri migration**

- **Bağımlılık:** F10-02, F12-03.
- **Sorumluluk:** Veri/backend. **Çakışma alanı:** Ortak randevu şeması ve API sözleşmesi.
- **İş ve çıktı:** Grup ve hizmet satırının kimliği, sırası, personeli, başlangıç/bitişi, süre/tamponu, fiyat/para birimi snapshot'ı ve sürümünü tanımla. Tek hizmetli kayıtlar ve eski yönetim linkleri için uyumluluk planı ve ileri migration yaz.
- **Kabul:** Her ilişki aynı tenant'a aittir; satır doluluğu mevcut exclusion korumasını sürdürür. Başlangıç modeli ardışık hizmettir; aynı müşterinin eşzamanlı farklı hizmeti veya boyanın bekleme kapasitesi varsayılmaz. Eski veriden yükseltme veri kaybetmez; birleşmiş migration dosyaları değişmez.
- **Devir:** Yeni veri/yanıt şeması, hata kodları, snapshot ve durum kuralları; önce bu sözleşme main'e alınır, bağımlı arayüzler ona bağlanır.
- **Bağlayıcı sözleşme:** [K01](architecture-contracts.md#k01) kimlik/uyum ve [K02](architecture-contracts.md#k02) fiyat anlamları. F12-03 önce biter; fiyat türü, alt/üst, currency ve policy-version snapshot alanı burada ikinci kez tasarlanmaz.
- **v3 kabul:** Migration öncesi veri seti F09 `booking_commands`, audit, capability, recovery ve pending/leased/retry/sent outbox kayıtlarını da içerir. Eski appointment kimliği, link, anahtar ve provider receipt korunur. Backfill aynı maili yeniden üretmez; açık eski istek ve eski uygulama sürümü geçiş testi geçer.
- **Hazır olan:** Faz 5 exclusion constraint'i, `occupied_starts_at/ends_at`, `booking_commands`, audit/recovery/capability ve notification outbox tüketicileri yeniden icat edilmez; migration bunları genişletir.
- **Tuzak / saha kapısı:** Geri alınamaz grup/satır granülerliği gerçek salon iş akışıyla doğrulanmadan final migration kabul edilmez. En az bir kuaför/berber görüşmesinde “boya + kesim”, aynı/farklı personel, işlem arası bekleme, kısmi değişiklik/iptal ve fiyat kesinleşme anı `confirmed / contradicted / unknown` olarak kaydedilir. Discovery kodu başlayabilir; irreversible schema merge bu receipt'i bekler.
- **Tuzak / migration bütünlüğü:** `appointments`, management links/capability, `booking_commands`, audit, recovery ve notification outbox için ayrı upgrade hikâyesi vardır. Grup oluşturma tek transaction'dır; N satırın exclusion kontrolleri commit öncesi birlikte görülür. Bir grup create/replay, `booking_commands` tarafında **tek komut + tek request_hash** olarak temsil edilir; N bağımsız komuta bölünmez. Hizmet/personel/fiyat/süre snapshot'ı satır bazında kalır; grup kimliği snapshot'ın yerine geçmez.

## F11-02

**Çok hizmetli müsaitlik ve atomik oluşturma**

- **Bağımlılık:** F11-01.
- **Sorumluluk:** Veri/backend. **Çakışma alanı:** Slot hesabı ve public/operatör oluşturma.
- **İş ve çıktı:** Seçili hizmetleri açık sırayla planla; aynı/farklı uygun personel, molalar, tamponlar, kapanışlar ve timezone hesaplarını ortak motorda uygula. Personel tercihi yoksa gerçek atamayı commit sırasında seç. Çok personelli kilitleri kararlı sırayla al.
- **Kabul:** Bir satır çakışınca grubun hiçbir satırı kalmaz. Grup idempotency anahtarı aynı sonucu döndürür; farklı payload aynı anahtarla reddedilir. Son anda dolan saat için anlamlı çakışma döner. Süre/toplam ile sunulan slot aynı planı ifade eder; kombinasyon sayısı/istek sınırı belgelenir.
- **Devir:** Slot/oluşturma API örnekleri, kapasite sınırları ve çok personelli concurrency testleri.
- **v3 bütçe:** [K03](architecture-contracts.md#k03) grup/slot sınırlarını API ve DB’de uygula. Aday kombinasyonları süre/aday bütçesine tabidir; aşım yazımdan önce belirgin hata verir, boş slot veya yarım grup olmaz. S03 olay/sürüm protokolüyle tek create olayı doğar.
- **Hazır olan:** Tek-hizmet exclusion ve tampon mantığı başlangıç motorudur; paralel ikinci bir availability motoru kurulmaz.
- **Tuzak:** Çoklu müsaitlik tek hizmet hesabını N kez çağırmak değildir. Grup içi ardışıklık, aynı/farklı personel ve saha doğrulamasında gerçekse hizmetler arası bekleme/işlem boşluğu tek plan olarak modellenir.

## F11-03

**Grup yönetimi ve mevcut ekranlarla uyum**

- **Bağımlılık:** F11-02.
- **Sorumluluk:** Backend + mevcut arayüz adaptasyonu. **Çakışma alanı:** Taşıma/iptal, capability, calendar projection ve booking sayfası.
- **İş ve çıktı:** Grup görüntüleme/taşıma/iptali atomik uygula; yönetim yetkisini yalnız ilgili gruba sınırla. Mevcut takvim ve tek hizmetli API tüketicileri yeni satırları kaybetmeden gösterir. Oluşmuş mali kayıtlar eklendiğinde kullanılacak olay sözleşmesini tanımla.
- **Kabul:** Başarısız taşıma tüm eski saatleri korur. Eski sürümle değişiklik diğer operatörün işlemini ezmez. Eski tek hizmetli linkler çalışır; bir satır kimliğinden başka gruba erişilemez. İptal/terminal durum ve audit kuralları korunur.
- **Devir:** Uyumluluk eşleştirmesi, grup/satır gösterim kuralları ve yönetim/takvim gerileme sonuçları.
- **v3 uyum:** K01’deki capability/recovery/audit/outbox tüketicileri grup kimliğine birlikte bağlanır; legacy kimlikler korunur. S03 immutable job içeriği eski appointment alanlarından tekrar kurulmaz. F16-01 seri oluşumları da aynı grup olayı/sürümünü üretecektir.
- **Tuzak / kapsam:** Bu kartın işi mevcut ekranları grup-farkında yapmak ve yönetim semantiğini korumaktır. Takvim görsel yeniden tasarımı, ortak shell yeniden yazımı veya yeni müşteri UX'i burada açılmaz; bunların sahipleri F13/F12'dir. Kritik yol tüketicileri nedeniyle kapsam büyümesi blocker sayılır.

## F11-04

**Çakışma, timezone ve yükseltme kabulü**

- **Bağımlılık:** F11-03, F17-02.
- **Sorumluluk:** QA/veri. **Çakışma alanı:** Randevu gerileme testleri.
- **İş ve çıktı:** Eski ve yeni modellerin birlikte olduğu veri setiyle SQL, HTTP ve eşzamanlı işlem testlerini çalıştır.
- **Kabul:** Aynı personele aynı aralık için farklı anahtarlı 100 istekte bir rezervasyon kazanır. Çok hizmetli kayıtta yarım grup yoktur. Bitişik `[başlangıç, bitiş)` aralıkları, tampon, gece/gün sınırı ve DST atlanan/tekrarlanan saatler doğrulanır. Eşzamanlı mesai değişimi ve taşıma kilit protokolünü atlamaz.
- **Devir:** Tekrarlanabilir fixture, komut ve sonuç; G11 için kod ve yükseltme kanıtı. Yeni müşteri estetiği Faz 12'de, kapsamlı panel düzeni Faz 13'tedir.
- **v3 yükseltme kabulü:** F09 recovery/receipt/idempotency testleri de yeni modelde geçer; eski anahtar ve linkler, aktif lease, cevabı kayıp gönderim ve birden çok satırlı audit/iptal doğrulanır. K03 örnek yükünde slot süresi ve sorgu sayısı kaydedilir.
- **Hazır olan:** İşletme timezone doğrulaması ve `pg_timezone_names` tabanlı temel geçmiş fazlarda kurulmuştur; ikinci timezone doğrulama sistemi açılmaz.
