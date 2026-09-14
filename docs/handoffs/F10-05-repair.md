# F10-05 — Customer authority forward repair

**Durum:** Main'de / kabul açık — R1 + R2 blocker repair'i uygulanıyor.  
**Base:** `main@5e789ad06ffc46e9bed62004ed098f4e09a4640d`  
**Branch:** `f10-05-customer-authority-repair`  
**Önceki merge:** PR #74 / main `6c522893655ab1cdfb8da2a9b8d2974772a1c2ae`  
**R1 blocker receipt:** Issue #65 `5664935223`  
**R2 browser receipt:** Issue #65 `5665241722` + mobile addendum `5665499575`

Bu dosya mevcut `docs/handoffs/F10-05.md` tarihsel teslim kaydını silmez. Merge sonrası bulunan blocker'ların forward-repair kapsamını izole eder.

## Repair kapsamı

- `customers` ve `appointments` raw authenticated Data API SELECT yüzeyini kapatma,
- doğrudan `create_appointment` RPC'sini standard-session/recovery guard arkasına alma,
- CRM/operator/public customer create/resolve yollarını tek TR telefon + e-posta canonicalization ve aynı business advisory lock sözleşmesine bağlama,
- booking sırasında mevcut CRM master kaydını sessizce güncellememe; request değerlerini yalnız appointment snapshot'a dondurma,
- CRM↔public ve CRM↔operator gerçek iki bağlantılı yarış testleri,
- `/customers` list/history loading/empty/error/success durumlarını ayrıştırma,
- iki işletme stale list/history browser akışı,
- 360/390 shared nav erişilebilirliği, ≥44 px customer touch targets ve visible keyboard focus,
- recovery UI'da private customer read yapılmadığını gerçek Chrome kabulünde doğrulama.

## Değişmezler

- Historical migration editlenmez; yalnız forward migration.
- Service-role browser/backend yolu eklenmez.
- Appointment customer snapshot geçmişi immutable kalır.
- CRM explicit edit ayrı yüzeydir; booking master customer kaydını güncellemez.
- Aynı canonical contact farklı tenantlarda bağımsızdır.
- F10-05 final `Tamamlandı` ancak exact-head full CI + R1 ACCEPTABLE + R2 ACCEPTABLE + coordinator kabulü sonrası geri gelir.
