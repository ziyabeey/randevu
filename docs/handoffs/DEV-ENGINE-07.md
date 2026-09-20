# DEV-ENGINE-07 devir

## Kimlik ve kapsam

- Görev: [DEV-ENGINE-07 / Issue #206](https://github.com/ziyabeey1-ai/randevu/issues/206)
- Boyut / mod: M / FOCUSED
- Başlangıç main: `8421bf4b`
- Branch: `chore/dev-engine-07-qwen-coordinator`
- Yazım alanı: `scripts/qwen-coordinator/**`,
  `tests/qwen-coordinator-*.test.mjs`, `docs/runbooks/qwen-coordinator.md`, bu
  devir, `.gitignore` ve görev satırı.
- Kapsam dışı: ürün kodu, migration, GitHub workflow/ruleset, DEV-ENGINE-06
  dosyaları, model ağırlıkları, tokenlar, etkin config, log ve runtime state.

## Korunan sözleşmeler

- `TASKS.md` tek canlı görev otoritesi olarak kalır.
- Qwen danışmandır; deterministic policy sonucunu yükseltemez.
- GitHub `CI gate` zorunludur; Depot yalnız paralel shadow kanıtıdır.
- Qwen çağrısı yalnız exact aynı PR head için GitHub + Depot success sonrasında
  mümkündür.
- Belirsiz/kesik remote evidence, stale base/SHA, açık thread, merge conflict veya
  rol provenance eksikliği fail-closed kalır.
- Yeni kurulum shadow/read-only başlar. Guarded dış yazma ve otomatik merge ayrı,
  açık opt-in olmadan etkinleşmez.

## Teslim edilen kaynak

- `policy.mjs`: TASKS eşleme, exact CI, surface/risk, receipt ve A/B/C/D policy.
- `depot.mjs`: exact-SHA eligibility, status normalize, identity/conflict ve Qwen
  çağrı eligibility kuralları.
- `lease.mjs`: PID yaşam kanıtlı stale recovery ve owner-token bağlı release.
- `run-once.mjs`: GitHub snapshot, Depot tek-koşu yönetimi, Qwen danışma, guarded
  action planı ve disposable rapor.
- Bildirimler PR + exact head + karar/aksiyon kimliğiyle 200 olaylık kalıcı
  ledger'da tekilleştirilir; ilgisiz fingerprint değişimi aynı uyarıyı tekrarlamaz.
- GitHub polling yalnız TASKS'e bağlı aktif PR'larda hızlanır ve düşük/kritik rate
  limit eşiklerinde sırasıyla en az 5/15 dakikaya fail-safe geri çekilir.
- Kesik koordinasyon-issue geçmişi yalnız R1/R2 receipt'i tüketen PR'ı bloke
  eder; R0-only PR için ilgisiz eski sayfalar yeniden çekilmez.
- `depot-full-ci.yml`: immutable placeholder'lı full shadow CI şablonu.
- `config.example.json`: secretsiz, makineden bağımsız, shadow varsayılan.
- `install-local.mjs`: mevcut config'i koruyan macOS yerel kurucu.
- `tests/qwen-coordinator-*.test.mjs`: policy, Depot, kurulum ve lease gerileme
  testleri.
- `docs/runbooks/qwen-coordinator.md`: kurulum, opt-in, izleme ve rollback.

## Güncel doğrulama

- 20/20 coordinator unit testi başarılı.
- Repo HTTP testleri 68 dosyada 818/818 başarılı.
- CI coverage, docs, typecheck ve build başarılı.
- İnceleme onarımları: exact-head-only Depot checkout, non-empty workflow/job/
  attempt başarı kanıtı, tüm non-pass Depot durumlarında fail-closed merge,
  shell-safe wrapper quoting, owner-token lease ve incomplete remote snapshot'ta
  koşu iptal etmeme.
- Exact-head GitHub CI, Depot shadow CI ve fresh bağımsız CI/governance incelemesi
  güncel commit üzerinde yeniden alınacak.

## Sonraki tek adım

Onarım commitini pushla; exact-head GitHub CI ve Depot shadow CI başarılarından
sonra fresh bağımsız incelemeyi alıp açık thread'leri kapat.
