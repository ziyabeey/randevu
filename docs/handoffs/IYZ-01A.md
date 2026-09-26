# IYZ-01A: izole iyzico Sandbox Checkout Form ve HPP V3 adayı

## Context Pack ve yazım sınırı

26 Eylül 2026 kullanıcı yönü: diğer ajan MVP/yayın işlerini sürdürürken bu oturum iyzico'ya odaklanır. Bu aday, önceki konuşmanın `iyzico-isolated-package.zip` ekinden devralınmıştır; önceki 59 test bu oturumda yeniden çalıştırıldı. Sadece aşağıdaki beş yeni dosya yazılır; mevcut dosyalar değiştirilmez.

- `worker/iyzico-sandbox.ts`
- `worker/iyzico-sandbox-webhook.ts`
- `tests/iyzico-sandbox.test.mjs`
- `tests/iyzico-sandbox-webhook.test.mjs`
- `docs/handoffs/IYZ-01A.md`

Base main: `6ec6e4fd0aa31bfeedcb797ad56898390db6758e`.
Branch: `iyz-01a-sandbox-provider-candidate`.
Boyut / doğrulama: M / FOCUSED. İmza ve para sonucu yorumlama için bağımsız R1 gerekir; bu oturum implementer/coordinator kanıtıdır, bağımsız inceleme veya merge kabulü değildir.
Geçici claim: [Issue #65](https://github.com/ziyabeey/randevu/issues/65#issuecomment-5847899074).
Ürün bağlamı: [PR #637](https://github.com/ziyabeey/randevu/pull/637).

[TASKS](../../TASKS.md) tek canlı görev/main kabul otoritesidir. Aktif MVP yazarının ortak dosyalarına girmeme yönü nedeniyle bu aday TASKS'ı değiştirmez. **TASKS kaydı ve koordinatör dosya sahipliği uzlaştırılmadan bu draft aday merge edilmeyecek veya uygulamaya bağlanmayacaktır.** Bu devir ikinci canlı durum tablosu değildir. Kullanıcının yeni iyzico yönü mevcut F17/54 görev kabulünü geriye dönük değiştirmez.

Ortak router/auth/tickets, package/lockfile, workflow, migration, env/deploy/staging, DNS, #627/#635/#639 çalışma alanları yazım dışıdır. F17/G16 PR'ları devralınmaz. Terminal GitHub DNS erişimi yok; yayın için mevcut GitHub connector yazma araçları kullanılır. Diğer ajanın gönderilmemiş yerel dosyaları görülemez.

## Adayın dar davranışı

`createIyzicoSandboxClient(env, transport, options)` yalnız `initialize` ve `retrieve` sağlar. API origin sabit Sandbox'tır; canlı adres, global fetch fallback'i, process.env, log, import-time I/O veya yeni paket yoktur. Anahtar isimleri `IYZICO_SANDBOX_API_KEY` ve `IYZICO_SANDBOX_SECRET_KEY`; gerçek değerler okunmadı veya kullanılmadı.

Initialize, TRY/tek çekim/sanal hizmet satırları ve tam kuruş tutarları destekler. Sepet toplamı, sınırlı alanlar ve alıcı/fatura zorunlulukları kontrol edilir. İmzalanan exact JSON body gönderilir. Yanıt imzası ve beklenen conversationId doğrulanmadan URL döndürülmez; yalnız aynı token'lı sandbox checkout adresi kabul edilir. Kart numarası/CVC veya dönen HTML taşınmaz.

Retrieve için beklenen token, basket, conversation ve tutar, kalıcı ve işletme yetkisi doğrulanmış sunucu attempt kaydından gelmelidir; callback gövdesinden oluşturulamaz. Beklenenler ilk await öncesinde kopyalanır. Yanıtın imzası, kimlikleri, TRY, fiyat/ödenen tutar ve tek çekim bilgisi eşleşmelidir. API success ödeme success değildir; paymentStatus=SUCCESS ve fraudStatus=1 gerekir. Fraud=0 PENDING_REVIEW'dır. Dönen kanıt veri tabanına ödeme yazmaz.

Yanıt/istek boyutu ve zaman sınırı vardır. Redirect takip edilmez, hata metinleri ve kişisel veri yansıtılmaz. Otomatik retry yoktur; timeout veya belirsiz sağlayıcı sonucu UNCONFIRMED kalır. ConversationId sağlayıcı idempotency garantisi değildir.

## Bu devamda kapanan somut protokol hatası

**IYZ-A1: response fiyat imzası.** Önceki aday fiyatın string biçimini aynen HMAC girdisine koyuyordu. Resmi iyzico açıklaması ardıl sıfırların çıkarılmasını ister: `50.00 -> 50`, `10.50 -> 10.5`. Yeni `signaturePrice` yalnız exact-cents doğrulamasından sonra string üzerindeki ondalık ardıl sıfırları kaldırır; tutarı float ile yuvarlamaz. Request body fiyat biçimi ve request imzası değiştirilmedi.

Sağlayıcı kuralına uygun fixture ve açık canonical çiftleriyle önceki uygulama: **58 pass / 9 fail** (67 test, alt-test ve başarısız üst-test dahil). Onarım sonrası aynı testler **67 pass / 0 fail**. Normalize edilmemiş alternatif bir imza protokolü ayrıca kabul edilmez.

## Yeni HPP V3 doğrulaması

`verifyIyzicoSandboxNotification(env, signatureV3, rawBody, expected)` ağsız bir doğrulayıcıdır, HTTP endpoint değildir. Yalnız `CHECKOUT_FORM_AUTH` ve terminal SUCCESS/FAILURE olayları, sınırlı JSON gövdesi, V3 HMAC ve sunucudan beklenen token/conversation kabul edilir. Bilinen provider paymentId varsa ayrıca eşleşir. Güvenli tamsayı dışındaki numeric ID reddedilir; büyük ID ancak doğrulanabilir decimal string olabilir.

HPP V3 mesaj sırası: secretKey + eventType + iyziPaymentId + token + paymentConversationId + status. Response imzasındaki `:` ayırıcıları bu protokolde yoktur. V1/V2 fallback yoktur. Web Crypto verify kullanılır.

**Bildirim, ödeme kanıtı değil `retrieve_payment` sinyalidir.** FAILURE bile eski bir bildirim olabileceğinden kalıcı başarılı ödemeyi geri çevirmez. MerchantId, olay zamanı, referenceCode ve gövdeye eklenen tutar/işletme alanları HPP imzasında korunmadığı için kimlik, tekrar güvenliği veya mali gerçek olarak kullanılmaz; sonuçtan çıkarılır. Kalıcı replay/dedupe, HTTP body deadline/rate limit, queue acknowledgement ve ledger commit ayrı entegrasyon kabulüdür. Doğrulayıcı bunları varmış gibi sunmaz.

## Yerel kanıt

Node v22.16.0:

```bash
node --test --experimental-strip-types tests/iyzico-sandbox.test.mjs tests/iyzico-sandbox-webhook.test.mjs
```

**101 PASS / 0 FAIL / 0 SKIP**, alt-testler dahil; 34 üst-seviye test. Gerçek Web Crypto ve bağımsız Node HMAC kullanılır, transport ve bütün anahtar/kimlikler açıkça sahtedir. Global fetch guard ile dış istek sayısı 0'dır. Beklenti mutasyonu, eşzamanlı çağrılar, geçersiz kimlik/imza, ardıl sıfırlar, bilinmeyen fraud/payment durumları, yanlış checkout URL'si, timeout, gövde boyutu ve HPP alan sınırları test edilir. Tekrarlanan webhook testleri kalıcı tekrar güvenliği kanıtı değildir.

Yerel TypeScript 5.8.3:

```bash
tsc --noEmit --strict --noUnusedLocals --noUnusedParameters \
  --target ES2022 --lib ES2023,WebWorker --module ESNext \
  --moduleResolution Bundler worker/iyzico-sandbox.ts worker/iyzico-sandbox-webhook.ts
```

İzole iki modül typecheck geçti. Repo TypeScript 7.0.2 kontrolünün yerine geçmez. Tam checkout/npm ci, proje build/typecheck, PG, browser ve gerçek Sandbox bu ortamda çalıştırılmadı. Otomatik required CI sonucu canlı PR checks'ten okunmalı; bu dosya remote PASS iddia etmez. Gerçek secret, provider isteği, ödeme, iade veya deployment yapılmadı.

## Sonraki entegrasyon sınırı

Önce bu exact adayın required CI ve bağımsız R1 incelemesi; TASKS/sahiplik kaydı ve ortak dosya sırası. Sonra ayrı dilimde kalıcı tenant-bound payment attempt, yetkili başlatma, callback/HPP alımı, sunucudan Retrieve, webhook/retrieve paymentId eşleşmesi ve tek seferlik ledger commit'i. İyzico ödeme hesabının sahibi ile salon hizmetinin satıcısı aynı varsayılmaz; SaaS bedelimiz ve salon tahsilatı ayrımı provider modeliyle kesinleşmeden bütün salonları tek platform hesabından tahsilata bağlamak yoktur.

Online refund/cancel, reconciliation, kapora/taksit politikası ve gerçek Sandbox turu henüz teslim edilmedi. İade kaydını tutmak kart iadesi değildir. Gerçek Sandbox turunda mevcut secret'leri yetkili workflow/ortamda kullanmak gerekir; değerler PR/log/sohbete çıkarılmaz. Production geçişi ayrıca onay/kabul ister.

## Kaynaklar ve beceri

AGENTS, ilgili TASKS satırları ve önceki repo handoff'u okundu. Bu izole provider işi için listelenmiş özel iyzico becerisi yok; DB/browser becerisi kullanılmış sayılmaz. Resmi sağlayıcı arama metinleri ve önceki resmi SDK kaynakları esas alındı. Bazı doğrudan doküman fetch'leri text/markdown nedeniyle başarısızdı; gerçek Sandbox uyumluluğu bu sebeple de ölçülmüş kabul değildir.

- [Response signature ve ardıl sıfırlar](https://docs.iyzico.com/en/advanced/response-signature-validation)
- [CF retrieve](https://docs.iyzico.com/en/payment-methods/checkoutform/cf-implementation/cf-retrieve)
- [HPP V3 webhook](https://docs.iyzico.com/ek-servisler/webhook)
- [Resmi Node SDK request imzası](https://github.com/iyzico/iyzipay-node/blob/master/lib/utils.js)
