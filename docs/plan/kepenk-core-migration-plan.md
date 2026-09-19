# Kepenk Core — platform çekirdeği geçiş planı (KC)

**Sonuç:** Randevu'nun Supabase/Postgres kimlik-tenant katmanı platform çekirdeği (Kepenk Core) olur; Randevu Kolay booking domaini aynı veritabanında aynı `business_id` ile çalışmaya devam eder; Kepenk uygulaması Firestore'u projection'a indirip Core'u tüketir. **Bağlayıcı sözleşme:** [K04](k04-platform-core-contract.md). **Durum:** planlama teslimi; uygulama kartları DANIŞMA 3 tarafından `TASKS.md`'ye açılır. Bu belge Randevu F09–F17 görev sayısını değiştirmez; KC ayrı bir platform track'idir.

**Dayanak head:** `main@f1fd00888eb0bfac5e47a5d70cdf4c127e827b16`. Repo'ya bağlı gözlemler bu head'e aittir; kart açılırken current main'de yeniden doğrulanır. Kepenk reposu bu planın yazıldığı oturumdan okunamamıştır; Kepenk tarafı iddiaları Kepenk ajanının 16 Eylül mesajından alınmıştır ve `UNKNOWN` sayılır.

## 0. Çalışır uygulama tanımı

Plan şu üç şeyin birlikte çalıştığı ilk anı hedefler; başka hiçbir şey bu ana kadar kapsam değildir:

1. **Randevu Kolay** bugünkü tablolarıyla, değişmeden, aynı veritabanında çalışır ve pilot yolu (F10-06 → F11 → … → F17-05) etkilenmez.
2. **Kepenk uygulaması** kullanıcıyı Supabase kimliğiyle tanır (kendi host-only oturumu), tenant bağlamını `memberships` üzerinden alır, plan/entitlement'ı Core'dan okur, verisini Firestore'da `business_id` ile tutar.
3. **Kepenk Billing** İyzico'dan doğrulanmış ödeme olayını tek idempotent komutla Core'a yazar; iki uygulama da aynı entitlement'ı görür.

SSO broker, platform admin/impersonation, usage kredisi ve Firestore root-write kapatma bu tanımın **sonrasındadır**.

## 1. Kritik yol

```text
KC-00 sözleşme + envanter (docs)
   │
KC-01 Core şema v1 + RPC yüzeyi           ← Randevu repo, STRICT, R1
   │
KC-02 Kepenk kimlik adaptörü + BFF oturum ← Kepenk repo, STRICT
   │
   ├── KC-03 esnaf → business backfill + alias'lar (shadow parity)
   └── KC-04 billing komut yolu (İyzico → Core)
   │
KC-05 Core → Firestore projection + canary cutover      ← "çalışır uygulama" burada
   │
KC-06 auth.kepenk.ai broker (ikinci uygulama gerçek kullanıcı görünce)
KC-07 platform admin read RPC + audit (impersonation oturumu yok)
```

Randevu tarafı paralel ve bağımsızdır: F10-06, F11-01…04, F12-04/05, F13, F14, F15, F16, DOMAIN-01. Randevu'da Core'a dokunan tek iş, F16-08 plan bilgisi ve DOMAIN-01 custom-domain entitlement'ının `public.has_entitlement` tüketmesidir; ikisi de KC-01 sonrasıdır.

## 2. Paketler

Her paket CONTRIBUTING görev paketi şablonuna göre yazılmıştır. Süre verilmez; sıra ve kapı verilir. `S/M/L` tahmini PR büyüklüğüdür.

### KC-00 — Sözleşme ve envanter · docs · LIGHT · S

