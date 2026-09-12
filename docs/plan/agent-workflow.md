# Ajan çalışma akışı

Bu belge, görevlerin farklı oturumlar ve uygulayıcılar arasında aynı kapsam ve kanıtla sürdürülebilmesi için kısa çalışma protokolüdür. Ürün kapsamı [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md) ve [ROADMAP.md](../../ROADMAP.md), canlı durum ve bağımlılıklar [TASKS.md](../../TASKS.md), kodun doğrulanmış mevcut hali [PROJECT_STATE.md](../../PROJECT_STATE.md) içindedir. Burada teknik görev planları tekrarlanmaz.

## Teknik kapılar

Canlı görev/sahip/PR durumu [TASKS](../../TASKS.md) üzerinden okunur; bu rehber ikinci bir durum tablosu tutmaz. `GS`, [S01…S08](stabilization.md) teknik düzeltmelerinin kabulüdür. Yeni özellik kodu GS'yi bekler; F12-01 görsel yön çalışması ayrı planlanabilir. [K01…K03](architecture-contracts.md) bağlayıcı tasarım bölümleridir, görev veya grafik düğümü değildir. Bağımlılık hücreleri yalnız TEMEL/Sxx/Fxx-yy/GS/Gxx kullanır.

## Bir görev nasıl akar?

1. **Koordinatör görevi sınırlar.** TASKS ve açık PR'lardan sahiplik ile bağımlılıkları doğrular. Kimlik, base SHA, branch, yazılabilir dosyalar, kontratlar, kapsam dışı, kabul ve inceleme gereğini kalıcı görev paketine yazar.
2. **Uygulayıcı başlangıcı doğrular.** Güncel kaynak sırasını ve yalnız ilgili kod/testleri okur. Atanmış alan ya da önkoşul çakışıyorsa kod yazmadan kaydeder. Uygun beceriyi yükler ve sabit adını not eder.
3. **En küçük kabul dilimi uygulanır.** Değişiklik, görev paketindeki kontratı korur. Yeni API, route, migration veya ekran önerisi mevcutmuş gibi tüketilmez; bağımlı çalışma önce kalıcı kontratı bekler.
4. **Risk kadar kanıt üretilir.** Mevcut CI kapısı ve görevin davranış riski doğrulanır. Başarısızlıklar hipotez ve gözlenen sonuçla kaydedilir.
5. **Koordinatör bağımsız inceler.** Özellikle auth, para ve migration sınırlarını uygulayıcıdan bağımsız kontrol eder. Kabul eksikse durum `İncelemede` veya `Main'de / kabul açık` kalır.
6. **Kalıcı devir yazılır.** [CONTRIBUTING şablonu](../../CONTRIBUTING.md#oturum-sonu-devri) doldurulur; TASKS ve PR aynı gerçek durumu gösterir. Sonraki oturumun ilk adımı tek ve çalıştırılabilir olur.

## Rol sınırları

| Rol | Sorumluluk |
| --- | --- |
| Koordinatör — ana ajan | Kontratları, dosya sahipliğini, kapsam dışını, bağımlılıkları, kabulü ve merge sırasını belirler; auth/para/migration kanıtını bağımsız inceler. |
| Uygulayıcı — varsayılan GPT-5.6 Sol | İlgili beceriyi okur, atanmış dosyalarda kontrata göre uygular, anlamlı test ve devir kanıtı üretir. |
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
- Uygulama ayrıntısını aynalayan veya yalnız mock'u doğrulayan test kabul kanıtı değildir.
- Aynı hipotez 2–3 kez başarısız olursa yeni rastgele varyasyon deneme. Hipotezi, komutları, çıktıyı ve değişen dosyaları kaydet; koordinatör incelemesinden sonra devam et.
- Somut yeni risk, kod değişimi veya gerekli merge sonucu yoksa tam suite'i tekrarlama. Mevcut CI kapıları ancak S06 kapsamında ayrı, incelenmiş bir kod değişikliğiyle değişir.
- Yalnız doküman PR'ında yerel linkler, görev bağımlılıkları, durum ifadeleri ve diff kontrol edilir. Repo politikası CI gerektiriyorsa mevcut kapı ayrıca çalıştırılır.

## Devredilebilir kanıt

Devir, yalnız bir önceki sohbeti bilen kişinin değil, yeni bir oturumun doğrudan devam edebileceği ayrıntıyı taşır. En az şu alanlar bulunur: görev; base SHA; branch; head commit ve PR; değişen dosyalar; kontratlar; okunan beceri; test kanıtı; başarısız/atlanmış kontrol; engel; sonraki tek somut adım. Geçici talimat, sahiplik veya kritik karar yalnız sohbet içinde bırakılamaz.
