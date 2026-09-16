# K04 — Platform çekirdeği (Kepenk Core) kimlik, tenant ve ticari yetki sözleşmesi

**Karar tarihi:** 16 Eylül 2026 · **Dayanak:** `main@f1fd00888eb0bfac5e47a5d70cdf4c127e827b16` ve Ziya'nın Kepenk ↔ Randevu topoloji kararı. Bu belge K01/K02/K03 gibi **bağlayıcı tasarım sözleşmesidir**; uygulanmış tablo veya API iddiası değildir. Uygulama sırası [Kepenk Core geçiş planında](kepenk-core-migration-plan.md) tanımlıdır.

## Karar

| Katman | Canonical yer | Not |
| --- | --- | --- |
| User, Business, Membership | Bugünkü Randevu Supabase projesi — `public.profiles`, `public.businesses`, `public.memberships` | Fiziksel yer değişmez; sahiplik "platform çekirdeği" olarak yeniden adlandırılır |
| Subscription, Entitlement, Usage, alias eşlemeleri | Aynı veritabanında yeni `core` şeması | PostgREST'e açılmaz; yalnız `public.*` RPC ile erişilir |
| Booking, müşteri CRM, personel, takvim, adisyon, stok | Aynı veritabanında mevcut `public` booking tabloları | Randevu Kolay domaini; canonical `business_id`'yi kullanır |
| Firestore | Projection / önbellek / legacy uyumluluk | Yetki kararı hiçbir zaman projection'dan verilmez |
| Firebase Auth | Geçici kimlik adaptörü, **oturum üretim noktasında** | Veritabanı Firebase JWT'sine güvenmez |
| Kepenk ServicePrincipal / AdminPrincipal | Platform operasyon kimlikleri | Business membership'in yerine geçmez; tenant yetkisi Postgres'tedir |

## Değişmezler

