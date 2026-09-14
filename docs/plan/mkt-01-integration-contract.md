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
- `/r/*` initial load için marketing'e özgü JS/CSS/video eager transferi **0 B** olmalıdır,
- `/app/*` initial load için marketing'e özgü JS/CSS/video eager transferi **0 B** olmalıdır,
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
- transformation/video stage,
- marketing-only CTA/proof/FAQ bileşenleri,
- page-specific responsive tuning.

Production cutover öncesi CSS import sırası açık ve deterministik hale getirilir. Yeni bir `override` dosyası eklemek yerine mevcut selector'ın sahibi olan katmanda düzeltme tercih edilir. Mevcut `marketing-overrides.css` / `marketing-polish.css` zorunlu büyük refactor blocker'ı değildir; ancak cutover candidate'ta hangi kuralların kalıcı layer'a taşınacağı kısa bir cleanup pass ile belgelenir. Marketing için ikinci bağımsız ürün design-system'i türetilmez.

## MKT-PERF-05 — media ve ilk yük bütçesi

Bütçe mevcut asset handoff'una göre sayısallaştırılır; asset büyümesi sessiz kabul edilmez.

### Route isolation budgets

- `/r/*` initial load'da marketing-specific JS/CSS/video eager transfer: **0 B**.
- `/app/*` initial load'da marketing-specific JS/CSS/video eager transfer: **0 B**.
- Marketing `/` ilk viewport'ta, transformation section preload promotion eşiğine girmeden transfer edilen transformation MP4 body byte'ı: **0 B**. `preload="metadata"` tarayıcı davranışının küçük metadata/range isteği ayrıca raporlanabilir; tam video gövdesi eager indirilmez.

### Transformation asset caps

- mobile MP4: **≤ 2.2 MB**,
- desktop MP4: **≤ 5.0 MB**.

Mevcut yaklaşık 2.0 MB mobile ve 4.5 MB desktop encode bu cap içinde kalır. Cap artırımı ancak görüntü kalitesi/seek güvenilirliği gibi ölçülmüş gerekçeyle contract güncellemesi olarak yapılır.

### Preload policy

- video başlangıçta `preload="metadata"`,
- near-section IntersectionObserver promotion mevcut `75%` rootMargin üst sınırını aşmaz; değişiklik gerekçelendirilir,
- reduced-motion modunda scrub video mount edilmez,
- video failure static fallback'e döner.

Production browser acceptance en az bir mobile ve bir desktop profile'da network waterfall ile asset seçimini ve promotion zamanını doğrular.

### Scrub media-loading optimizasyon merdiveni

1. **Önce explicit `video.load()` resetini kaldır ve yeniden ölç.** `preload="metadata"` ile zaten başlamış yükü promotion anında `load()` ile yeniden başlatmak buffer/metadata state'ini sıfırlayabilir; mevcut hook'ta `video.preload = "auto"` sonrası explicit `video.load()` kullanılmaz. `preload` hint'i tek başına denenir ve throttled real-browser waterfall + scrub continuity ölçülür.
2. Sorun devam ederse **Blob/ObjectURL prefetch** deney edilir: seçilmiş tek mobile/desktop MP4 `fetch` + `AbortController` ile indirilir, `Blob` URL video source olur, teardown'da `URL.revokeObjectURL` çağrılır. Reduced-motion modunda MP4 fetch edilmez; fetch/decode failure mevcut static fallback'e gider. Bu adım ancak ilk adımın ölçümü yetersizse uygulanır.
3. Aynı candidate'ta Cloudflare static asset cevabının `Cache-Control`, `Accept-Ranges`, Range response ve edge-cache davranışı network receipt ile kaydedilir; çoklu seek'in origin'e gereksiz gitmediği doğrulanır.
4. Blob deneyi fayda sağlıyor ama section'a geç kalıyorsa IntersectionObserver prefetch eşiği ölçümlü biçimde genişletilebilir. `75% → 150%` peşinen kural değildir; önce/sonra bytes, ready-time ve mobile profile sonucu yazılır. First-viewport transformation body 0 B bütçesi korunur.
5. Blob yaklaşımıyla da kabul edilebilir scrub güvenilirliği sağlanamıyorsa image-sequence/canvas alternatifi değerlendirilir. Bu son çaredir; frame byte toplamı, request sayısı, decode memory ve iOS davranışı ayrıca bütçelenmeden uygulanmaz.

Blob-prefetch production zorunluluğu değildir. Amaç belirsiz network seek davranışını ölçülebilir/deterministik hale getirmektir; en küçük işe yarayan basamakta durulur.

## MKT-PROOF-06 — production claim gate

F10-05 kodu main'de bulunsa bile acceptance/repair açıkken `customerMemory` production proof gate'i `false` kalır. PR #87 kabul+merge edilmeden marketing müşteri hafızasını canlı feature kanıtı gibi yayınlamaz. Reminder, pricing, pilot proof ve contact-flow gate'leri kendi ürün/ticari kapıları açılana kadar fail-closed kalır.

## Production cutover acceptance

Cutover adayı için minimum kanıt:

1. pending invite root precedence,
2. `/` marketing, `/app` workspace ve `/r/*` public route ayrımı,
3. auth/recovery callback'in `/app` üzerinde tüketilmesi,
4. marketing-specific eager bytes `/r/*` ve `/app/*` için 0 B,
5. transformation full MP4 first viewport'ta eager indirilmez,
6. mobile/desktop MP4 cap'leri geçmez,
7. sectionTop layout-shift regression geçer,
8. 360/390 no-overflow + keyboard/reduced-motion akışı,
9. CSS layer/token kararı uygulanmış veya açık cleanup receipt'i bırakılmıştır,
10. production proof gate'leri gerçek accepted feature durumuyla eşleşir.

Bu sözleşme production route'u kendi başına açmaz. Shared-entry token ve current dependency queue Issue #65 tarafından yönetilir.

## Fazlar arası bağlantı

Public-route ilk-yük/code-split sınırı F12-05'e, router/common-shell zamanlaması F13-04/F14-01'e ve nihai route/bundle ölçümü F17-03'e taşınmıştır. Bu kontrat marketing'e özel ayrıntıyı tutar; faz kartları production ürün yüzeyinin kendi sorumluluğunu ayrıca taşır.
