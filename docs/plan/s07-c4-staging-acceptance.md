# S07-C4 — Exact-head gerçek staging kabulü

**13 Eylül 2026. Başlangıç main:** `0b31888305553484664d33badc24387d66bfa972`.

C1 retention, C2 sayfalama/DB bütçeleri ve C3 sentetik p50/p95 ölçümü main'dedir ve merge sonrası CI yeşildir. C4 yeni ürün özelliği değildir; aynı kabul edilmiş code head üzerinde gerçek staging zincirini tamamlar ve ancak bütün kanıtlar geçerse S07 kapanabilir.

## Zorunlu exact-head zinciri

Tek staging workflow run'ı aynı `GITHUB_SHA` üzerinde aşağıdakileri kabul etmelidir:

1. `operation=deploy` routine staging deploy; secret rotasyonu yoktur.
2. Mevcut staging smoke.
3. Gerçek F09 acceptance açık: booking/recovery/idempotency/capability ve gerçek Resend delivery kanıtı.
4. Gerçek F10 hosted auth acceptance açık: Origin/CSRF, refresh rotation, güncel membership, signup/recovery/password rotation.
5. Gerçek S01 public recovery acceptance açık: gerçek Resend Receiving mailbox, PKCE, marker kaybı/onarımı, refresh, ikinci sekme, replay/invalid ve parola değişimi.
6. S07 C1/C2/C3 staging DB acceptance: yalnız sentetik transaction+rollback fixture ile retention, pagination/snapshot ve load measurement testleri staging PostgreSQL üzerinde çalışır.
7. Run sonunda pending key transition yoktur; staging fixtures bütünlüğü korunur; aktif Worker version/deployment exact workflow commit'ten gelir.

## S07 staging DB acceptance paketi

Routine deploy'un `accept()` fazında, smoke ve gerçek provider/auth gate'leri ile aynı rollback-orchestrated kabulun parçası olarak şu testler çalışır:

- `supabase/tests/s07_terminal_pii_retention.sql`
- `supabase/tests/s07_list_pagination.sql`
- `supabase/tests/s07_snapshot_overflow.sql`
- `supabase/tests/s07_load_measurement.sql`

Her dosya staging DB'ye `psql -v ON_ERROR_STOP=1` ile uygulanır. Testler kendi `BEGIN ... ROLLBACK` sınırlarını kullanır; persistent staging müşteri/fixture satırlarını silmez veya değiştirmez. Production verisi kullanılmaz.

### Retention kabulü

- 30 gün eşiğinin altındaki terminal PII korunur, üstündeki yalnız izin verilen terminal snapshot alanları scrub edilir.
- bounded 500 batch davranışı ve 501 fixture kanıtlanır.
- aktif lease/pending/recoverable materyal temizlenmez.
- scrub edilmiş notification işi tekrar dispatch edilebilir duruma getirilemez.

### Pagination/snapshot kabulü

- booking/event keyset continuation deterministik `(timestamp,id)` ile yürür; default 25 / max 100 sınırı korunur.
- timeout/DB hatası sahte boş başarılı listeye çevrilmez.
- 105-row calendar tam date-range sonucu korunur.
- authenticated katalog exact 100 hizmet / 100 personel / 5.000 eşleşmede tamdır; 101/101/5.001 atomik açık limit hatasıdır.
- public hizmet/personel snapshot'ı 101'inci satırı sessiz kırpmaz.

### Load receipt

C3 ölçüm dosyası staging runner/DB üzerinde tekrar iki grep-friendly receipt üretir:

`S07_C3_METRIC workload=catalog_snapshot ... errors=0`

`S07_C3_METRIC workload=booking_page ... errors=0`

Her workload 3 warm-up + 30 ölçüm örneği kullanır. Staging süreleri de production SLA veya kapasite garantisi değildir; yalnız bu staging run'ının gözlemidir. Mevcut 5 saniyelik DB safety budget veya C2 limitleri ölçüm için gevşetilmez.

## Gerçek mailbox

S01 input'u repo/secrete yazılmaz. Workflow dispatch sırasında mevcut Resend Receiving test mailbox'ı input olarak verilir. Mailbox değeri loglarda veya tracking docs'ta gereksiz tekrar edilmez; S01 acceptance zaten recipient eşleşmesini Resend receiving API üzerinden doğrular.

## Stop / retry kuralları

- Staging run davranış hatasıyla kırılırsa aynı head tekrar koşturulmaz; yeni commit + bütün ilgili CI/staging zinciri gerekir.
- Yalnız açıkça transient altyapı nedeni kanıtlanırsa exact same head retry edilebilir.
- C1/C2/C3 SQL testlerinden biri staging'de kırılırsa test kaldırılmaz, fixture küçültülmez, timeout/limit yükseltilmez.
- F09/F10/S01 optional flag'lerinden biri kapalı run S07-C4 kabulü sayılamaz.
- S07 DB acceptance deploy kabulundan sonra ayrı manuel kanıt gibi çalıştırılmaz; `accept()` içinde olmalıdır ki başarısızlık candidate kabulünü engellesin.
- `operation=rotate/resume/bootstrap` C4 değildir; routine `deploy` zorunludur.

## Uygulama paketi

C4 code PR'ı dar tutulur:

- `package.json`: tek `staging:s07-acceptance` komutu;
- yeni `scripts/staging-s07-acceptance.mjs`: sabit allowlistteki dört SQL dosyasını staging DB'ye sırayla `psql` ile çalıştırır; URI/SQL/secret hata çıktısına yansıtılmaz;
- `scripts/staging-deploy.mjs`: `accept()` içinde mevcut smoke/F09/F10/S01 sonrası S07 gate çağrısı;
- staging workflow contract/testleri: C4 run'ında F09/F10/S01'in açık olması ve S07 gate'in smoke/provider/auth kabulundan sonra, commit'ten önce bulunması doğrulanır.

Migration/runtime business behavior değiştirilmez. Yeni secret, ücretli kaynak veya production erişimi eklenmez.

## Rollback

Code PR merge edilmeden önce rollback yalnız script/package/deploy bağlantısını revert etmektir. Staging SQL acceptance persistent veri yazmadığı için veri rollback planı gerekmez. Candidate acceptance kırılırsa mevcut S05 deployment coordinator kanıtlı önceki Worker version'a geri dönüş kurallarını uygular.

## Kapanış kanıtı

S07 ancak aşağıdakiler birlikte mevcutsa `Tamamlandı` yapılır:

- C4 code PR exact-head required CI yeşil;
- aynı exact head ile routine staging run success;
- smoke + F09 + F10 + S01 adımları success;
- S07 staging DB acceptance success ve iki `S07_C3_METRIC` receipt'i;
- pending transition readback temiz, fixture sayısı beklenen, aktif deployment exact head;
- açık review thread yok;
- merge sonrası main CI yeşil;
- TASKS, PROJECT_STATE ve `docs/handoffs/S07.md` gerçek run/commit/metric kanıtıyla güncel.
