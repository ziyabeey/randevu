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

### Review lineage

Bu bölüm review modu, receipt freshness ve takip kapsamının **tek protokol sahibidir**;
Skills rolün risk/kanıt ayrıntılarını ekler. TASKS canlı otorite, PR receipt'leri
candidate-bound kanıt olarak kalır. Yeni tracker, JSON receipt veya her push'ta yeni
Context Pack zorunluluğu yoktur; mevcut PR brief'ine kaynak linkleri yeterlidir.

**Önce kimlik:** aynı görev/PR ve aynı rolün önceki durable receipt'i, reviewed
exact SHA, current head/base, onaylı repair delta ve frozen blocker setini bağla.
R0 discovery/freeze referansı zincir boyunca korunur. Önceki receipt yokluğu gerçekten
doğrulanmış olmalıdır; erişilemeyen receipt `NONE` değildir. Git ancestry kontrolü
ve diff kullan; shallow history eksikliği veya aynı branch adı lineage kanıtı değildir.
Head aynıysa yeni discovery yoktur; eksik kanıt veya kapanış kontrolünden devam edilir.

**R0: DISCOVERY → FREEZE → REPAIR → VERIFICATION → CLOSURE.**
İlk inceleme changed surface + en fazla bir direct dependency hop'tur.
Tamamlanmış discovery, PR review/comment üzerinde exact reviewed head ve frozen
ID'ler veya açık `NONE` taşır. Local draft freeze değildir. Repair descendant'ı
VERIFICATION'dır; önce authored delta'nın onaylı writable/counterexample sınırını,
sonra blocker kapanışını, doğrudan repair regression'ını ve ilgili kanıtı incele.
Normal invariant `next_blockers ⊆ frozen_blockers`; CLOSURE yalnız bu R0 turunda
açık blocker/kanıt boşluğu kalmadığıdır, acceptance veya merge izni değildir.
Tek yazar mevcut branch'te onaylı repair yapar; new-task Qwen route'u repair değildir.

**Blocker kimliği:** kimlik `(PR, rol, discovery receipt, ID)` içindedir; global
numaralama veya tüm geçmişte arama gerekmez. R0 `R0-B1…` kullanır; mevcut canonical
ID'leri yeniden numaralama. Aynı invariant/counterexample başka ifadeyle dönerse
aynı ID altında kanıt ekle. Her frozen ID için current head üzerinde
`CLOSED | OPEN | UNVERIFIED` ve kanıt referansı ver; eski CLOSED receipt'i yeni
head'i kendiliğinden kapatmaz. Kapanmış kusur gerçekten yeniden oluşursa aynı ID
ile önceki closure'a ve yeni counterexample'a bağla; sessiz reopening yapma.
Eksik test `UNVERIFIED`/kanıt boşluğudur, yeni semantic blocker değildir.
`NONE` bilinen boş kümedir; bilinmeyen küme değildir ve sonraki push discovery açmaz.

**Escape sınırı:** VERIFICATION'da yalnız somut secret/credential exposure,
auth privilege escalation, cross-tenant breach, destructive data loss/migration
corruption, financial double-effect veya mevcut hard safety invariant ihlali
yeni `ESCAPE-BLOCKER` ekleyebilir. Yeni ID, exact-head kanıt ve ihlal edilen mevcut
invariant gerekir; coordinator repair scope'unu günceller. Non-critical yeni R0
gözlemleri `DEFERRED`, nit/öneriler non-blocking kalır. Bu istisna yeni kalite
kriteri üretmez. Scope ihlali, ID çoğaltmak yerine koordinatöre dönen scope conflict'tir.

**R1/R2:** aynı rolün takip turu kapanış/delta odaklıdır; R0 receipt'i ilk bağımsız
R1/R2 incelemesini takip turuna dönüştürmez. Fresh independent context, risk-based
atama ve bütün gerekli kabul yükümlülükleri korunur. R0'ın dar kapsamı R1/R2'nin
karşılanmamış zorunlu kanıtını kapatamaz. Yeni semantic değişiklik etkilenen kabulü
sıfırlar, fakat R0 frozen geçmişini silmez. Full review yalnız gerekli risk/kapsam
için koordinatörce atanır, her head değişiminde otomatik yapılmaz.

**Kanıt kimliği:** starting main, current base, raw head, semantic SHA, gerçekten
test edilen checkout/merge-ref ve run/job/attempt ayrı anlamlardır. Semantic SHA
tek başına eşdeğerlik kanıtı değildir. CI source head doğru olsa bile eski base
üzerindeki merge-ref current integration kanıtı değildir. Browser kanıtında served
build, DB kanıtında migration chain kimliği ilgili artifact'te kalır; tüm rollere
yeni alan eklenmez. Post-main CI yalnız actual merge SHA'ya aittir. `unknown`,
başarısız veya atlanmış kanıt PASS/NONE/false'a dönüştürülmez.

#### Routing tablosu

Tablo üst üste uygulanır: provenance/scope conflict ve değişmiş live head önce
çözülür; sonra kanıt boşluğu değerlendirilir. Bütün reviewer modları read-only'dir.
Yazma yalnız atanmış implementerin güncel approved writable scope'undadır; tablo
izin üretmez. Eski receipt'ler silinmez, ancak yeni head için current sayılmaz.