- **Görev / yüzey:** K04 ve bu planın main'e alınması; Kepenk envanteri.
- **Sahip:** DANIŞMA 3 (Randevu docs) + Kepenk ajanı (envanter).
- **Yazılabilir dosyalar:** `docs/plan/k04-platform-core-contract.md`, `docs/plan/kepenk-core-migration-plan.md`; canlı durum gerekiyorsa yalnız TASKS koordinatör güncellemesiyle değişir. ROADMAP plan belgesidir, PROJECT_STATE emekli tombstone'dur.
- **Envanter (Kepenk, sayılarla):** gerçek kullanıcı sayısı ve giriş yöntemi dağılımı (parola / OTP / diğer); esnaf sayısı ve `esnaflar/{id}` alan haritası; slug/domain alanları; identity/tenant okuyan Firestore koleksiyonları ve security rule'ları; `/api/randevu` tüketicileri; `packages/booking-schema` kullanan kod; metered/kredi sayaçları var mı; P0-05 Credential Envelope'un secret taşıma arayüzü.
- **Karar çıktısı:** kullanıcı taşıma modu (bkz. KC-02), ilk üç plan anahtarı ve ilk üç entitlement anahtarı (Ziya), esnaf slug politikası (DOMAIN-01 ile uyumlu).
- **Kabul:** envanter sayıları PR/issue'da; K04 main'de; TASKS'ta KC satırları açıldı.
- **Kapsam dışı:** kod, migration.

### KC-01 — Core şema v1 ve RPC yüzeyi · Randevu repo · STRICT (R1) · M

- **Bağımlılıklar:** KC-00.
- **Sahip:** Randevu tarafında migration zinciri writer token'ı olan ajan (DANIŞMA 3 atar; Kepenk ajanı contract-reviewer). Ortak alan: migration zinciri, `scripts/ci-postgres-plan.json`.
- **Şema (taslak; adlar PR sözleşmesinde kesinleşir):**

```text
create schema core;                       -- PostgREST exposed schemas listesine EKLENMEZ
revoke all on schema core from anon, authenticated;  -- + default privileges (S08 deseni)

core.tenant_aliases      (provider, external_id) PK · business_id → public.businesses RESTRICT · unique(business_id, provider)
core.identity_aliases    (provider, external_subject) PK · user_id → public.profiles RESTRICT · unique(user_id, provider)
core.service_principals  id PK · name unique · secret_hash · previous_secret_hash · previous_valid_until · active · rotated_at
core.platform_commands   (principal_id, idempotency_key) PK · command · request_hash · business_id · result jsonb · created_at
core.plan_entitlements   (plan_key, entitlement_key) PK · granted · limit_value · policy_version   -- içerik ürün kararı
core.subscriptions       business_id PK → public.businesses RESTRICT · plan_key · status · current_period_start/end · version · updated_at
core.subscription_events id identity PK · business_id · event_type · plan_key · payload jsonb · principal_id · idempotency_key · created_at  -- append-only
core.entitlements        (business_id, entitlement_key) PK · granted · limit_value · source_event_id → subscription_events · valid_until
```

  Tüm tablolar RLS enable+force; `anon`/`authenticated` için hiçbir grant yok; `subscription_events` için UPDATE/DELETE hiçbir API rolüne verilmez. `core.subscriptions.status` değer kümesi ürün kararıdır; taslak: `trial | active | past_due | cancelled`.

