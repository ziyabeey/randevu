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
- near-section IntersectionObserver promotion mevcut `75%` rootMargin ile başlar; daha erken promotion yalnız ölçümle gerekçelendirilir,
- reduced-motion modunda scrub video mount edilmez,
- video failure static fallback'e döner.

Production browser acceptance en az bir mobile ve bir desktop profile'da network waterfall ile asset seçimini ve promotion zamanını doğrular.

### Scrub yükleme optimizasyon merdiveni

Bu bölüm performans **öneri sırasıdır**. Ölçüm olmadan daha karmaşık tekniğe atlanmaz.

#### 1. Explicit `video.load()` resetini kaldır

Current PR #77 hook'unda near-section promotion sırasında `video.preload = "auto"` sonrasında explicit `video.load()` çağrısı vardır. Promotion yalnız `preload` ipucunu değiştirir; normal scroll sırasında explicit `load()` ile media element resetlenmez.

Kabul:
- preload promotion sırasında `video.load()` çağrısı yoktur,
- daha önce alınmış metadata/buffer'ın gereksiz resetlenmediği gerçek Chrome network/media davranışıyla doğrulanır,
- metadata guard yüzünden section girişinde scrub'ın yapay olarak tekrar beklemeye dönmediği kontrol edilir.

Bu değişiklik küçük ve izole olduğundan MKT-01 branch'inde route cutover beklemeden yapılabilir.

#### 2. Doğrudan media loading hâlâ scrub stall üretiyorsa Blob-prefetch deneyini ölç

Paused `<video>` üzerinde `preload="auto"` tarayıcı için ipucudur; browser/network koşullarında bütün dosyanın ileri buffer'lanacağı garanti değildir. Hızlı seek ayrıca birden çok HTTP Range isteği üretebilir. `video.load()` kaldırıldıktan sonra throttled gerçek-browser testinde anlamlı stall devam ederse ikinci aday, seçilmiş MP4 kaynağını uygulamanın `fetch` ile indirip `Blob` / `URL.createObjectURL(...)` üzerinden video elementine vermesidir.

Blob deneyi için sınırlar:
- mobile/desktop doğru source viewport'a göre **fetch başlamadan önce** seçilir; iki encode aynı anda indirilmez,
- fetch yalnız transformation prefetch eşiğine girildiğinde başlar; first-viewport MP4 body budget'ı korunur,
- `AbortController` ile unmount/navigation iptali yapılır,
- object URL cleanup'ta `URL.revokeObjectURL` çağrılır,
- fetch/non-2xx/abort dışı decode hatası mevcut static fallback yoluna bağlanır,
- reduced-motion modunda MP4 fetch edilmez,
- Blob hazır olmadan poster/static fallback kullanıcıyı boş stage ile bırakmaz,
- aynı asset için hem doğrudan `<source>` download hem fetch download oluşmaması gerekir,
- `blobReady` ve media metadata readiness ayrı state olarak gözlenebilir/test edilebilir kalır.

Blob yaklaşımı production zorunluluğu değildir. Şu ölçümlerde doğrudan `<video>` yüklemeye göre net kazanım gösterirse kabul edilir:
- section-entry → usable scrub hazır olma süresi,
- scroll sırasında stall/frame miss gözlemi,
- MP4 request/range request sayısı,
- toplam transferred bytes,
- JS heap / media memory davranışı,
- Chrome + en az bir Safari/iOS-representative profile davranışı.

Mevcut yaklaşık 2.0 MB mobile / 4.5 MB desktop boyutları Blob deneyi için makul adaydır; bu tek başına çözüm kararı değildir.

#### 3. Cloudflare static media delivery kontrolü

Production/staging acceptance sırasında MP4 cevaplarında en az şunlar kaydedilir:
- `Cache-Control` / edge cache davranışı,
- `Accept-Ranges` ve gerçek Range response davranışı,
- Range isteklerinin edge'den servis edilip edilmediği,
- beklenmedik origin round-trip veya cache bypass olup olmadığı.

Sorun asset delivery/header tarafındaysa önce o katman düzeltilir; playback mimarisi gereksiz yere karmaşıklaştırılmaz.

#### 4. Daha erken prefetch yalnız ölçümle

Blob veya direct-media deneyi section'a geç hazır oluyorsa `rootMargin` örneğin `150%` seviyesine çıkarılabilir. Bu bir varsayılan değildir. Değişiklik:
- first-viewport eager MP4 body bütçesini bozmamalı,
- mobile data cost'u gereksiz öne çekmemeli,
- old/new margin için section-ready timing ve transferred-byte receipt bırakmalıdır.

#### 5. Image-sequence / canvas son seçenek

Blob-prefetch ve doğru edge delivery'ye rağmen özellikle iOS seek davranışı kabul edilemez kalıyorsa transformation video WebP/AVIF frame sequence + canvas/image renderer olarak değerlendirilebilir. Bu yol codec seek'i ortadan kaldırır fakat çok sayıda asset/request, decode memory ve daha karmaşık preload/cache makinesi getirir. MKT-01 için ilk çözüm değildir; ayrı ölçümlü teknik karar ister.

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
8. preload promotion sırasında explicit `video.load()` reseti yoktur,
9. scrub stall sürerse direct-media → Blob deneyi ölçüm receipt'i vardır; Blob zorunlu değilse neden gerekmediği kaydedilir,
10. deployed media response/cache/range davranışı final hosted acceptance'ta ölçülür,
11. 360/390 no-overflow + keyboard/reduced-motion akışı,
12. CSS layer/token kararı uygulanmış veya açık cleanup receipt'i bırakılmıştır,
13. production proof gate'leri gerçek accepted feature durumuyla eşleşir.

Bu sözleşme production route'u kendi başına açmaz. Shared-entry token ve current dependency queue Issue #65 tarafından yönetilir.