| Durum | Mod / yeniden kullanılabilir bağlam | İnceleme, gerekli kanıt ve sonraki coordinator adımı |
| --- | --- | --- |
| 1. İlk semantic candidate, aynı rolde receipt yok | R0 DISCOVERY; gerekli R1/R2 ilk bağımsız inceleme | Atanmış changed/risk scope + current required CI/proof; R0 durable freeze, ardından yalnız gerekli bağımsız kabul. |
| 2. Frozen blocker sonrası repair üretimi | Implementer REPAIR; frozen ID/kontrat korunur | Approved delta içinde counterexample repair/test; yeni head CI. Pending CI sırasında write freeze review açmaz. |
| 3. Descendant repair head | R0 VERIFICATION; R1/R2 atanmış kapanış/delta | Authored scope, her frozen ID, direct regression ve current kanıt; açık ID → repair, boşluk → kanıtı tamamla, kapanış → kalan bağımsız kapı. |
| 4. Upstream-main sync, authored delta aynı | VERIFICATION; eski authored bulgular bağlamdır | Merge parent/base SHA'ları ve canonical main'den değişmeden miras kalan yollar kanıtlanırsa inherited yollar authored scope dışında; integration etkisi yine incelenir ve fresh CI gerekir. Conflict resolution otomatik inherited sayılmaz. |
| 5. Yalnız docs/metadata descendant | Delta confirmation adayı; exact receipt stale, semantic bağlam reusable | İçerik diff'iyle semantic etkisizlik doğrulanır (dosya uzantısı yetmez); fresh CI + coordinator-required delta confirmation, otomatik full reset yok. |
| 6. Kabulden sonra semantic değişiklik | Etkilenen R1/R2 kabulü stale; R0 lineage devam eder | Değişen invariant/risk için fresh kanıt ve bağımsız review; koordinatör affected scope'u atar, eski acceptance taşınmaz. |
| 7. Receipt başka/non-descendant lineage veya ancestry bilinmiyor | PROVENANCE CONFLICT; reuse/discovery yok | INCOMPLETE dön; coordinator ancestry/eşdeğer authored-delta mapping'ini kanıtlar veya açık fresh discovery/freeze atar. Rebase/aynı patch-id kendiliğinden reuse yetkisi değildir. |
| 8. Required kanıt eksik/failed/unavailable | Review tamamlanamaz; freeze geçmişi korunur | INCOMPLETE + exact gap; deterministic required failure bypass edilmez. Coordinator kanıt/repair atar; stronger obligation yalnız gerekçeli `narrows`/`supersedes` ile değişir. |
| 9. Discovery `NONE` | Tamamlanmış freeze; descendant VERIFICATION | Yalnız approved delta/regression/kanıt; hayali blocker veya yeni discovery turu üretme. |
| 10. Yeni kritik ihlal | VERIFICATION + ESCAPE-BLOCKER | Mevcut hard invariant + exact counterexample; coordinator bounded repair atar. Non-critical gözlem current acceptance'a eklenmez. |
| 11. İki yazar aynı shared critical alanı ister | Scope conflict; review modundan bağımsız dur | TASKS + aktif #65 claim + açık PR writable scope karşılaştırılır. Overlap veya belirsizlikte yazma; coordinator tek writer/merge sırası ya da izole scope verir. Dependency veya eski token sahipliği izin değildir. |
| 12. CI merge-ref raw head'den farklı | Tek başına staleness değildir | Run/job/attempt, source head, tested checkout ve testteki base bağını doğrula; raw SHA'yı merge SHA ile değiştirme. Binding eksikse kanıt boşluğu. |
| 13. Historical green kanıt | Kontrat/counterexample bağlamı; current proof değil | Current obligation'a bağlı kanıt getir veya coordinator'ın açık delta kararını bağla; geçmiş PASS yeni head'e kopyalanmaz. |
| 14. Review sırasında head değişti | Head-specific sonuç stale, yayınlanacak current verdict yok | INCOMPLETE; eski gözlemi SHA'sıyla koru, yeni head için assignment refresh iste. Otomatik rediscovery/recompute döngüsü başlatma. |

Base/main değişip raw head aynı kaldığında da 4/12 uygulanır: authored review sırf
base hareket etti diye sıfırlanmaz, integration kanıtı yenilenir. Unknown semantic
impact coordinator değerlendirmesini bekler; docs-only olarak tahmin edilmez.

#### Brief ve karar-öncelikli receipt

Mevcut PR brief'inde önceki same-role receipt/SHA, current head/base, approved
delta/scope kaynağı, frozen ID/NONE ve ID → closure evidence bağları bulunur.
Bunlar linkle taşınabilir; ayrı form/manifest üretme. R0 freeze ile en son takip
receipt'i farklıysa ikisini de bağla. Kanıt boşlukları ve tek next action aşağıdaki
çıktıda yer alır; brief ve sonuçta aynı envanteri tekrar etme.

```text
VERDICT: R0 = FINDINGS | NO FINDINGS | INCOMPLETE; R1/R2 = ACCEPTABLE | BLOCKER | INCOMPLETE
BLOCKERS: açık frozen ID'ler / ESCAPE-BLOCKER; yoksa NONE, bilinmiyorsa UNKNOWN
EVIDENCE GAPS: eksik/failed/skipped kanıt veya provenance/scope conflict; yoksa NONE
REVIEWED SHA: gerçekten incelenen exact head (değiştiyse STALE ve gözlenen yeni head)
NEXT ACTION: coordinator için tek somut adım
```

Sonra rol/PR/brief referansı, ID bazında closure, delta/regression sonucu ve
rol-specific kanıt verilir. Hem confirmed defect hem gap varsa ikisini de göster;
R0 FINDINGS/R1-R2 BLOCKER kusuru görünür tutar ama eksik kanıtı kapatmaz. Head
değişimi/provenance conflict'te INCOMPLETE önceliklidir. Başta ve yayınlamadan önce
live head/base kontrol edilir. Hiçbir sonuç APPROVE, self-ready veya merge yetkisi değildir.

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