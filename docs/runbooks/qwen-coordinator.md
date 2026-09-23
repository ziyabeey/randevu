# Yerel Qwen koordinatörü runbook'u

Bu runbook, `scripts/qwen-coordinator/` altındaki repo kaynağından yerel servisi
yeniden kurma, güvenli biçimde etkinleştirme, gözlemleme ve geri alma adımlarını
tanımlar. Bu araç bir ürün özelliği veya ikinci görev/veri otoritesi değildir.

## Değişmez sınırlar

- Canlı görev ve kabul durumu yalnız `TASKS.md` içindedir.
- GitHub `CI gate` zorunlu kabul kanıtıdır; Depot koşusu paralel shadow kanıtıdır.
- Qwen yalnız exact aynı head için GitHub ve Depot başarılı olduğunda danışmanlık
  yapar. Model kararı deterministik `WAIT/REPAIR/REVIEW/MERGE` sınırını yükseltemez.
- Head/base, file listesi, thread, receipt veya remote veri kesik/belirsizse sistem
  fail-closed kalır.
- R1/R2 yalnız birbirinden ayrık rol allowlist'lerinde bulunan, PR yazarı olmayan
  kimliklerin exact PR/head/base marker'larıyla kabul edilir.
- Secret, model ağırlığı, etkin config, log, rapor, lock ve runtime state Git'e
  girmez.
- DEV-ENGINE-06 audit/metadata kapıları bu aracın içinde yeniden tanımlanmaz.
  Koordinatör GitHub'ın ürettiği kanıtı okur; repository CI kapsamını değiştirmez.

## Veri akışı

1. LaunchAgent runner'ı 15 saniyede bir uyandırır.
2. Runner boşta en fazla dakikada bir, yalnız canlı TASKS'e bağlı aktif CI varken
   30 saniyede bir GitHub snapshot'ını yeniler. Başka/eşleşmemiş PR'lardaki aktif
   check'ler hızlı modu açmaz.
3. Canlı `TASKS.md` satırıyla eşleşen, docs-only olmayan exact PR head için en
   fazla bir Depot shadow koşusu başlatılır.
4. GitHub ve Depot terminal sonucuna gelene kadar Qwen çağrılmaz.
5. Dual-green candidate için Qwen A/B/C/D seçimi üretir; deterministic policy bu
   seçimi daha güvenli bir seviyeye sınırlayabilir.
6. `shadow` modda yalnız yerel rapor yazılır. `guarded` modda bile dış yazım,
   genel ve eylem-bazlı opt-in bayrakları olmadan kapalıdır.

## Kurulum ve güncelleme

Önkoşullar: macOS kullanıcı oturumu, Node.js, authenticated `gh`, yerel Qwen'in
OpenAI-compatible `http://127.0.0.1:8080` endpoint'i ve Depot kullanılacaksa
authenticated Depot CLI.

Repo kökünde:

```bash
node scripts/qwen-coordinator/install-local.mjs \
  --repo-root "$PWD" \
  --depot "$HOME/.local/bin/depot" \
  --depot-org YOUR_DEPOT_ORG_ID
```

Kurucu kaynak dosyalarını `~/.local/share/qwen-coordinator/` altına kopyalar,
`~/.local/bin/qwen-coordinator-{now,status,actions}` komutlarını ve
`~/Library/LaunchAgents/ai.yzt.qwen-coordinator.plist` dosyasını üretir. Var olan
`config.json` varsayılan olarak korunur. `--replace-config` kullanılırsa önce
zaman damgalı yedek alınır ve yeni config shadow/read-only başlar.

Yeni kurulumda `config.json` içindeki repo slug/root, CLI yolları ve endpoint
kontrol edildikten sonra ilk tur elle çalıştırılır:

```bash
qwen-coordinator-now
qwen-coordinator-status
qwen-coordinator-actions
```

