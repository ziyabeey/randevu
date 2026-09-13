# GS — Stabilization kapısı kapanış devri

**Kapanış tarihi:** 13 Eylül 2026  
**Kapanış öncesi main:** `ec8f307d1bb8d217990c71433d28324c1b27c489`  
**Kapsam:** S01…S08 teknik düzeltmelerinin kabulü ve yeni özellik kodu önündeki GS kapısının kapanışı.

## Sonuç

S01…S08 kendi kart kabul ölçütleriyle tamamlandı. Bu kapanış kaydı main'e girdiğinde **GS kapalıdır** ve GS önkoşullu ürün görevleri, kendi diğer bağımlılıkları sağlandığı ölçüde yeniden başlayabilir.

Bu kayıt eski kabul kanıtlarının kapsamını büyütmez. S07 ve S08 sonrasında adlandırılan takipler yeni bir stabilization görevi açmaz ve GS'yi yeniden açmaz; aşağıdaki gerçek sahip görevlerine taşınır.

## S07 final kabul

S07 runtime bütçeleri, operasyonel veri ömrü ve belirsiz public booking sonucunun kesinleştirilmesi şu paketlerle tamamlandı:

- Bildirim timeout / bağımsız bakım: PR #47, staging #20.
- V2 sunucu kesinleştirme: PR #50.
- V2 istemci + IndexedDB + ortak HTTP: PR #51.
- C1 terminal bildirim PII retention: PR #53.
- C2a keyset pagination + DB budget: PR #55.
- C2b atomik snapshot overflow sınırları: PR #56.
- C3 sentetik örnek yük ölçümü: PR #58.
- C4 exact-head gerçek staging kapanışı: PR #60.

PR #60 kabul head'i `61b6a2a8ae79dd83b59b1d3b88f354f9fc5bb06e`; required CI #512 / run `34772317665` başarılıdır. Staging deploy #23 / run `34772665661` aynı head üzerinde routine deploy → gerçek F09 → güncel F10 → gerçek S01 mailbox/PKCE → S07 retention/pagination/snapshot/load paketini sonuna kadar geçirdi.

Kabul run'ındaki yük fişleri:

- `catalog_snapshot`: warmup=3, samples=30, rows=5200, db_calls=30, p50=35.235 ms, p95=41.779 ms, errors=0.
- `booking_page`: warmup=3, samples=30, fixture_rows=2500, rows=101, db_calls=30, p50=0.273 ms, p95=0.395 ms, errors=0.

Final readback `pending=0` gösterdi ve Worker source commit kabul head'iyle eşleşti. PR #60 main merge commit'i `4f928de0983e3f0c19b6eaa361d0a9ac6223d998`; merge sonrası main CI #514 / run `34772950351` başarılıdır.

### S07 adlandırılmış açık takipler

Bunlar S07 kabulünü veya GS kapanışını bozmaz:

1. **C4 runner operational hardening — F17-03.** Routine staging deploy'da F09/F10/S01 üçlü kabul isteği tam değilse C4 çalışmaz. Gelecek yayın hazırlığında yüksek sesli `S07_C4_SKIPPED reason=...` receipt'i, receipt'i de assert eden davranışsal truth-table testi ve explicit C4 intent + eksik alt gate için fail-closed davranış eklenmelidir. `staging-s07-acceptance` hata raporu URI/credential redaksiyonunu koruyan bounded diagnostic tail vermeli; timeout, ENOBUFS, process spawn, psql exit ve SQL assertion birbirinden ayrılmalıdır.
2. **Mutable-key pagination concurrency — F13-01/F13-02.** S07 keyset kabulü, dışarıdan eşzamanlı sıralama-anahtarı mutasyonu olmayan veri kümesinde `(timestamp,id)` düzenini atlama/tekrar olmadan yürütür. Sayfalar arasında `starts_at` / `created_at` değişirse snapshot-consistency garantisi verilmez. Böyle bir test C4 transaction paketine taşınmaz; gerçek eşzamanlı yazar / liste-güncellik semantiği F13-01/F13-02 kapsamıdır. Tarih aralığı parametresi de F13-02 ürün/list view sözleşmesinde tamamlanır.

