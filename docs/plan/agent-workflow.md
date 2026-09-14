# Ajan çalışma akışı

Bu belge, görevlerin farklı oturumlar ve uygulayıcılar arasında aynı kapsam ve kanıtla sürdürülebilmesi için kısa çalışma protokolüdür. Ürün kapsamı [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md) ve [ROADMAP.md](../../ROADMAP.md), canlı durum ve bağımlılıklar [TASKS.md](../../TASKS.md), kodun doğrulanmış mevcut hali [PROJECT_STATE.md](../../PROJECT_STATE.md) içindedir. Burada teknik görev planları tekrarlanmaz.

## Teknik kapılar

Canlı görev/sahip/PR durumu [TASKS](../../TASKS.md) üzerinden okunur; bu rehber ikinci bir durum tablosu tutmaz. `GS`, [S01…S08](stabilization.md) teknik düzeltmelerinin kabulüdür. Yeni özellik kodu GS'yi bekler; F12-01 görsel yön çalışması ayrı planlanabilir. [K01…K03](architecture-contracts.md) bağlayıcı tasarım bölümleridir, görev veya grafik düğümü değildir. Bağımlılık hücreleri yalnız TEMEL/Sxx/Fxx-yy/GS/Gxx kullanır.

Canlı koordinasyon ve aktif validation bütçesi Issue #65 üzerinden yürütülür. Ürün doğrulama / geri-alınabilirlik politikası Issue #83'te tutulur.

## Validation budget

Varsayılan bütçe **LIGHT**'tır. FOCUSED veya STRICT seçilecekse somut risk gerekçesi yazılır.

| Bütçe | Tipik kapsam | Yeterli kanıt |
| --- | --- | --- |
| **LIGHT** | copy, CSS/layout, docs, izole component, düşük-risk refactor | mevcut required CI + gerekiyorsa dar unit/browser testi + implementer smoke |
| **FOCUSED** | gerçek user-flow, operator UI, tenant switch, router/shell, Storage/public lifecycle, önemli API contract | exact candidate CI + risk alanına göre tek ilgili reviewer; staging yalnız hosted-only kanıt gerekiyorsa |
| **STRICT** | auth authority, cross-tenant kritik yüzey, irreversible schema/identity, para/ledger, idempotency/concurrency, destructive migration | gerekli DB clean/upgrade ve negatif/concurrency kanıtı + R1; R2 yalnız browser/integration davranışı da kritikse; staging yalnız hosted-only davranışta |

Kurallar:
- `Her feature = R1 + R2` diye otomatik bir kapı yoktur.
- DB/auth/security riski tek başınaysa R1; saf browser/integration riski tek başınaysa R2 yeterlidir.
- Aynı semantic code tree daha önce kabul edildiyse yalnız docs/TASKS marker descendant için full review tekrarlanmaz.
- Docs-only PR için runtime/staging kanıtı istenmez; docs/task-graph kontrolü yeterlidir.
- Staging varsayılan değildir. Hosted Auth/PKCE, gerçek Storage policy/object davranışı, provider callback/delivery veya Cloudflare/runtime farkı gibi lokal/CI kanıtının yetersiz kaldığı durumda açılır.
- Yeni bir kanıtın karar değiştirme ihtimali düşükse sırf daha fazla güven üretmek için ek review/staging turu açılmaz.

## Bir görev nasıl akar?

