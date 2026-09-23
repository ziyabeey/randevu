# F10-05 — Customer authority forward repair

**Durum:** Tamamlandı / accepted on main — R1 ve R2 kabulü tamamlandı; repair PR #87 merge edildi.  
**Base:** `main@5e789ad06ffc46e9bed62004ed098f4e09a4640d`  
**Branch:** `f10-05-customer-authority-repair`  
**Repair PR:** #87 — merged  
**Önceki merge:** PR #74 / main `6c522893655ab1cdfb8da2a9b8d2974772a1c2ae`  
**R1 blocker receipt:** Issue #65 `5664935223`  
**R2 browser receipt:** Issue #65 `5665241722` + mobile addendum `5665499575`  
**Coordinator split-contact blocker:** PR #87 comment `5666667860`  
**Repair implementation head:** `58d57f08622d823dbedc0a79da0e5fdec7707a25`  
**Implementation CI:** #849 / run `34865722043` — success  
**Final semantic head:** `0f503e6`  
**Final test head:** `08be2296bea585f30b9ea4db537ac070edbe7230`  
**Final CI:** #938 / run `34878556411` — success  
**R1 final:** `5667991719` — ACCEPTABLE  
**R2 final:** `5673736447` — ACCEPTABLE  
**Merged main:** `56ef3be734369e329a30406ea8a66a5eb9ef5993`  
**Main CI:** #948 / run `34921413177` — success

Bu dosya mevcut `docs/handoffs/F10-05.md` tarihsel teslim kaydını silmez. Merge sonrası bulunan blocker'ların forward-repair kapsamını izole eder.

## Repair kapsamı

- `customers` ve `appointments` raw authenticated Data API SELECT yüzeyini kapatma,
- doğrudan `create_appointment` RPC'sini standard-session/recovery guard arkasına alma,
- CRM/operator/public customer create/resolve yollarını tek TR telefon + e-posta canonicalization ve aynı business advisory lock sözleşmesine bağlama,
- booking sırasında mevcut CRM master kaydını sessizce güncellememe; request değerlerini yalnız appointment snapshot'a dondurma,
- resolver'ı aynı lock altında distinct customer-id kümesiyle fail-closed yapma:
  - reuse `0` eşleşme → create,
  - reuse `1` eşleşme → aynı master'ı reuse,
  - reuse `>1` distinct eşleşme → `CUSTOMER_CONTACT_CONFLICT`,
  - CRM create herhangi bir contact eşleşmesinde → `CUSTOMER_CONTACT_EXISTS`,
  - legacy duplicate master durumunda arbitrary/recency winner seçmeme,
- split-contact negatifleri: telefon customer A'ya, e-posta customer B'ye aitse public ve operator booking appointment yaratmaz ve iki master'dan hiçbirini değiştirmez,
- pozitif aynı-customer phone+email reuse: public/operator booking aynı canonical master'ı reuse eder, master değişmez, request snapshot'a donar,
- CRM↔public ve CRM↔operator gerçek iki bağlantılı yarış testleri,
- `/customers` list/history loading/empty/error/success durumlarını ayrıştırma,
- iki işletme stale list/history browser akışı,
- 360/390 shared nav erişilebilirliği, ≥44 px customer touch targets ve visible keyboard focus,
- recovery UI'da private customer read yapılmadığını gerçek Chrome kabulünde doğrulama.

## Exact-head kanıtı

Implementation head `58d57f08622d823dbedc0a79da0e5fdec7707a25` için CI #849 başarılıdır. Aynı koşuda:

- typecheck + production/staging build geçti,
- dedicated gerçek Chrome F10-05 kabulü geçti: A↔B stale isolation, CRUD/history, mutually-exclusive states, recovery boundary, 360/390 touch/nav ve keyboard focus,
- HTTP/static contract `canonical resolver fails closed on split or legacy duplicate contacts` dahil F10-05 repair kontrollerini geçti,
- disposable PG17 clean + upgrade zinciri geçti,
- gerçek dblink customer concurrency receipt'i canonical customer reuse/serialization sözleşmesini geçti,
- split-contact ve legacy duplicate SQL negatifleri appointment/master mutation olmadan fail-closed geçti.

Bu handoff ile `TASKS.md` marker değişikliğinin açtığı review zinciri tarihsel olarak tamamlandı. Final test head `08be2296bea585f30b9ea4db537ac070edbe7230` CI #938'den geçti; ardından R1 ve R2 ACCEPTABLE receipt'leri alındı, PR #87 main `56ef3be734369e329a30406ea8a66a5eb9ef5993` olarak merge edildi ve main CI #948 başarılı oldu.

## Değişmezler

- Historical migration editlenmez; yalnız forward migration.
- Service-role browser/backend yolu eklenmez.
- Appointment customer snapshot geçmişi immutable kalır.
- CRM explicit edit ayrı yüzeydir; booking master customer kaydını güncellemez.
- Aynı canonical contact farklı tenantlarda bağımsızdır.
- Split/legacy ambiguity fail-closed olur; arbitrary customer winner seçilmez.
- `PROJECT_STATE.md` implementer tarafından değiştirilmez.

## Kabul kapanış receipt'i

F10-05 için daha önce açık olan final marker CI → R1 → R2 → coordinator merge zinciri tamamlandı. Durable canlı durum `main:TASKS.md` içinde **Tamamlandı** olarak kayıtlıdır; bu dosyadaki eski açık-kapı talimatları tarihsel candidate sürecine aittir.
