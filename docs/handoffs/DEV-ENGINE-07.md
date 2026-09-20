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
- `run-once.mjs`: GitHub snapshot, Depot tek-koşu yönetimi, Qwen danışma, guarded
  action planı ve disposable rapor.
- `depot-full-ci.yml`: immutable placeholder'lı full shadow CI şablonu.
- `config.example.json`: secretsiz, makineden bağımsız, shadow varsayılan.
- `install-local.mjs`: mevcut config'i koruyan macOS yerel kurucu.
- `tests/qwen-coordinator-*.test.mjs`: policy, Depot ve kurulum gerileme testleri.
- `docs/runbooks/qwen-coordinator.md`: kurulum, opt-in, izleme ve rollback.

## Açık kabul

- Yerel syntax/unit/docs/typecheck/build doğrulaması.
- Secret ve sabit kullanıcı yolu taraması.
- Commit/push sonrası exact-head GitHub CI.
- Değişiklik güvenlik/yönetişim aracı olduğu için bağımsız CI/governance incelemesi.
- Coordinator kabulü, merge ve post-main CI.

## Sonraki tek adım

Yerel doğrulamayı çalıştır; sonuç başarılıysa exact branch head'ini commit/push
edip draft PR aç ve TASKS satırını PR/head/CI kimliğiyle güncelle.