1. **Koordinatör görevi sınırlar.** TASKS ve açık PR'lardan sahiplik ile bağımlılıkları doğrular. Kimlik, base SHA, branch, yazılabilir dosyalar, kontratlar, kapsam dışı, kabul ve `Validation budget: LIGHT | FOCUSED | STRICT` sınıfını kalıcı görev paketine yazar.
2. **Uygulayıcı başlangıcı doğrular.** Güncel kaynak sırasını ve yalnız ilgili kod/testleri okur. Atanmış alan ya da önkoşul çakışıyorsa kod yazmadan kaydeder. Uygun beceriyi yükler ve sabit adını not eder.
3. **En küçük kabul dilimi uygulanır.** Değişiklik, görev paketindeki kontratı korur. Yeni API, route, migration veya ekran önerisi mevcutmuş gibi tüketilmez; bağımlı çalışma önce kalıcı kontratı bekler.
4. **Risk kadar kanıt üretilir.** LIGHT işte hafif, FOCUSED işte hedefli, STRICT işte yüksek güvenli kanıt üretilir. Başarısızlıklar hipotez ve gözlenen sonuçla kaydedilir.
5. **Yalnız gerekli bağımsız inceleme yapılır.** Validation bütçesi ve gerçek risk alanı hangi reviewer'ı gerektiriyorsa yalnız o kapı açılır. Auth/DB/access için R1; browser/integration/a11y için R2. İki reviewer ancak iki risk alanı gerçekten kesişiyorsa gerekir. Kabul eksikse durum `İncelemede` veya `Main'de / kabul açık` kalır.
6. **Kalıcı devir yazılır.** [CONTRIBUTING şablonu](../../CONTRIBUTING.md#oturum-sonu-devri) doldurulur; TASKS ve PR aynı gerçek durumu gösterir. Sonraki oturumun ilk adımı tek ve çalıştırılabilir olur.

## Rol sınırları

| Rol | Sorumluluk |
| --- | --- |
| Koordinatör — ana ajan | Kontratları, validation bütçesini, dosya sahipliğini, kapsam dışını, bağımlılıkları, kabulü ve merge sırasını belirler; yalnız gerekli review/staging kapılarını açar. |
| Uygulayıcı — varsayılan GPT-5.6 Sol | İlgili beceriyi okur, atanmış dosyalarda kontrata göre uygular, validation bütçesine uygun test ve devir kanıtı üretir. |
| R1 — security/DB reviewer | Yalnız DB/auth/access/security veya STRICT finans/migration riski gerektirdiğinde bağımsız inceleme yapar; feature implementeri değildir. |
| R2 — browser/integration reviewer | Yalnız browser/integration/a11y/user-flow riski gerektirdiğinde bağımsız inceleme yapar; feature implementeri değildir. |
| Ürün sahibi/kullanıcı | Ürün kararı veya gerçek kullanıcı girdisi gereken noktayı çözer; zaten verilmiş uygulama ya da merge yetkisi yeniden istenmez. |

Bir görevde rol veya dosya alanı çatışırsa önce sahiplik ayrılır. Araç, ortam ya da gerçek kullanıcı onayı zorunluysa sınır ve devam koşulu kaydedilir. Protokol kendi başına yeni bir onay kapısı oluşturmaz.

## Beceri yönlendirmesi

| Görev/iş türü | Okunacak sabit beceri adı | Kullanım sınırı |
| --- | --- | --- |
| S01–S02; diğer Supabase Auth, RLS veya DB işleri | `supabase:supabase` | Auth/DB uygulama ve güvenlik akışı için. |
| S03–S04, S07–S08; F11, F14–F16 içindeki DB işleri | `supabase:supabase` ve `supabase:supabase-postgres-best-practices` | Supabase güvenlik akışı ile ilgili Postgres şema/sorgu kararını birlikte ele almak için. |
| S05–S06 | Resmi sağlayıcı dokümanları ve mevcut repo araçları; Supabase/DB değişirse ilgili iki Supabase becerisi | Cloudflare, CI veya Resend için var olmayan bir beceri adı üretilmez. |
| Gerçek kullanıcı arayüzü smoke/kabulü | `control-browser` | Canlı veya yerel çalışan UI'da gerçek davranışı doğrulamak için. |
| F12–F14'te onaylanmış görsel referansı uygulama | `product-design:image-to-code` | Yalnız seçilmiş/onaylı UI referansı koda çevrilecekse. Sıradan frontend işi için zorunlu değildir. |
| Ayrı ve daha sonraki UX incelemesi | `product-design:audit` | Uygulama görevinin yerine geçmeyen bağımsız audit için. |
| Bağımsız PDF teslimi | `pdf` | Yalnız kullanıcı ayrıca standalone PDF isterse; repo planı için kendiliğinden kullanılmaz. |

Beceri adı listede görünse bile içeriği okunmadan “kullanıldı” sayılmaz. Gerekli beceri bulunamıyorsa veya açılamıyorsa bunu devirde kaydet; koordinatör resmi dokümanlar ve mevcut repo araçlarıyla belgelenmiş güvenli eşdeğeri seçer ya da görevi engelli tutar. Beceri okuma, yalnız o çalışma için görev yönergelerini yükler.

## Test ve geri bildirim döngüsü

- Test, önemli davranışı kanıtlar: auth için yetkisiz/eskimiş oturum; DB için tenant ve RLS; migration için temiz kurulum ile upgrade; para için invariant, tekrar güvenliği ve audit; UI için kullanıcı eylemi ve görünen sonuç.
- Bu örnekler yalnız ilgili risk varsa zorunludur; reversible bir UI değişikliği için gereksiz DB/concurrency/staging töreni kurulmaz.
- Uygulama ayrıntısını aynalayan veya yalnız mock'u doğrulayan test kabul kanıtı değildir.
- Bir gerçek-browser runner birden fazla kullanıcı davranışı/senaryosu doğruluyorsa stabil, insan-okunur senaryo adları raporlar. Helper biçimi serbesttir; failure yalnız satır/assert mesajıyla değil kırılan kabul senaryosunun adıyla teşhis edilebilir olmalıdır.
- Aynı hipotez 2–3 kez başarısız olursa yeni rastgele varyasyon deneme. Hipotezi, komutları, çıktıyı ve değişen dosyaları kaydet; koordinatör incelemesinden sonra devam et.
- Somut yeni risk, kod değişimi veya gerekli merge sonucu yoksa tam suite'i tekrarlama. Mevcut CI kapıları ancak S06 kapsamında ayrı, incelenmiş bir kod değişikliğiyle değişir.
- Yalnız doküman PR'ında yerel linkler, görev bağımlılıkları, durum ifadeleri ve diff kontrol edilir. Repo politikası CI gerektiriyorsa mevcut kapı ayrıca çalıştırılır.

## Devredilebilir kanıt

Devir, yalnız bir önceki sohbeti bilen kişinin değil, yeni bir oturumun doğrudan devam edebileceği ayrıntıyı taşır. En az şu alanlar bulunur: görev; validation budget; base SHA; branch; head commit ve PR; değişen dosyalar; kontratlar; okunan beceri; test kanıtı; başarısız/atlanmış kontrol; engel; sonraki tek somut adım. Geçici talimat, sahiplik veya kritik karar yalnız sohbet içinde bırakılamaz.

İleri faza taşınan bir teknik sınır `F13'te çözülür` gibi jenerik cümleye sıkıştırılmaz. Carry-forward en az **pozitif garanti**, **negatif sınır**, **exact risk yüzeyi** (kolon/route/akış), **exact hedef task** ve yanlış sahiplenme riski varsa **exclusion** bilgisini korur. Kısaltma bu bilgiden birini siliyorsa boundary metni kısaltılmaz.
