# DEV-ENGINE-07 devir

## Kimlik ve kapsam

- Görev: [DEV-ENGINE-07 / Issue #206](https://github.com/ziyabeey1-ai/randevu/issues/206)
- Boyut / mod: M / FOCUSED
- Başlangıç main / task claim: `86d1bfdd729577ebd9ab3f47d1273219b1afe8f0`
- Branch: `chore/dev-engine-07-qwen-coordinator`
- PR / current repair code candidate: [#208](https://github.com/ziyabeey1-ai/randevu/pull/208)
  · head `66f734a59777ac4d0e13167be2fb006ba84453e4`
  · base `4909c06143a89ef0c40f2c27e63c970a42a52e81`.
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
  Stale takeover/release önce atomic ownership claim ile eski lease'i quarantine
  eder; eşzamanlı iki recovery yalnız tek kazanan üretir.
- `run-once.mjs`: GitHub snapshot, Depot tek-koşu yönetimi, Qwen danışma, guarded
  action planı ve disposable rapor.
- Qwen sonuçları positional sıraya değil exact PR numarası anahtarına bağlıdır;
  TASKS satır sınırı ve tam review/comment gövdesi receipt değerlendirmesinde
  fail-closed korunur.
- TASKS evidence tam uzunlukta tutulur; R1/R2 bütçesi evidence alanından değil
  owner/assignment dahil full canonical satırdan okunur. Review-kaynaklı
  specialist receipt native commit OID olmadan kabul edilmez.
- Depot dış çağrısından önce durable launch reservation yazılır; belirsiz çağrı
  sonucu aktif kalır ve otomatik tekrar koşusu başlatmaz.
- R1/R2 launch yetkisi local daemon'dan kaldırılmıştır; configured rol endpoint'i
  ve exact CI provenance canonical repository review workflow'unda kalır.
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

- `node --test tests/qwen-coordinator-*.test.mjs`: 29/29 başarılı.
- Güncel main entegrasyonu sonrası repo HTTP testleri 72 dosyada 877/877
  başarılı.
- CI coverage, docs, typecheck ve build başarılı.
- İnceleme onarımları: exact-head-only Depot checkout, non-empty workflow/job/
  attempt başarı kanıtı, tüm non-pass Depot durumlarında fail-closed merge,
  shell-safe wrapper quoting, owner-token lease ve incomplete remote snapshot'ta
  koşu iptal etmeme.
- macOS zsh wrapper testi darwin'de gerçek shebang, Linux CI'da aynı POSIX shell
  quote sözleşmesi `/bin/sh` üzerinden çalıştırılarak doğrulanır.
- Predecessor reviewed head `305c904a0cceb89b8f2bd16f1e9a081b0dfe391c`:
  exact-head CI run `35500844512`, job `106052216068`, attempt `1`, tested
  checkout aynı full SHA ve Depot `h9n2mpjxxj` aynı head/base üzerinde PASS.
- Exact-head GitHub CI, Depot shadow CI ve fresh bağımsız CI/governance incelemesi
  `66f734a59777ac4d0e13167be2fb006ba84453e4` kod adayı üzerinde yeniden alınacak.

## Sonraki tek adım

Kod adayını ve bu receipt-only belge descendant'ını pushla; exact-head GitHub CI
ve Depot shadow CI başarılarından sonra fresh R0 verification alıp açık thread'leri
kapat.