- **RPC yüzeyi (`public` şemasında, explicit grant):**
  - `public.core_apply_platform_command(p_principal_name text, p_principal_secret text, p_idempotency_key text, p_command text, p_payload jsonb) returns jsonb` — `anon` execute; secret hash doğrulaması (`notification_dispatch_authorized` deseni, overlap'li rotasyon); komut kümesi v1: `LinkTenantAlias`, `LinkIdentityAlias`, `ProvisionBusiness` (mevcut Supabase kullanıcısı için business + owner membership; `create_business_with_owner` mantığını çağırır, S04 kotasını principal için ayrı sınırla), `ChangeSubscription`, `GrantEntitlement`, `RevokeEntitlement`; K04 kilit sırası; `{ok, data}` / `{ok:false, error}` whitelist'i (`execute_public_operation` deseni); istisna subtransaction'da geri alınır.
  - `public.has_entitlement(p_business_id uuid, p_entitlement_key text) returns boolean` — `authenticated`; `f10_require_standard_session()` + `is_active_member`; `valid_until` ve `granted` değerlendirir; entitlement yoksa `false`.
  - `public.get_business_platform_snapshot(p_business_id uuid) returns jsonb` — `authenticated`, guard'lı, bounded: subscription durumu + entitlement listesi (K03 sınırında).
  - `public.core_read_change_feed(p_principal_name, p_principal_secret, p_after_event_id bigint, p_limit integer) returns jsonb` — `anon`, secret-gated, `p_limit ≤ 100`; KC-05 projection için cursor feed.
- **Korunacak kontratlar:** K01/K02/K03 dokunulmaz; mevcut `public.*` fonksiyon imzaları değişmez; `create_business_with_owner_guarded` davranışı korunur.
- **Kabul ve kanıt:** clean + upgrade lane; `core` şemasının PostgREST'e kapalı olduğu ve API rollerinin `core.*` üzerinde hiçbir ayrıcalığı olmadığı S08 tarzı negatif test; komut idempotency (aynı anahtar aynı sonuç / farklı payload conflict / eşzamanlı aynı anahtar dblink); yanlış secret, pasif principal ve rotasyon overlap testleri; `has_entitlement` recovery negatifi; alias benzersizliği negatifleri; `ProvisionBusiness` cross-tenant ve kota negatifleri; R1 ACCEPTABLE. Staging gerekmez (hosted-only davranış yok).
- **Kapsam dışı:** usage ledger, admin RPC'leri, broker, Kepenk kodu.

### KC-02 — Kepenk kimlik adaptörü ve BFF oturumu · Kepenk repo · STRICT · L

- **Bağımlılıklar:** KC-01 (RPC yüzeyi), KC-00 envanteri (taşıma modu).
- **Sahip:** Kepenk ajanı; R1 auth sınırı için dış inceleme (Randevu R1 aynı kişi/rol olabilir).
- **İş:** Kepenk sunucusunda Supabase Auth'a karşı **BFF oturumu**: giriş/yenileme/çıkış sunucu tarafında, `app.kepenk.ai` host-only HttpOnly cookie, CSRF double-submit + Origin kontrolü, `amr` recovery guard — yani `worker/auth.ts` sözleşmesinin Kepenk karşılığı; tarayıcı token görmez. API route'ları JWT'yi doğrular (öneri: Supabase asimetrik signing key + JWKS; HS256 kalıyorsa secret yalnız Credential Envelope'ta, `NEXT_PUBLIC_*`'da asla). `RequestContext = {user_id = sub, business_id (memberships ile doğrulanmış), role, entitlements}`; `business_id` istemciden gelen değer değil, aktif membership'ten türetilir.
- **Firebase adaptörü (oturum üretim noktasında):** taşıma modu envantere göre:
  - OTP kullanıcıları → Supabase phone/email OTP (SMS sağlayıcısı mevcut Twilio hesabı; `UNKNOWN`: sağlayıcı/limit); doğrulanmış telefon eşleşmesiyle `LinkIdentityAlias(firebase, uid → user_id)`.
  - Parola kullanıcıları → Firebase scrypt hash'i GoTrue'ya alınamaz; ilk girişte parola sıfırlama (Supabase `recover`) + alias bağlama.
  - Yeni kullanıcı → doğrudan Supabase signup; Firebase'e kayıt yazılmaz.
  - Veritabanı hiçbir aşamada Firebase JWT'sine güvenmez (K04 §5).
- **Kabul:** yetkisiz/eskimiş oturum, cross-site Origin, CSRF, recovery oturumu ile normal route negatifleri; JWT doğrulama; membership pasifleştirmenin bir sonraki istekte etkili olduğu; alias'lı kullanıcının aynı `user_id` ile Randevu'ya da girebildiği (aynı Supabase hesabı, ayrı host-only oturum); secret'ların istemci bundle'ında olmadığı (build çıktısı grep receipt'i).
- **Kapsam dışı:** SSO/broker, Firestore rule değişikliği, esnaf backfill.

### KC-03 — esnaf → business backfill, alias'lar ve shadow parity · Kepenk repo + KC-01 komutları · STRICT · M

- **Bağımlılıklar:** KC-01, KC-02 (kullanıcı `user_id`'leri olmadan owner membership yazılamaz).
- **Eşleme (P1-00/P1-01/P1-03 karşılığı):** her `esnaflar/{id}` için `ProvisionBusiness` (owner = alias'lanmış Supabase kullanıcısı; kullanıcı henüz taşınmadıysa business bekletilir, sahipsiz business yaratılmaz) + `LinkTenantAlias(legacy-kepenk-firestore, esnafId → business_id)`; idempotent batch (aynı anahtarla tekrar güvenli); slug üretimi Randevu slugify kuralı + DOMAIN-01 reserved adlar; çakışma fail-closed ve raporlanır, sessiz yeniden adlandırma yok.
- **Shadow parity:** Firestore hâlâ authoritative; her esnaf için `business_id` Firestore dokümanına yazılır; parity job farkları raporlar; fark sıfırlanmadan KC-05 açılmaz.
- **Kabul:** N esnaf → N business/N alias, tekrar çalıştırmada 0 yeni satır; çakışan slug/duplicate esnaf raporu; cross-tenant negatif; owner'sız business yok.
- **Kapsam dışı:** Firestore root-write kapatma, projection.

### KC-04 — Billing komut yolu · Kepenk repo + KC-01 RPC · STRICT (R1) · M

- **Bağımlılıklar:** KC-01; KC-03 en az bir gerçek business için.
- **Zincir:** İyzico ödeme → Kepenk Billing (sunucu tarafında doğrulanmış olay; istemci beyanı değil) → `core_apply_platform_command(ChangeSubscription | GrantEntitlement)` (idempotency anahtarı = sağlayıcı olay kimliği türevi; `request_hash` payload'dan) → `core.subscription_events` (append-only) → `core.subscriptions` + `core.entitlements`. Plan → entitlement dönüşümü `core.plan_entitlements` politikasından, `policy_version` olayda saklanır.
- **Kabul:** aynı ödeme olayının tekrarı ikinci olay üretmez; farklı payload aynı anahtarla reddedilir; eşzamanlı iki komut aynı business'ta seri; downgrade sonrası `has_entitlement` bir sonraki istekte `false`; Randevu ve Kepenk aynı snapshot'ı okur; ödeme başarısız/timeout sonrasında sonuç aynı anahtarla kurtarılır (K03 timeout kuralı).
- **Kapsam dışı:** Randevu F14 salon kasası (ayrı para akışı, ayrı ledger), usage kredisi (varsa KC-04b), fiyat/plan içeriği (ürün kararı).

### KC-05 — Core → Firestore projection ve canary cutover · Kepenk repo · FOCUSED → STRICT (cutover) · L

- **Bağımlılıklar:** KC-03 parity sıfır, KC-04 en az bir gerçek abonelik olayı.
- **İş (P1-04…P1-08 karşılığı):** Kepenk durable job `core_read_change_feed` ile cursor'dan okur ve Firestore'a tek yönlü yazar (business, membership özeti, plan/entitlement); onboarding Core'a yazar (`create_business_with_owner_guarded` — kullanıcı oturumuyla — veya `ProvisionBusiness`); admin araçları raw Firestore patch yerine komut çağırır; pricing/modules Core'dan okunur; canary'de Firestore root authoritative write kapatılır.
- **Kabul:** projection gecikmesi ölçülür ve raporlanır; projection kasıtlı eskitildiğinde yetki kararı değişmez (K04 §11); canary tenant'ta Firestore yazımı kapalıyken tüm Kepenk akışları çalışır; geri alma yolu (Firestore root write'ı yeniden açma) denenmiş.
- **Kapsam dışı:** Firestore koleksiyonlarının silinmesi/temizliği (ayrı ölçülmüş iş).

### KC-06 — `auth.kepenk.ai` broker · ertelendi · STRICT

Yalnız ikinci uygulama gerçek kullanıcı gördükten sonra açılır. Kod-değişim (code exchange) akışı; state/kod bağlama, replay, redirect allowlist; recovery/PKCE linklerinin iniş noktası; her uygulamanın host-only oturumu korunur; parent cookie yok. S01/S02 sınıfı negatif testler + R1; hosted PKCE davranışı için staging.

### KC-07 — Platform admin read RPC'leri ve audit · ertelendi · STRICT

AdminPrincipal, business membership'i olmadan tenant verisini yalnız **auditli salt-okunur** Core RPC'leriyle görür; kullanıcı adına Supabase oturumu üretilmez; impersonation gerekiyorsa ayrı karar ve R1.

## 3. Kepenk P0/P1 eşlemesi

| Kepenk kartı | KC karşılığı | Not |
| --- | --- | --- |
| P0-00…P0-04 (User/Membership/Session/RequestContext, ServicePrincipal, durable jobs) | KC-02 girdisi | Session/RequestContext BFF sözleşmesine hizalanır; ServicePrincipal Core'a yalnız komut RPC'siyle konuşur |
| P0-05 Credential Envelope | KC-01/KC-04 girdisi | Principal secret'ı ve JWT/JWKS materyali burada yaşar; `NEXT_PUBLIC_*` temizliği ön koşul |
| P0-06 AdminPrincipal, P0-07 audit/impersonation | KC-07 | Devam eder; booking verisine impersonation yok |
| P1-00 envanter + UUID mapping | KC-00, KC-03 | |
| P1-01 Firestore BusinessTenant | **iptal** → KC-03 | İkinci tenant otoritesi kurulmaz |
| P1-02 Subscription/Entitlement/Quota | KC-01, KC-04 | Core Postgres'te |
| P1-03 backfill + shadow parity | KC-03 | |
| P1-04 onboarding Core'a yazar | KC-05 | |
| P1-05 Core → Firestore projection | KC-05 | |
| P1-06 admin raw patch → komut | KC-05 | |
| P1-07 pricing/modules Core'dan | KC-01 (`plan_entitlements`) + KC-05 | |
| P1-08 canary root-write kapatma | KC-05 | |

## 4. Randevu tarafında değişmeyenler

- `public.profiles / businesses / memberships` şeması, RLS'i, `is_active_member`, `f10_team_actor`, `has_financial_permission`, Worker cookie/CSRF/recovery sınırı, booking/customer/catalog RPC'leri.
- F10-06 → F11 → F12-04/05 → F13 → F14 → F15 → F16 → F17 sırası ve bütçeleri.
- F14 adisyon/tahsilat salonun kasasıdır; Core billing ile ilişkisi yoktur.
- Tek istisna: KC-01 sonrası F16-08 ve DOMAIN-01 `has_entitlement` tüketir; bu, kartlarına tek satır olarak işlenir.

## 5. Yapmadıklarımız

- Veritabanı bölmek, `businesses/memberships/profiles` taşımak.
- Firebase JWT'sine DB tarafında güvenmek; `auth.uid()`'i değiştirmek.
- Parent-domain cookie; tarayıcıya token vermek; service-role anahtarı.
- Firestore'da BusinessTenant/Subscription otoritesi; projection'dan yetki.
- İkinci izin modeli; Randevu S04 sayaçlarını ticari kotayla birleştirmek.
- Plan fiyatı/limitini kodda sabitlemek; hazır olmayan paketi arayüzde satmak.
- Kepenk'te salon booking/payment (W6) inşa etmek; Kepenk CRM'de ikinci salon müşteri master'ı.
- Broker ve impersonation'ı ihtiyaç doğmadan kurmak.

## 6. Ziya'nın karar vermesi gerekenler (kod başlamadan)

1. İlk plan anahtarları ve ilk entitlement anahtarları (ör. `kolayapp`, `custom_domain`, `ai_assistant`) — adlar ve limitler.
2. Kullanıcı taşıma modu: OTP-taşıma mı, parola sıfırlama mı, yeniden kayıt mı; hangi kullanıcı grubuna hangisi.
3. Esnaf slug/domain politikası çakışmada ne olur (DOMAIN-01 ile aynı karar).
4. Usage kredisi bugün ölçülüyor mu; ölçülüyorsa KC-04b açılır, ölçülmüyorsa açılmaz.
5. Kepenk'te bugün gerçek production kullanıcı var mı, kaç tane — KC-02/03 boyutunu bu belirler.

## 7. Bilinmeyenler

Kepenk repo içeriği; kullanıcı/esnaf sayıları ve giriş yöntemi dağılımı; Firestore rule'larının membership'e bağımlılığı; Supabase projesinde asimetrik JWT anahtarının açık olup olmadığı; SMS sağlayıcı/limitleri; Kepenk durable job'larının feed tüketim modeli. Bunlar KC-00 envanteriyle kapanır; kapanmadan KC-02/03 kart olarak açılmaz.
