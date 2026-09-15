# MKT-01 — production integration contract

Bu sözleşme MKT-01'in izole `src/marketing/**` uygulamasını production root'a bağlamadan önce kapanması gereken entegrasyon kararlarını tutar. Marketing track'i 54 MVP ürün/teknik görevinin dışındadır. Route/entry implementation shared-writer token açılmadan başlamaz.

## Validation budget

- İzole motion/layout/copy düzeltmeleri: **LIGHT**.
- Production route cutover, bundle ayrımı ve gerçek public/workspace entegrasyonu: **FOCUSED**.
- Auth authority, DB/access veya capability semantiği değişmiyorsa R1 gerekmez; cutover acceptance'ın ilgili bağımsız gate'i R2 browser/integration'dır.
- Staging varsayılan değildir. Yalnız deployed Cloudflare route veya gerçek media seeking/preload davranışı lokalde makul biçimde kanıtlanamıyorsa açılır.

## MKT-BUG-01 — scroll geometry layout-shift invalidation

`useVideoScrollScrub` içindeki `sectionTop`, yalnız window resize veya transformation section'ın kendi boyutu değişince güncellenemez. Section'ın üstündeki içerik font swap, görsel yüklenmesi, nav/layout değişimi gibi nedenlerle yükseklik değiştirirse section'ın kendi `ResizeObserver`'ı tetiklenmeden top offset değişebilir; scrub scroll pozisyonundan kayar.

### Zorunlu dar repair

- Transformation section'a ek olarak `document.body` layout değişimi de geometry invalidation kaynağıdır. Body `ResizeObserver` ile izlenir veya eşdeğer bounded global-layout invalidation kullanılır.
- Web font yerleşmesi için `document.fonts?.ready` tamamlandığında `updateGeometry()` + schedule çağrılır. API yoksa fail-safe no-op.
- Listener/observer cleanup effect teardown'da tamamdır; yeni sürekli polling veya scroll hijack eklenmez.
- Real-browser regression üst içerik yüksekliğini section'ın kendi boyutunu değiştirmeden kaydırır ve aynı scroll position için geometry'nin yeniden hesaplandığını kanıtlar.
- Bu bug production route cutover'dan önce kapanır. İzole PR #77 içinde düzeltilebilir; shared entry gerektirmez.

### Test sınırı

Davranış zaten gerçek Chrome harness'iyle kanıtlanıyorsa implementation değişken adlarını/kaynak satır biçimini regex'le kilitleyen ikinci bir test yazılmaz. `geometryFrame`, `scheduleGeometry` gibi identifier'ların adı sözleşme değildir. Kaynak-metni testi yalnız bilinen tehlikeli API'nin geri gelmesini dar biçimde engelliyorsa meşrudur; örneğin normal promotion yolunda explicit `video.load()` veya autoplay `video.play()` çağrısının bulunmaması. Geometry invalidation, cleanup ve scroll sonucu gerçek browser davranışıyla kabul edilir.

## MKT-ARCH-02 — root cutover bir URL migration'dır

