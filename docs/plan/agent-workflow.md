# Ajan çalışma akışı

Bu belge, görevlerin farklı oturumlar ve uygulayıcılar arasında aynı kapsam ve kanıtla sürdürülebilmesi için kısa çalışma protokolüdür. Ürün kapsamı [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md) ve planlanan sıra [ROADMAP.md](../../ROADMAP.md) içindedir. **Canlı görev/main kabul durumu ve bağımlılıklar için tek kaynak [TASKS.md](../../TASKS.md)'dir.** Burada teknik görev planları veya ikinci durum özeti tekrarlanmaz.

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
5. **R0 gerekiyorsa bounded çalışır; yalnız gerekli bağımsız inceleme açılır.** İlk R0 adayında confirmed blocker'lar stable ID ile dondurulur. Repair sonrası R0 bütün sistemi yeniden keşfetmez; yalnız frozen blocker kapanışı ve repair-caused regression kontrol eder. Validation bütçesi ve gerçek risk alanı hangi bağımsız reviewer'ı gerektiriyorsa yalnız o kapı açılır. Auth/DB/access için R1; browser/integration/a11y için R2. İki reviewer ancak iki risk alanı gerçekten kesişiyorsa gerekir.
6. **Kalıcı devir yazılır.** [CONTRIBUTING şablonu](../../CONTRIBUTING.md#oturum-sonu-devri) doldurulur; TASKS ve PR aynı gerçek durumu gösterir. Sonraki oturumun ilk adımı tek ve çalıştırılabilir olur.

### Review lineage kernel

Bu bölüm review modu, lineage/freshness ve takip receipt biçiminin **tek canonical owner**'ıdır. Skills yalnız rolün risk/kanıt ayrıntılarını ekler. TASKS canlı otorite, PR/CI/receipt'ler candidate-bound kanıt olarak kalır; yeni tracker, canlı manifest veya her push'ta yeni Context Pack zorunluluğu yoktur.

**Kimlik önce.** Aynı görev/PR ve aynı rol için önceki durable receipt, reviewed exact SHA, current head/base, approved delta/writable scope ve frozen blocker seti bağlanır. Erişilemeyen receipt `NONE` değildir. Git ancestry/diff provenance kanıtıdır; branch adı veya aynı patch görüntüsü tek başına lineage kanıtı değildir.

**R0 yaşam döngüsü:** `DISCOVERY → FREEZE → REPAIR → VERIFICATION`. İlk discovery changed surface + en fazla bir direct dependency hop'tur. Freeze durable PR review/comment üzerinde exact head ve stable `R0-B1…` ID'leri veya açık `NONE` taşır. Descendant repair head VERIFICATION'dır: authored delta/scope, frozen blocker closure, direct repair regression ve ilgili current kanıt incelenir. Normal invariant `next_blockers ⊆ frozen_blockers`'dır. Aynı semantic kusur yeni ID almaz; eksik test `UNVERIFIED`/kanıt boşluğudur.

**Escape sınırı.** VERIFICATION'da yalnız somut secret/credential exposure, auth privilege escalation, cross-tenant breach, destructive data/migration corruption, financial/ledger double-effect veya mevcut hard safety invariant ihlali yeni `ESCAPE-BLOCKER` olabilir. Exact-head counterexample + ihlal edilen invariant gerekir. Diğer yeni gözlemler DEFERRED/nit'tir ve current acceptance'ı genişletmez.

**R1/R2 follow-up.** Aynı rolün sonraki turu kapanış/delta odaklıdır; R0 receipt'i ilk bağımsız R1/R2 incelemesini follow-up'a dönüştürmez. Fresh independent context, risk-based routing ve gerekli acceptance yükümlülükleri korunur. Semantic değişiklik yalnız etkilenen acceptance'ı sıfırlar; her head değişimi otomatik full re-review değildir.

**Freshness routing:**
- Descendant repair → bounded closure verification; whole-PR rediscovery yok.
- Upstream-main/base sync ve authored delta aynı → inherited yollar ancak provenance ile authored scope dışında; integration kanıtı/base freshness yeniden doğrulanır.
- Docs/metadata-only descendant → semantic etkisizlik diff ile doğrulanır; gerekirse delta confirmation, otomatik full reset yok.
- Semantic değişiklik → etkilenen R1/R2 receipt stale; fresh ilgili kanıt/review.
- Non-descendant/unknown ancestry veya scope conflict → `INCOMPLETE`; coordinator lineage/scope refresh verir. Sessiz receipt reuse veya rediscovery yok.
- Review sırasında live head değişirse head-bound sonuç stale kalır; yeni current verdict üretmeden assignment refresh istenir.

**Kanıt kimliği.** Starting main, current base, raw head, semantic SHA, gerçekten test edilen checkout/merge-ref ve run/job/attempt farklı kimliklerdir. Historical green current proof değildir. Aynı raw head eski base'e karşı test edildiyse current integration proof sayılmaz. Browser served-build ve DB migration-chain kimliği rol-specific artifact'te kalır. `unknown`, failed veya skipped değer PASS/NONE/false olarak yorumlanmaz.

**Shared writer.** İki writer aynı shared critical path'i isterse yazma durur; TASKS + aktif Issue #65 claim + açık PR scope üzerinden coordinator tek writer, merge sırası veya izole scope verir. Bu kernel writer token üretmez.

Takip brief'i mevcut PR/comment zincirinde şu bilgileri taşır; aynı veri için yeni dosya/manifest açılmaz:

```text
Previous receipt: same-role receipt; R0 için discovery/freeze reference
Previous reviewed SHA: receipt'in exact reviewed head'i
Candidate SHA: current exact head / base / semantic identity gereken yerde
Approved delta: coordinator reference / repair range / writable scope
Frozen blockers: stable IDs veya açık NONE
Closure evidence: blocker ID -> CLOSED | OPEN | UNVERIFIED / candidate-bound evidence
Evidence gaps: missing / failed / skipped / unknown obligations; yoksa NONE
Next coordinator action: tek somut adım
```

Sonuç dosya envanterinden önce karar-öncelikli başlar:

```text
VERDICT: R0 = FINDINGS | NO FINDINGS | INCOMPLETE; R1/R2 = ACCEPTABLE | BLOCKER | INCOMPLETE
BLOCKERS: open frozen IDs / ESCAPE-BLOCKER; yoksa NONE, bilinmiyorsa UNKNOWN
EVIDENCE GAPS: missing / failed / skipped / provenance-scope conflict; yoksa NONE
REVIEWED SHA: gerçekten incelenen exact head
NEXT ACTION: coordinator için tek somut adım
```

Hiçbir verdict GitHub APPROVE, self-ready veya merge yetkisi vermez.

## Rol sınırları

| Rol | Sorumluluk |
| --- | --- |
| Koordinatör — atanmış koordinatör veya insan operatör | Kontratları, validation bütçesini, dosya sahipliğini, kapsam dışını, bağımlılıkları, ajan routing'ini, kabulü ve merge sırasını belirler; yalnız gerekli review/staging kapılarını açar. |
| Scout — Gemini | Yalnız belirsiz scope/dependency/repo keşfinde read-only context pack üretir; scope açıksa atlanır. |
| Uygulayıcı otomasyon route'u — Qwen | Koordinatör açıkça seçtiğinde dondurulmuş kontrattan yeni task branch/PR üretir; model rolün otoritesi değildir. Mevcut workflow in-place repair yapmaz. |
| R0 — Copilot | İlk candidate'da bounded discovery, repair descendant'ta frozen-blocker verification yapar; acceptance/merge authority değildir. |
| Provider fallback — Cloudflare Workers AI | Yalnız desteklenen inference route'unda tercih edilen provider unavailable/quota olduğunda aynı rolü devralır; ekstra review katmanı oluşturmaz. |
| R1 — security/DB reviewer | Yalnız DB/auth/access/security veya STRICT finans/migration riski gerektirdiğinde bağımsız inceleme yapar; feature implementeri değildir. |
| R2 — browser/integration reviewer | Yalnız browser/integration/a11y/user-flow riski gerektirdiğinde bağımsız inceleme yapar; feature implementeri değildir. |
| R3: mimari/sözleşme incelemecisi | Yalnız atanmış modüller arası sözleşme, ortak iş kuralı ve bağımlılık sınırı sorusunu inceler; `dev-review-r3` etiketi ve geçerli koordinatör ataması gerekir. [R3/R4 sözleşmesi](../development-engine/automations/r3-r4-review.md). |
| R4: test kanıtı/regresyon incelemecisi | Yalnız atanmış kabul iddiası ile gerçek test/CI kanıtının eşleşmesini ve eksik gerileme senaryosunu inceler; `dev-review-r4` etiketi ve geçerli koordinatör ataması gerekir. [R3/R4 sözleşmesi](../development-engine/automations/r3-r4-review.md). |
| Ürün sahibi/kullanıcı | Ürün kararı veya gerçek kullanıcı girdisi gereken noktayı çözer; zaten verilmiş uygulama ya da merge yetkisi yeniden istenmez. |

Bir görevde rol veya dosya alanı çatışırsa önce sahiplik ayrılır. Araç, ortam ya da gerçek kullanıcı onayı zorunluysa sınır ve devam koşulu kaydedilir. Protokol kendi başına yeni bir onay kapısı oluşturmaz.

R3/R4 saatlik görevleri yalnız kendilerine etiketlenmiş ve exact head/base ile atanmış işi alır; her PR'a uygulanmaz. Koordinatör somut katkı gerekçesine göre yalnız ilgili etiketi ekler, implementer yalnız önerir. Sonuçları ek danışman kanıtıdır; R1/R2 yerine geçmez, yeni zorunlu kabul kapısı veya otomatik merge yetkisi yaratmaz. Etiket/atama/sonuç yaşam döngüsünün tek tanımı [R3/R4 sözleşmesidir](../development-engine/automations/r3-r4-review.md).

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
- Auth/recovery sınırı kapatılırken yalnız raw table grant'larına bakmak yeterli değildir. Aynı korunan veriyi döndüren doğrudan `GRANT EXECUTE` verilmiş `SECURITY DEFINER` RPC/function yüzeyleri, view'lar ve diğer Data API yolları da capability envanterine dahil edilir. Bir tablo `SELECT` revoke'u, aynı PII'yi döndüren executable RPC açık kalıyorsa authority kapanışı sayılmaz; fail-closed standart-session sınırı yüzey bazında kanıtlanır.
- Bu örnekler yalnız ilgili risk varsa zorunludur; reversible bir UI değişikliği için gereksiz DB/concurrency/staging töreni kurulmaz.
- Uygulama ayrıntısını aynalayan veya yalnız mock'u doğrulayan test kabul kanıtı değildir.
- Aynı hipotez 2–3 kez başarısız olursa yeni rastgele varyasyon deneme. Hipotezi, komutları, çıktıyı ve değişen dosyaları kaydet; koordinatör incelemesinden sonra devam et.
- Somut yeni risk, kod değişimi veya gerekli merge sonucu yoksa tam suite'i tekrarlama. Mevcut CI kapıları ancak S06 kapsamında ayrı, incelenmiş bir kod değişikliğiyle değişir.
- Yalnız doküman PR'ında yerel linkler, görev bağımlılıkları, durum ifadeleri ve diff kontrol edilir. Repo politikası CI gerektiriyorsa mevcut kapı ayrıca çalıştırılır.
- Bir carry-forward/boundary metni kısaltılırken **pozitif garanti, negatif sınır, exact risk alanı/kolonu ve exact hedef kart** kaybolamaz. Bunlardan biri düşüyorsa “concise” değişiklik kabul edilmez. Head'e bağlı repo gözlemi taşınıyorsa doğrulandığı head SHA'sı da metinde kalır ve kart açılırken current main'de yeniden doğrulanır.
- Bir real-browser runner birden fazla davranış senaryosunu kapsıyorsa failure çıktısı insan-okunur stabil senaryo adı taşımalıdır; yalnız dosya/satır/assert mesajına dayanmak yeterli kabul kanıtı değildir.

## Devredilebilir kanıt

Devir, yalnız bir önceki sohbeti bilen kişinin değil, yeni bir oturumun doğrudan devam edebileceği ayrıntıyı taşır. En az şu alanlar bulunur: görev; validation budget; base SHA; branch; head commit ve PR; değişen dosyalar; kontratlar; okunan beceri; test kanıtı; başarısız/atlanmış kontrol; engel; sonraki tek somut adım. Geçici talimat, sahiplik veya kritik karar yalnız sohbet içinde bırakılamaz.