Rapor doğru exact PR/head/base değerlerini gösteriyorsa LaunchAgent yüklenir:

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/ai.yzt.qwen-coordinator.plist" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/ai.yzt.qwen-coordinator.plist"
launchctl print "gui/$(id -u)/ai.yzt.qwen-coordinator"
```

## CI ortamını prewarm etme

GitHub'ın zorunlu `CI gate` işi temiz hosted runner üzerinde kalır. Bu yüzden
güvenlik/izolasyon korunurken tekrar eden hazırlık maliyeti iki yerde azaltılır:

1. GitHub CI, Ubuntu 24.04 runner'da zaten bulunan `psql` istemcisini kullanır;
   yalnız gerçekten yoksa apt fallback çalışır. `npm ci` ile `postgres:17`
   container launch aynı step içinde paralel yürür, ardından server major sürümü
   17 olarak fail-closed doğrulanır.
2. Depot shadow CI için opsiyonel custom image Node 24 toolcache'i,
   `postgresql-client` ve önceden çekilmiş `postgres:17` katmanlarını snapshot
   olarak taşır. `npm ci` ve disposable veritabanı her koşumda yine temiz çalışır.

İlk veya image yenileme koşumu:

```bash
qwen-coordinator-build-ci-image
```

Komut önce `depot ci migrate preflight` ile mevcut `ziyabeey/randevu` Code
Access yetkisini doğrular. Repo transferi sonrası Depot GitHub App erişimi eksikse
Depot'un bastığı yetkilendirme bağlantısı tamamlanmadan image build veya shadow CI
başlatılmaz. Preflight geçerse `depot-build-ci-image.yml` Depot üzerinde çalışır,
snapshot tamamlandıktan sonra local config'te `depotCustomImageEnabled=true`
atomik olarak açılır.

Custom image adı local `depotOrgId` üzerinden deterministik üretilir:
`<org>.registry.depot.dev/randevu-ci:node24-pg17-v1`. Org kimliği güvenli biçim
kontrolünden geçmezse workflow üretilmez. Image hazır değilse
`depotCustomImageEnabled=false` bırakılarak standart
`depot-ubuntu-24.04-16` fallback'i kullanılır.

Image'ın yeniden üretilmesi gereken durumlar: Node major/toolchain değişikliği,
PostgreSQL client ihtiyacının değişmesi veya `postgres:17` tabanının bilinçli
yenilenmesi. Uygulama bağımlılıkları image'a gömülmez; `npm ci` lockfile
doğrulaması her candidate'da korunur.

## Yapılandırma ve opt-in sırası

| Kontrol | Güvenli başlangıç | Açılma koşulu |
| --- | --- | --- |
| `mode` | `shadow` | Gerçek PR shadow pilotu doğruysa `guarded` |
| `depotShadowEnabled` | `false` | Org, CLI ve exact-SHA identity smoke doğrulanırsa `true` |
| `writeActionsEnabled` | `false` | Dış yazma açıkça istenirse `true` |
| `autoReadyEnabled` | `false` | Task/CI/base/thread kapıları pilotta doğrulanırsa |
| `autoMergeEnabled` | `false` | En son; tüm exact-head receipt ve ruleset kanıtı doğrulanırsa |
| `coordinationCommitsEnabled` | `false` | Post-main closeout akışı ayrıca kabul edilirse |

Bir eylem için `mode=guarded`, `writeActionsEnabled=true`, ilgili eylem bayrağı
ve `allowedAutomaticActions` girdisi birlikte gerekir. Bir turda en fazla
`maxActionsPerRun=1` korunur.

R1/R2 başlatma yerel koordinatörün yazma yetkisi değildir. Bu roller yalnız
canonical `Development Review Automation` → reusable `Development Review Router`
akışında, configured rol endpoint'leri ve exact CI checkout/run/job/attempt
provenance ile başlatılır; yerel koordinatör yalnız sonuç receipt'lerini gözler.

Depot koşusu ayrıca `run_exact_sha_depot_shadow_ci` capability girdisini ister.
Terminal Depot yorumunun GitHub'a yazılması
`update_single_depot_evidence_comment` girdisine ve
`writeActionsEnabled=true` değerine bağlıdır; böylece shadow/read-only kurulum
yanlışlıkla PR yorumu yazmaz.

## İzleme ve arıza davranışı

- Son insan-okur raporu: `qwen-coordinator-status`
- Son JSON: `~/.local/share/qwen-coordinator/reports/latest.json`
- Aksiyon kuyruğu: `qwen-coordinator-actions`
- Olay günlüğü: `~/.local/share/qwen-coordinator/logs/coordinator.jsonl`
- LaunchAgent stderr: `~/.local/share/qwen-coordinator/logs/coordinator.err.log`

Masaüstü bildirimleri PR + exact head + karar/aksiyon anahtarıyla runtime state
içinde en fazla 200 olaylık ledger'da tekilleştirilir. Aynı head aynı kararda
kaldığı sürece raporun başka kısmı değişse bile tekrar bildirim verilmez.
`rateLimitRemaining <= 1000` olduğunda GitHub poll aralığı en az 5 dakikaya,
`<= 250` olduğunda en az 15 dakikaya çıkar. Eşikler config ile ayarlanabilir.
Koordinasyon issue'sunun eski yorum sayfaları her tur yeniden indirilmez: geçmiş
kesikse yalnız bu kaynaktan R1/R2 receipt'i tüketebilecek PR'lar fail-closed
kalır; R0-only PR'lar ilgisiz yorum geçmişi yüzünden ek API sayfası tüketmez.

Qwen ulaşılamazsa deterministik gözlem sürer ve AI aksiyonu üretilmez. Depot
identity uyuşmazsa kanıt geçersizleşir. GitHub/Depot çelişkisinde sonuç `WAIT`
olur ve merge kapalı kalır. Depot'un `pass` dışındaki hiçbir terminal/ara durumu
merge kanıtı değildir. Stale lock ancak sahibi olan PID'nin artık yaşamadığı
kanıtlanırsa devralınır; her tur yalnız kendi lease token'ına ait kilidi
bırakabilir. Aynı anda çalışan ikinci tur sessizce atlanır.

Depot başlatma öncesinde runtime state'e kalıcı bir launch reservation yazılır.
API çağrısından sonra run kimliği alınamazsa kayıt `launch-uncertain` kalır;
koordinatör bu kaydı aktif sayar ve otomatik retry ile ikinci bir koşu başlatmaz.
Operatör Depot tarafını doğrulamadan bu durum elle temizlenmez.

## Acil durdurma ve geri dönüş

En hızlı güvenli geri dönüş config içinde `mode=shadow` ve
`writeActionsEnabled=false` yapmaktır. Süreci tamamen durdurmak için:

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/ai.yzt.qwen-coordinator.plist"
```

Bu işlem repo kaynağını veya runtime kanıtlarını silmez. Güncelleme sorunluysa
kurucunun oluşturduğu `config.json.backup-*` dosyasından ayar elle geri alınır ve
önce `qwen-coordinator-now` ile tek tur doğrulanır.

## Doğrulama

```bash
node --check scripts/qwen-coordinator/policy.mjs
node --check scripts/qwen-coordinator/depot.mjs
node --check scripts/qwen-coordinator/lease.mjs
node --check scripts/qwen-coordinator/run-once.mjs
node --check scripts/qwen-coordinator/install-local.mjs
node --test tests/qwen-coordinator-*.test.mjs
npm run test:docs
git diff --check
```

Kod/CI kapsamı değişikliği olduğu için repository exact-head full CI ayrıca
zorunludur. Yerel test sonucu merge yetkisi vermez.