Marketing'i `/` adresine koymak yalnız yeni bir sayfa eklemek değildir. Bugünkü operator workspace root'u `/` adresinden `/app` altına taşınır. E'nin router/common-shell contract'ı (Issue #65 `5666148046`) route authority'dir.

İlk cutover aynı atomik değişimde şunları korur:

- pending team invite + `/` → `InvitePage`,
- normal `/` → `MarketingHome`,
- `/app` ve `/app/*` → private workspace,
- `/r/:slug` public booking ve `/m` capability yüzeyleri marketing/workspace shell'e alınmaz,
- mevcut operator root-return linkleri `/app` olur,
- auth/recovery callback UI destination `/app?auth=...` ile uyumlanır,
- legacy operator URL'ler compatibility penceresinde çalışır,
- bilinmeyen yollar explicit NotFound davranışına ilerler.

Production cutover #76/shared-entry writer kapanmadan uygulanmaz.

## MKT-ARCH-03 — code splitting route entegrasyonundan önce

Current `src/main.tsx` pathname seçimi tek uygulama entry/bundle modelidir. Marketing aynı eager graph'a eklenirse scrub hook, marketing CSS ve media orchestration kodu `/r/:slug` müşterisine veya private workspace'e gereksiz taşınabilir. Bu nedenle code-splitting kararı route bağlantısından **önce** verilir.

### Minimum chunk sözleşmesi

Production candidate'ta route-level lazy boundary veya eşdeğer Vite dynamic-import ayrımı bulunur:

- normal `/` marketing chunk'ını yükleyebilir,
- `/r/*` initial load için marketing'e özgü JS/CSS/transformation-media eager transferi **0 B** olmalıdır,
- `/app/*` initial load için marketing'e özgü JS/CSS/transformation-media eager transferi **0 B** olmalıdır,
- marketing `/` initial load private workspace implementation chunk'ını yalnız route gerektiriyorsa yükler; private operator ekranlarının tamamı marketing entry'ye eager bağlanmaz,
- bundle analyzer/build manifest veya network acceptance hangi route'un hangi chunk'ları çektiğini sayısal receipt olarak bırakır.

Shared route cutover, bu ayrımın tasarımı ve test yolu belli olmadan `src/main.tsx` içine MarketingHome import ederek yapılmaz.

## MKT-CSS-04 — token ve layer sınırı

MKT-01 bugün sayfa-özel CSS'i birden fazla dosyada taşır. `marketing-polish.css` ve `marketing-overrides.css` isimleri kalıcı specificity yaması zincirine dönüşmemelidir.

### Karar

Marketing ile ürün **temel brand tokenlarını paylaşır, component/layout kurallarını paylaşmak zorunda değildir**.

Paylaşılan katman:
- marka rengi/adı gibi semantik foundation tokenları,
- ortak font kararı kesinleştiğinde font-family/token,
- focus/erişilebilirlik gibi ürün-geneli invariantlar gerektiği ölçüde.

Marketing'e özel kalan katman:
- hero/story/scrollytelling layout,
- transformation renderer stage,
- marketing-only CTA/proof/FAQ bileşenleri,
- page-specific responsive tuning.

Production cutover öncesi CSS import sırası açık ve deterministik hale getirilir. Yeni bir `override` dosyası eklemek yerine mevcut selector'ın sahibi olan katmanda düzeltme tercih edilir. Mevcut `marketing-overrides.css` / `marketing-polish.css` zorunlu büyük refactor blocker'ı değildir; ancak cutover candidate'ta hangi kuralların kalıcı layer'a taşınacağı kısa bir cleanup pass ile belgelenir. Marketing için ikinci bağımsız ürün design-system'i türetilmez.

## MKT-PERF-05 — media ve ilk yük bütçesi

Bütçe mevcut asset handoff'una göre sayısallaştırılır; asset büyümesi sessiz kabul edilmez.

### Route isolation budgets

- `/r/*` initial load'da marketing-specific JS/CSS/transformation-media eager transfer: **0 B**.
- `/app/*` initial load'da marketing-specific JS/CSS/transformation-media eager transfer: **0 B**.
- Marketing `/` ilk viewport'ta transformation section prefetch/promotion eşiğine girmeden transfer edilen full transformation media body byte'ı: **0 B**. Video `preload="metadata"` için küçük metadata/range isteği ayrıca raporlanabilir; frame renderer seçilirse aynı ilke frame fetch'leri için geçerlidir.

### Transformation asset caps / comparison targets

Video kontrol kolu:
- mobile MP4: **≤ 2.2 MB**,
- desktop MP4: **≤ 5.0 MB**.

Frame-sequence deney kolu için başlangıç comparison target'ı production cap değildir:
- mobile toplam compressed WebP sequence tercihen **≤ 2.75 MB**,
- desktop toplam compressed WebP sequence tercihen **≤ 6.25 MB**.

Mevcut yaklaşık 2.0 MB mobile ve 4.5 MB desktop MP4 encode video cap içinde kalır. Frame sequence byte hedefi, seek/continuity güvenilirliğinde belirgin kazanç varsa küçük ek transferi değerlendirebilmek için karşılaştırma eşiğidir; gerçek production cap renderer seçimiyle birlikte netleşir.

### Preload / prefetch policy

- video kontrol kolu başlangıçta `preload="metadata"`; near-section promotion `preload="auto"` hint'i verebilir fakat explicit `video.load()` ile media element resetlenmez,
- frame-sequence kolu near-section'a kadar frame fetch başlatmaz; fetch concurrency bounded, decoded cache bounded ve eviction kaynakları kapatır,
- reduced-motion modunda scrub renderer media fetch'i yapılmaz,
- renderer failure static fallback'e döner.

Production browser acceptance en az bir mobile ve bir desktop profile'da network waterfall ile asset seçimini ve promotion/prefetch zamanını doğrular.

### Renderer karar kapısı

1. **Önce adil video baseline.** Explicit `video.load()` resetinin kaldırılmış haliyle gerçek Chrome'da scroll continuity, request/range davranışı, section-entry → usable frame süresi ve fallback gözlenir. Geometry body/font invalidation repair'i bu baseline'ın parçasıdır.
2. **Production renderer seçilmeden önce gerçek telefon + hücresel ağ kabulü zorunludur.** Final/canonical media binary ve deployed Cloudflare delivery üzerinde en az bir gerçek iOS veya Android telefon hücresel bağlantıda denenir. Kullanıcı transformation bölümüne normal ve hızlı ileri/geri scroll ile girer; visible stall, parçalı yükleme, uzun metadata bekleme, yanlış kare/phase veya fallback gözlemi receipt'e yazılır. Bu test geçerse sırf teori uğruna Blob/ObjectURL mimarisi eklenmez.
3. **WebP/canvas frame sequence eşit adaydır, son çare değildir.** PR #77 deneyinde aynı 121 frame / 5.041667 s timeline, mobile/desktop ayrı sequence, tek canvas, bounded fetch concurrency ve küçük decoded LRU cache kullanılır. `createImageBitmap` varsa kullanılır; eviction/dispose kaynakları kapatır. DOM'a 121 `<img>` dizilmez.
4. Video ve frame renderer aynı 18/45/72/92% checkpoint'leri, reverse scrub ve aynı story phase sonucunu vermelidir. Karşılaştırma en az compressed byte, request count, near-section → first drawable süre, hızlı ileri/geri scrub stale/missing frame veya stall metriği ve decoded cache peak'i raporlar.
5. **Blob/ObjectURL artık zorunlu ara basamak değildir.** Gerçek telefon/hücresel video baseline başarısızsa ve frame sequence belirgin şekilde kazanıyorsa doğrudan frame renderer seçilebilir. Frame sonucu da zayıfsa veya video yalnız network heuristiği nedeniyle kaybediyorsa Blob/ObjectURL ayrı ölçümlü deney olarak açılabilir.
6. Production seçim kuralı: kullanıcı hissi/continuity eşitse daha basit ve daha az makine içeren renderer tercih edilir. Video gerçek telefonda sorunsuzsa ve frame sequence materyal avantaj göstermiyorsa çalışan video korunur. Frame sequence continuity/seeking reliability'de belirgin kazanır ve byte/memory maliyeti makulse canvas renderer production adayı olur.

Amaç belirli bir teknolojiyi kazanmış ilan etmek değil, scroll-owned görsel davranışını gerçek cihazda deterministik ve ölçülebilir hale getirmektir.

## MKT-PROOF-06 — production claim gate

F10-05 kodu main'de bulunsa bile acceptance/repair açıkken `customerMemory` production proof gate'i `false` kalır. PR #87 kabul+merge edilmeden marketing müşteri hafızasını canlı feature kanıtı gibi yayınlamaz. Reminder, pricing, pilot proof ve contact-flow gate'leri kendi ürün/ticari kapıları açılana kadar fail-closed kalır.

## Production cutover acceptance

Cutover adayı için minimum kanıt:

1. pending invite root precedence,
2. `/` marketing, `/app` workspace ve `/r/*` public route ayrımı,
3. auth/recovery callback'in `/app` üzerinde tüketilmesi,
4. marketing-specific eager bytes `/r/*` ve `/app/*` için 0 B,
5. full transformation media first viewport'ta eager indirilmez,
6. seçilen renderer'ın mobile/desktop transfer + memory bütçeleri raporlanır ve onaylı cap'i geçmez,
7. sectionTop layout-shift real-browser regression geçer,
8. 360/390 no-overflow + keyboard/reduced-motion akışı,
9. final selected renderer gerçek telefon + hücresel ağda continuity kabulünü geçer,
10. CSS layer/token kararı uygulanmış veya açık cleanup receipt'i bırakılmıştır,
11. production proof gate'leri gerçek accepted feature durumuyla eşleşir.

Bu sözleşme production route'u kendi başına açmaz. Shared-entry token ve current dependency queue Issue #65 tarafından yönetilir.

## Fazlar arası bağlantı

Public-route ilk-yük/code-split sınırı F12-05'e, router/common-shell zamanlaması F13-04/F14-01'e ve nihai route/bundle ölçümü F17-03'e taşınmıştır. Bu kontrat marketing'e özel ayrıntıyı tutar; faz kartları production ürün yüzeyinin kendi sorumluluğunu ayrıca taşır.
