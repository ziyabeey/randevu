# YZT Randevu — Mevcut durum

**Kontrol: 13 Eylül 2026.** Plan v3 ürün ve teknik sıra kaynağıdır. Aşağıdaki tablo doğrulanmış kodu, test geçmişini ve açık işleri ayırır. S01…S04 tamamlandı; S05…S08 ve GS açıktır. Canlı sahip/durum [TASKS](TASKS.md), sıra [ROADMAP](ROADMAP.md), ürün sınırı [PRODUCT_SPEC](PRODUCT_SPEC.md) içindedir.

## Devam noktası

**S04 tamamlandı ve [PR #39](https://github.com/ziyabeey1-ai/randevu/pull/39) ile main'e birleşti** (`a00b66a80f9ce81c33d49608c391e11486d9523d`). Kabul head'i `0f8cd59f6b35f0fd791f75dd74140460ae5d00bd`: 277 HTTP testi, bağımsız son inceleme, [PG17/Chrome CI 34735531168](https://github.com/ziyabeey1-ai/randevu/actions/runs/34735531168) ve [gerçek staging 34737231931](https://github.com/ziyabeey1-ai/randevu/actions/runs/34737231931) başarılı. Migration/deploy, hosted auth/mutation smoke ve F09 booking/recovery/idempotency/capability/fake-receipt/provider-delivery aynı head'de doğrulandı. Merge ağacı kabul ağacıyla birebir eşleşti. [S04 devri](docs/handoffs/S04.md) kota tablosu, sınırlar ve ölçümü içerir; aynı görev yeniden başlatılmaz.

**S03 tamamlandı ve [PR #35](https://github.com/ziyabeey1-ai/randevu/pull/35) ile main'e birleşti** (`aa5b6b209ac0440e918abdcf21f830b7468df250`). Kabul head'i `89c048cbca3ebd888defd6535c8abd06df057add`: 272 HTTP testi, bağımsız inceleme, [PG17/Chrome CI 34733476367](https://github.com/ziyabeey1-ai/randevu/actions/runs/34733476367) ve [gerçek staging 34733661007 / deneme 2](https://github.com/ziyabeey1-ai/randevu/actions/runs/34733661007/attempts/2) başarılı. Merge ağacı kabul ağacıyla birebir doğrulandı. [S03 devri](docs/handoffs/S03.md) kapsamı ve ilk staging zaman aşımını kaydeder.

İlk staging denemesi 180 saniyede `pending` görüp durdu; aynı iş yaklaşık üç saniye sonra ilk denemede sağlayıcı kabulü aldı. Aynı kod ve eşiklerle ikinci run gerçek teslim kontrolünü geçti. Dağıtım sonrası Cron hazır olma penceresi S05'e kanıtlı takip olarak bırakıldı; genel teslim hızı garantisi verilmedi.

S01 ve S02'nin önceki kabul kanıtları korunur. **S05 çalışılıyor**: `s05-deploy-consistency`, base `72c4665`; [devir](docs/handoffs/S05.md). Rutin anahtar koruma, explicit rotasyon ve hata toparlama uygulanıyor; gerçek staging kabulü henüz yok. Sonraki oturum aynı işi ikinci branch'te başlatmadan canlı TASKS/açık PR kaydını kontrol eder. S06/S07/S08 dosya ve merge sırası ayrılarak hazırlanabilir. S07’nin S02/S03/S04 önkoşulları artık tamamdır. Yeni özellik kodu GS tamamlanmadan başlamaz.

F10-02 için açık [PR #32](https://github.com/ziyabeey1-ai/randevu/pull/32), branch `f10-02-invites-memberships-roles`, incelenen head `5099ea307ac806e958a7a29a674462558570b0d5` yalnız `docs/handoffs/F10-02.md` içerir. Mevcut sahibi korunur; GS nedeniyle görev **Engelli** kalır. Devralmadan önce canlı PR tekrar kontrol edilir; aynı işi ikinci branch'te başlatma.

Üç kol müşteri paneli, randevu paneli ve SalonApp'tir. Takvim/adisyon referans düzeni korunur; müşteri estetiği ve yeni kullanılabilirlik fikirleri ayrı ürün çalışmasıdır. MVP Faz 17 sonunda kalır. Gelecek planı PDF'si ayrı tutulur ve repoya eklenmez.

## Kodda bulunan temel

| Alan | Gerçek durum | Kalan iş |
| --- | --- | --- |
| React/Vite/TypeScript + Worker/Hono | Tek uygulama/backend main'de | Mevcut yapıyı koru |
| Supabase Auth + Business/Membership + RLS | Faz 2 + F10-01 + S01/S02 main'de; ortak auth/guard ve altı ekran bağlantısı doğrulandı | GS sonrası F10 ekip/kurulum |
| Hizmet/personel/eşleştirme | Faz 3 main'de | F10-04 düzenleme; F12-03 fiyat/kategori verisi |
| Mesai/kapanış/timezone | Faz 4 main'de | F11 çok hizmet uyumu |
| Tek hizmetli booking, customer, audit/idempotency | Faz 5 main'de | F11 grup modeli; eski veriler ve yetki linkleri korunacak |
| Public booking ve capability yönetimi | Faz 6–7 + F09 recovery + S04 main'de; yönetim/tekrar kotaları doğrulandı | F12 yeni müşteri yüzeyi |
| Gün/hafta takvimi | Faz 8 main'de | F13 güncellik, liste ve referans düzeni |
| Durable e-posta outbox / scheduled dispatcher | F09-03/05 + S03 main'de; içerik/sürüm/tekrar tutarlılığı doğrulandı | S07 veri ömrü; F16-02 yaşam döngüsü/SMS |
| Public abuse guard | F09-04 + S04 main'de; ayrı retry/manage/business-create kotaları, kalıcı hata sayacı | S07 gerçek yük ve runtime ölçümü |
| Test/CI ve gerçek staging | F17-01/02 main'de | S05 kısmi deploy, S06 CI/koruma, S08 yeni nesne erişimi |
| SalonApp/adisyon/tahsilat | Planlandı | Faz 14; henüz çalışan tablo/route yok |
| Ürün/stok/masraf/kasa | Planlandı | Faz 15 |
| Seri, hatırlatma/SMS, fotoğraf/yorum, paket/promosyon/prim, dil/plan | Planlandı | Faz 16; bazı temel hesap yolları F10'dan gelecek |
| Üç kollu gerçek işletme pilotu | Yapılmadı | F17-04/05; staging yeşili pilot kabulü değildir |

Mevcut veri erişimi Supabase HTTP/RPC'dir. Önceki ilk önerideki pg/Hyperdrive bağlantısının kurulmuş olduğu varsayılmaz. Yeni mikroservis, ayrı motor veya framework geçişi bu planda yoktur.

## Tamamlanan kabul kanıtları

Bu on iki görev kendi kayıtlı kapsamıyla tamamlandı. Sonraki bulgular ayrı S görevlerinde tutulur; eski başarılı koşuların kapsamı kendiliğinden genişletilmez.

| Görev | Teslim / kanıt | Kanıtın sınırı |
| --- | --- | --- |
| F09-01 | [PR #11](https://github.com/ziyabeey1-ai/randevu/pull/11), [sözleşme](docs/plan/f09-01-recovery-contract.md) | Doküman teslimi |
| F09-02 | [PR #12](https://github.com/ziyabeey1-ai/randevu/pull/12), [devir](docs/handoffs/F09-02.md), CI `34651571690` | Atomik booking/capability/recovery |
| F09-03 | [PR #13](https://github.com/ziyabeey1-ai/randevu/pull/13), [devir](docs/handoffs/F09-03.md), CI `34653785166` | Outbox/lease/retry, server-only receipt ve provider stub; yeni S03 senaryoları dışarıda |
| F09-04 | [PR #14](https://github.com/ziyabeey1-ai/randevu/pull/14), [devir](docs/handoffs/F09-04.md), CI `34656950693` | Guarded public booking, actor/network/business sayaçları; bütün manage uçları için kanıt değil |
| F09-05 | [PR #30](https://github.com/ziyabeey1-ai/randevu/pull/30), [devir](docs/handoffs/F09-05.md), staging [34681540142](https://github.com/ziyabeey1-ai/randevu/actions/runs/34681540142) | Kayıp cevap/recovery, duplicate/conflict, capability, sahte receipt reddi, Resend güvenli test recipient'inde delivered |
| F10-01 | [PR #31](https://github.com/ziyabeey1-ai/randevu/pull/31), [devir](docs/handoffs/F10-01.md), staging [34684481828](https://github.com/ziyabeey1-ai/randevu/actions/runs/34684481828) | Refresh/üyelik, confirmation/replay, parola rotation. Admin generate_link + doğrudan confirm; public e-posta/PKCE zincirini S01 tamamladı |
| S01 | [PR #34](https://github.com/ziyabeey1-ai/randevu/pull/34), [devir](docs/handoffs/S01.md), code CI `34703904598`, staging [34704131649](https://github.com/ziyabeey1-ai/randevu/actions/runs/34704131649) | Supabase-doğrulanmış JWT AMR recovery authority; gerçek public e-posta/Receiving/PKCE, marker silme/onarım, refresh, ikinci sekme, replay, parola değişimi ve eski bearer sınırı |
| S02 | [PR #36](https://github.com/ziyabeey1-ai/randevu/pull/36), [devir](docs/handoffs/S02.md), [CI 34708432373](https://github.com/ziyabeey1-ai/randevu/actions/runs/34708432373), [staging 34708621675](https://github.com/ziyabeey1-ai/randevu/actions/runs/34708621675) | 265 HTTP/client/contract testi, SQL/Chrome kapıları; hosted login/session/işletme seçimi, dört feature read, Origin/CSRF negatifleri, refresh ve capability doğrulaması. Bu run F09/F10/S01 opt-in yolculuklarını yeniden çalıştırmadı |
| S03 | [PR #35](https://github.com/ziyabeey1-ai/randevu/pull/35), [devir](docs/handoffs/S03.md), [CI 34733476367](https://github.com/ziyabeey1-ai/randevu/actions/runs/34733476367), [staging deneme 2](https://github.com/ziyabeey1-ai/randevu/actions/runs/34733661007/attempts/2) | 272 HTTP testi; PG17 snapshot/lease/lifecycle/upgrade/yarış; hosted recovery/idempotency/capability, sahte receipt reddi ve Resend test alıcısında delivered. İlk startup zaman aşımı S05 takibinde |
| S04 | [PR #39](https://github.com/ziyabeey1-ai/randevu/pull/39), [devir](docs/handoffs/S04.md), [CI 34735531168](https://github.com/ziyabeey1-ai/randevu/actions/runs/34735531168), [staging 34737231931](https://github.com/ziyabeey1-ai/randevu/actions/runs/34737231931) | 277 HTTP; PG17 kota/ACL/hata/yenilenme ve iki bağlantılı yarışlar; hosted auth, booking/recovery/idempotency/capability ve Resend teslimi. 1000 tekrar ölçümü CI fixture'ıdır, production kapasite garantisi değildir |
| F17-01 | [Devir](docs/handoffs/F17-01.md), staging [34679959999](https://github.com/ziyabeey1-ai/randevu/actions/runs/34679959999) | Hosted DB/ACL/credential, fixtures, Worker deploy, management key koruma, health/login/session/business/catalog |
| F17-02 | [PR #15](https://github.com/ziyabeey1-ai/randevu/pull/15), [devir](docs/handoffs/F17-02.md), CI `34658041327` | Test envanteri/Chrome smoke/HTTP/SQL; o tarihte 0-vulnerability baseline. CI verimliliği ve repo koruması ayrıca S06 |

S01 için son doğrulanmış code head `8b4e2a70188061f8f38979ab539bc47d2c409980`, CI `34703904598` ve gerçek staging `34704131649` success'tir. S02 kabul head'i `dc4424b34570aa78949d08a10a108b3bfc8083a7`, CI `34708432373` ve staging `34708621675` success'tir; main merge ağacı bu kabul ağacıyla birebir doğrulandı. S03 kabul head'i `89c048cbca3ebd888defd6535c8abd06df057add`, CI `34733476367` ve staging `34733661007` deneme 2 success'tir; merge ağacı kabul ağacıyla aynıdır. S04 kabul head'i `0f8cd59f6b35f0fd791f75dd74140460ae5d00bd`, CI `34735531168` ve staging `34737231931` success; main merge ağacı aynı. G09 tarihsel kapalı, **GS ve G10–G17 açıktır**.

## Açık inceleme bulguları

Ayrıntılı dosya/sınır/kanıt ve kabul [S kartlarında](docs/plan/stabilization.md) bulunur. Aşağıdakiler açık iştir.

| Bulgu / kanıt türü | Etki / sınır | Görev |
| --- | --- | --- |
| Run başına DB hash değişimi Worker'dan önce — workflow incelemesi | Kısmi dağıtımda eski Worker uyumsuz kalabilir; S03 ilk staging denemesinde Cron başlangıcı 180 sn test penceresini aştı, deployment hazır olma kontrolü de izlenecek | S05 |
| Üç typecheck/docs tam CI/source regex; main protected=false ve rulesets boş — kaynak/API | Test maliyeti ve merge zorunluluğu eksik | S06 |
| Terminal PII retention ve bazı dış RPC timeout'ları eksik — kaynak incelemesi | Büyüme/bakım/uzun bekleme sınırı; canlı maliyet ölçümü yapılmadı | S07 |
| Future table/sequence/view erişim testi eksik — kaynak incelemesi | Gelecek migration güvenlik kapısı; mevcut tenant izolasyonu bozuk iddiası değil | S08 |

## Mimari devir sözleşmeleri

- [K01](docs/plan/architecture-contracts.md#k01): grup/satır kimliği, eski appointment/link/komut/audit/recovery/outbox geçişi. F11 tüm tüketicileri birlikte ele alır.
- [K02](docs/plan/architecture-contracts.md#k02): sabit/aralık fiyat, kesinleştirme, mali kaynak ve düzeltme kimliği; F12-03, F11-01'den önce.
- [K03](docs/plan/architecture-contracts.md#k03): ölçülebilir istek/sorgu/bakım bütçeleri ve veri ömrü. Değerler başlangıç hedefidir; uygulanmış/ölçülmüş sayılmaz.
- [Ajan çalışma düzeni](docs/plan/agent-workflow.md): koordinatör kontrat/kabul/inceleme, GPT-5.6 Sol sınırlı uygulama ve kanıt. Kullanılan beceri ve bir sonraki adım devirde kalıcıdır.

## Çalışan yollar ve dosyalar

| Yol | Mevcut dosya / işlev |
| --- | --- |
| `/` | `src/App.tsx` — giriş/kayıt/kurtarma/parola, işletme ve katalog |
| `/calendar` | `src/CalendarPage.tsx` — gün/hafta |
| `/bookings` | `src/BookingPage.tsx` — oluşturma/taşıma/durum |
| `/availability` | `src/AvailabilityPage.tsx` — mesai/kapanış |
| `/public-booking` | `src/PublicBookingSettingsPage.tsx` — public ayarlar |
| `/r/:slug` | `src/PublicBookingPage.tsx` — public booking ve pending recovery |
| `/m#<token>` | `src/ManageAppointmentPage.tsx` — capability yönetimi |

Worker entry `worker/entry.ts`, router `worker/app.ts`; auth `worker/auth.ts` + `worker/auth-routes.ts`; temel hesap/katalog `worker/index.ts`. Feature Worker'ları aynı isimli booking/calendar/availability/public/manage dosyalarıdır. `worker/notifications.ts`, `worker/notification-maintenance.ts`, `worker/public-abuse.ts` ilgili S işlerinin başlangıcıdır. Kesin migration sırası `supabase/migrations/` ve CI'ın çalıştırdığı zincirdir; birleşmiş migration değiştirilmez.

## Ortam ve korunacak sınırlar

- Doğrulanmış staging origin: `https://yzt-randevu-staging.ziyabeey1.workers.dev`. Kurulum/erişim ayrıntısı [staging runbook](docs/runbooks/staging.md) ve F17 devirlerindedir; runbook'taki run-başına gate/dispatch rotasyonu S05'e kadar bilinen risk taşır.
- Hedef production `randevu.kepenk.ai`, staging custom domain `staging.randevu.kepenk.ai`, sender `randevu@notify.kepenk.ai`. Bunlar tek başına production/pilot hazır olduğunun kanıtı değildir.
- Mevcut runtime secret/config adları: `MANAGEMENT_LINK_ENCRYPTION_KEY_V1`, `PUBLIC_BOOKING_GATE_SECRET`, `NOTIFICATION_DISPATCH_SECRET`, `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`, `PUBLIC_APP_ORIGIN`. Değerleri Git'e yazılmaz; Worker service-role veya acceptance-admin key taşımaz.
- Outbox mevcut batch 10, lease 45 sn, provider timeout 10 sn, en fazla 8 deneme/72 saat; provider kabulü delivered ile aynı değildir. 24 saatlik provider idempotency sınırının dışındaki belirsiz retry için mutlak exactly-once iddiası yoktur; S03 bu pencere dışındaki belirsiz tekrarları durdurur.
- Şifreli recovery materyali aktif iş/TTL bitince temizlenir; token/full manage link düz saklanmaz. S07 bu politikayı terminal PII ve komut içeriğine genişletecek.
- Eski PR #8 kapalı/superseded; `phase-2-auth-tenant` eski Faz 1 temelidir. Başka oturumun yerel `codex/faz-2-auth-tenants` işini ezme veya main'e taşımaya çalışma.

## Sonraki çalışma sınırı

S01…S04 kabulü tamamlandı. S05 için güncel main/TASKS/açık PR sahipliği kontrol edilip staging secret ve dağıtım tutarlılığına dar görev paketi hazırlanır. Rutin deploy'da gate/dispatch secret korunması, açık rotasyon/geri dönüş sırası ve S03'ten kalan Cron hazır olma bulgusu ele alınır. S05 henüz üstlenilmedi veya uygulanmadı; mevcut S04 migration değiştirilmez. GS kapanmadan F10-02 veya diğer yeni özellik kodu başlatılmaz.
