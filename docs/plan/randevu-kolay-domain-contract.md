# Randevu Kolay — domain, marka ve origin sözleşmesi

**Karar tarihi:** 15 Eylül 2026  
**Durum:** Bağlayıcı ürün/mimari yönü. Runtime cutover ayrı tasklarla yapılır.

Bu belge Randevu ürününün dış marka ve internet origin sınırını netleştirir. Amaç `kepenk.ai` alanını Randevu'nun müşteri-facing yüzeyleriyle doldurmadan, Randevu Kolay'ı kendi domain evreninde büyütmektir.

## 1. Marka ve domain rolleri

| Yüzey | Canonical hedef | Rol |
| --- | --- | --- |
| Kepenk.ai | `kepenk.ai` | Üst SaaS/platform alanı; Randevu Kolay müşteri-facing yüzeyi değildir |
| Private işletme uygulaması | `randevu.kepenk.ai` | Tek canonical authenticated operator origin; masaüstü panel + KolayApp |
| Marketing | `randevukolay.net` | Randevu Kolay satış/ürün/SEO sitesi |
| Public işletme/salon | `{business-slug}.randevukolay.net` | Müşterinin gördüğü salon profili, hizmet, müsaitlik, booking ve ilgili public akışlar |
| Transactional customer-facing domain | `*.randevukolay.net` altında | Bildirim/mail/public yardımcı originler gerektiğinde burada yaşar; Kepenk.ai altında yeni customer-facing Randevu subdomain’i açılmaz |
| Yüksek paket custom domain | doğrulanmış işletme domaini | Gelecekte customer-facing public surface entitlement; private app domaini değildir |

Dışarıdan görülen ürün markası **Randevu Kolay**'dır. `Kepenk.ai` parent/platform markasıdır; gerektiğinde ikincil attribution olabilir ancak salon müşterisinin canonical booking adresi veya marketing markası değildir.

## 2. Private app sınırı

`randevu.kepenk.ai` Randevu Kolay'ın tek canonical private app origin'idir.

- Masaüstü işletme paneli ve **KolayApp** aynı authenticated session/Membership/business context'ini kullanır.
- `app.randevukolay.net`, `panel.randevukolay.net` gibi ikinci private app originleri oluşturulmaz.
- Private auth/session cookie host-only tutulur; `.kepenk.ai` parent cookie veya `.randevukolay.net` cross-surface cookie yapılmaz.
- Kepenk.ai altında gelecekte başka SaaS ürünleri açılması Randevu session/cookie authority'sini paylaşmak zorunda değildir.
- KolayApp ayrı backend, ayrı auth veya ayrı tenant motoru değildir; private app'in mobil işletme UX kabuğudur.

## 3. Public tenant sınırı

Canonical salon adresi:

```text
https://{business-slug}.randevukolay.net
```

Public tenant authority istemcinin gönderdiği `business_id` değildir. Hedef çözüm sırası:

```text
hostname
  -> normalize/validate host
  -> canonical slug veya verified custom-domain mapping
  -> Business
  -> public readiness / sanitized public API
```

Değişmezler:

- wildcard public host private Membership/session authority kazanmaz;
- anonim public yüzey operator mutation kontrollerini veya private object path'lerini açmaz;
- cross-tenant slug/domain çakışması fail-closed olur;
- reserved host adları ayrıca ayrılır (`www`, `api`, `admin`, `app`, `mail`, `support`, `staging` gibi altyapı adları business slug olamaz);
- readiness, abuse/rate limit, public sanitization ve tenant isolation mevcut public-booking güvenlik çizgisini korur.

## 4. Mevcut route'ların geçişi

Bugünkü `/r/:slug` ve customer management/recovery route'ları bir anda kaldırılmaz. Domain cutover compatibility-first yapılır.

Hedef:

- canonical public salon URL'si `{slug}.randevukolay.net` olur;
- mevcut `/r/:slug` linkleri migration döneminde çalışır ve canonical host'a yönlendirilebilir;
- capability/recovery token'larının dayanıklılığı slug değişimi veya host migration yüzünden bozulmaz;
- slug rename yapılacaksa eski public linklerin davranışı açık migration/alias politikasıyla çözülür; sessiz link kırma yoktur.

Exact redirect/status/cache davranışı DOMAIN-01 implementation paketinde browser + security acceptance ile sabitlenir.

## 5. Marketing ve CTA

`randevukolay.net` public marketing origin'idir.

- marketing sayfasındaki giriş/uygulamaya geçiş hedefi canonical private app `randevu.kepenk.ai` olur;
- marketing ile private app aynı-origin varsayılmaz;
- marketing deploy'u private session cookie taşımaz;
- salon örnekleri `*.randevukolay.net` modelini gösterir; sahte gerçek müşteri/domain/testimonial üretilmez;
- eski MKT `/app` same-origin varsayımı shared cutover sırasında yeni domain contract'a uyarlanır.

## 6. Transactional mail/domain

Mevcut tarihsel runbook `notify.kepenk.ai` kullanmaktadır. Yeni ürün sınırı gereği customer-facing Randevu mail identity uzun vadede Randevu Kolay domainine taşınır, örneğin `notify.randevukolay.net`.

Bu değişiklik docs kararıyla anında production sender değiştirmez. SPF/DKIM/DMARC, provider verification ve delivery acceptance ayrı operational taskta kanıtlanmadan sender cutover yapılmaz.

## 7. Yüksek üyelik custom domain

Gelecekte yüksek paket/üyelikte custom public domain entitlement hedeflenir.

Örnek:

```text
https://randevu.salonadi.com
```

Bu özellik açıldığında en az:

- domain ownership / DNS verification,
- tenant-unique verified mapping,
- managed TLS,
- verification kaybında fail-closed davranış,
- canonical `{slug}.randevukolay.net` fallback,
- custom host'un private Membership/session authority olmaması,
- slug/domain değişiminde recovery/capability durability,
- aynı public abuse/readiness/sanitization kurallarının korunması

zorunludur.

Paket adı, fiyatı ve entitlement sınırı bugünkü teknik taskın konusu değildir; commercial packaging netleşince implementation kartı açılır.

## 8. Uygulama sırası

1. F12-02 / PR #76 acceptance + merge kapanır.
2. Bu karar ve KolayApp isim kararı PR #89 ile main'e alınır.
3. MKT izole lane `randevukolay.net` marketing origin + `randevu.kepenk.ai` private CTA contract'ına uyarlanır; shared root cutover ayrıca bekler.
4. DOMAIN-01 public host resolution, wildcard DNS/TLS, compatibility route ve cookie/origin sınırlarını uygular.
5. R1 host/tenant/cookie authority'yi; R2 gerçek host/browser integration'ını bağımsız doğrular.
6. Higher-tier custom-domain ve notification-domain cutover ayrı future tasklardır.

## 9. Şimdi özellikle yapmadıklarımız

- `kepenk.ai` altında customer-facing salon subdomain'leri açmıyoruz.
- `app.randevukolay.net` diye ikinci private app yaratmıyoruz.
- #76 ortasında router/origin/DNS mutation yapmıyoruz.
- commercial paket net değilken custom-domain schema/provider kodu yazmıyoruz.
- Kepenk.ai parent platformunu Randevu Kolay marketing markasına çevirmiyoruz.

## Bağlı işler

- DOMAIN-01: Issue #92
- MKT-DOMAIN-01: Issue #93
- custom-domain deferred: Issue #94
- living docs sync: Issue #95
- notification-domain follow-up: Issue #96
- KolayApp canonical name: `docs/plan/kolayapp-name-decision.md`