1. **Tek veritabanı.** Core ve booking aynı PostgreSQL veritabanında yaşar. Ayrım şema, sahiplik ve writer-token seviyesindedir; veritabanı/servis bölmesi ancak ölçülmüş ihtiyaç ve ayrı bir kararla yapılır. Gerekçe: composite FK `(business_id, id)`, `is_active_member` RLS'i ve SECURITY DEFINER RPC'ler aynı veritabanını varsayar.
2. **Mevcut tablo yerinden oynamaz.** `public.profiles`, `public.businesses`, `public.memberships` `SET SCHEMA` ile taşınmaz; onlarca RPC gövdesi bu adları `search_path = public` ile kullanır. "Terfi" etiket ve sahiplik değişimidir.
3. **FK yönü tek yönlüdür.** Booking tabloları core/kimlik tablolarına FK verebilir; `core.*` hiçbir booking tablosuna FK vermez ve booking tablolarına yazmaz.
4. **Tek `business_id`.** Platformda tenant kimliği `public.businesses.id` (uuid) olur. `esnafId`, Firebase UID ve benzeri kimlikler `core.tenant_aliases` / `core.identity_aliases` içinde **dış takma addır**, ikinci kimlik değildir.
5. **`auth.uid()` UUID'dir.** Kimlik zinciri `auth.users → public.profiles → public.memberships`tir; Firebase subject bu zincire giremez. Firebase adaptörü Kepenk sunucusunda çalışır ve karşılığında Supabase kullanıcısı/oturumu üretir.
6. **Tarayıcı token görmez.** Her private uygulama (`randevu.kepenk.ai`, `app.kepenk.ai`, ileride `manage.kepenk.ai`) kendi **host-only** HttpOnly cookie oturumunu sunucu tarafında kurar; parent-domain cookie yoktur. Recovery (`amr` içinde `recovery`) oturumu her uygulamada ve DB'de yalnız parola güncellemeye izin verir.
7. **Service-role yok.** Makine kimliği (ServicePrincipal) Core'a yalnız `public.core_apply_platform_command` gibi dar, secret-gated, idempotent, auditli RPC'lerle yazar; ham tablo yazımı yoktur. Secret rotasyonu Kepenk Credential Envelope'un işidir; DB tarafı overlap'li iki hash tanır.
8. **Komut ledger'ı.** `core.platform_commands` Faz 5 `booking_commands` değişmezini taşır: aynı `(principal, idempotency_key)` + aynı `request_hash` → aynı sonuç; farklı hash → `PLATFORM_IDEMPOTENCY_CONFLICT`. İkinci daha zayıf tekrar-koruma sistemi kurulmaz.
9. **Ticari geçmiş append-only'dir.** `core.subscription_events` UPDATE/DELETE ile düzeltilmez; düzeltme yeni olaydır. `core.subscriptions` ve `core.entitlements` olaylardan türeyen saklı durumdur ve yalnız komut RPC'si tarafından yazılır.
10. **Tek yetki primitive'i.** Uygulamalar entitlement'ı `public.has_entitlement(business_id, key)` ile sorar; F10-02 `has_financial_permission` deseniyle aynı sınıftır (standard-session guard + aktif membership). Randevu RPC'leri de aynı fonksiyonu çağırır; ikinci izin modeli yoktur.
11. **Projection yetki üretmez.** Firestore'daki membership/plan kopyası okuma modelidir; Firestore rule'ları veya Kepenk kodu bu kopyadan yetki kararı vermez.
12. **Müşteri master'ı Randevu'dadır.** Randevu-vertical tenantlarda salon müşterisinin kimliği `public.customers` (F10-05 canonical resolver) içindedir; Kepenk CRM/WhatsApp AI referans verir, ikinci müşteri master'ı kurmaz.
13. **Ticari kota ≠ kötüye kullanım sınırı.** S04/K03 rate/quota sayaçları abuse kontrolüdür; Core entitlement/usage ile birleştirilmez.
14. **Plan fiyatı kodda yaşamaz.** Plan anahtarları, limitler ve fiyatlar `core.plan_entitlements` / ürün kararıyla gelir; kilitlenmemiş fiyat kodda veya arayüzde gerçekmiş gibi gösterilmez.
15. **Yeni nesne kapısı.** Her `core.*` ve `public.core_*` nesnesi S08 disiplinine tabidir: explicit grant, RLS enable+force (tablo/view), `authenticated`/`anon` için UPDATE/DELETE grant yok, forward-only migration, clean + upgrade lane, Randevu CI planına kayıt.
16. **Tek migration zinciri, tek writer token.** Core migration'ları Randevu reposunun zincirine girer ve CONTRIBUTING / validation budget / R1 kurallarına tabidir. Core sözleşmesi migration'ların yaşadığı yerde tek kopyadır; Kepenk reposu ona referans verir.
17. **Kilit sırası.** Core komutları: işletme advisory lock `hashtextextended(business_id::text, 0)` → `core.subscriptions` satırı `FOR UPDATE` → olay ekleme → entitlement upsert. Booking RPC'leri core satırlarını kilitlemez; core komutları booking satırlarına dokunmaz.
18. **Kimlik ve ticari yetki STRICT'tir.** Bu sözleşmeye dokunan her migration/RPC STRICT validation budget ile ilerler (R1 zorunlu; R2 yalnız browser davranışı kritikse; staging yalnız hosted Auth/JWT davranışı gerekiyorsa).

## Kabul örnekleri

- Aynı `esnafId` iki kez alias'lanamaz; farklı `business_id`'ye bağlama girişimi fail-closed olur.
- Aynı ödeme olayının tekrarı ikinci abonelik olayı üretmez; farklı payload aynı anahtarla reddedilir.
- Entitlement revoke sonrası açık formdan yazım bir sonraki istekte reddedilir; arayüzde buton gizlemek yeterli değildir.
- Firebase subject ile doğrudan Data API çağrısı hiçbir Core/booking RPC'sinden geçmez.
- Recovery oturumu `has_entitlement` ve `get_business_platform_snapshot` dahil hiçbir Core read'ini yapamaz.
- `core` şeması PostgREST üzerinden görünmez; `anon`/`authenticated` `core.*` tablolarına SELECT yapamaz.
- Firestore projection kasıtlı olarak eskitildiğinde yetki kararı değişmez.

## Karar değişikliği kuralı

Uygulayıcı bu sözleşmeyle çelişen durum bulursa kanıt, en dar seçenek ve etkilenen görevleri koordinatöre iletir; sözleşme sessizce değiştirilmez. Veritabanı bölme, parent-domain cookie, service-role veya Firebase JWT'ye DB güveni önerileri ölçülmüş ihtiyaç ve R1 görüşü olmadan kabul edilmez.