## S08 final kabul

S08 future DB object access gate PR #64 ile main'e girdi. Kabul edilen implementation head'i `67e9b46789ae1006aa04ad8c7ad6631c9fc4d851`; exact-head CI #520 / run `34775018893` başarılıdır. Clean ve upgrade PG17 zincirleri future table/view/sequence/function deny-by-default davranışını, explicit authenticated grant + RLS pozitifini, cross-Business ve staff/manager negatiflerini ve post-S04 ACL regresyonunu doğruladı.

PR #64 merge commit'i `ec8f307d1bb8d217990c71433d28324c1b27c489`; merge sonrası main CI #521 / run `34776825842` başarılıdır.

Hosted kabul ayağı routine Staging deploy #24 / run `34777601528` ile tamamlandı. Run exact `main@ec8f307d1bb8d217990c71433d28324c1b27c489` üzerinde `20260913201500_s08_db_object_access_gate.sql` migration'ını gerçek staging DB'ye uyguladı, smoke ve S05 deployment consistency kabulünü geçti.

Migration sonrası salt-okunur `pg_default_acl` readback:

- `current_user = postgres`, `session_user = postgres`.
- S08'in yasakladığı default grant sayısı: **0**.
- global future function: `{postgres=X/postgres}`.
- `public` future table: `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`.
- `public` future sequence: `{postgres=rwU/postgres,service_role=rwU/postgres}`.
- `public` future function: `{postgres=X/postgres,service_role=X/postgres}`.

Böylece `anon` ve `authenticated` future table/view, sequence ve function object privilege varsayılanlarından gerçekten çıkmış; global `PUBLIC EXECUTE` future function varsayılanı da kapalıdır.

### S08 kapsam sınırları

- Gate creator-role scoped'dur: bugün hosted migration oturumu `postgres` olduğu doğrulandı. Migration rolü değişirse default ACL kapısı ayrıca yeniden doğrulanmalıdır.
- Global function `PUBLIC EXECUTE` revoke `public` schema ile sınırlı değildir; `postgres` tarafından başka schema'da yaratılan future function'ları da etkiler. Bu genişlik bilinçli güvenlik yönüdür ve sonraki migration'larda görünür tutulur.
- “Deny by default” yalnız API rolleri `anon` ve `authenticated` içindir. `service_role` bu dar S08 kabulinin kapsam dışı sunucu rolüdür.
- Supabase exposed schema listesi ileride `public` dışına genişletilirse S08 o yeni schema'yı otomatik korumaz. Bu yayın/ortam envanteri F17-03'te kontrol edilir.

## GS sonrası sıra

- **F10-02:** mevcut PR #32 ve mevcut sahiplik korunur. GS kilidi kalkmıştır; ayrı ikinci branch açılmaz. Uygulama başlamadan branch güncel GS-kapalı main'e taşınır ve devir kaydı güncellenir.
- **F12-01:** tasarım-only PR #61 teknik GS kapısından muaf tarihsel çalışma olarak taslakta kaldı; S08 sonrası merge sırasındaki yerini korur. Koordinatör son ürün/tasarım kontrolünden sonra güncel main'e taşınmış exact-head CI ile kabul eder. F12-02+ artık yalnız kendi normal bağımlılıklarını bekler; GS teknik engeli yoktur.
- F17-03, S07 runner hardening ve S08 environment/exposed-schema gözlemini yayın/izleme hazırlığında taşır.

## Kapanış kuralı

Bu dosya, `TASKS.md` içindeki S07/S08/GS satırları ve `PROJECT_STATE.md` aynı docs-only closeout head'inde yeşil CI aldıktan sonra GS'nin kalıcı kapanış kaydıdır. Runtime/migration davranışı bu closeout turunda değiştirilmez.
