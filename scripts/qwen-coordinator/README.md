# Yerel Qwen koordinatörü

Bu dizin, yerel Qwen koordinatörünün secretsiz ve yeniden kurulabilir kaynak
kopyasıdır. Çalışan servis için kalıcı otorite değildir: `TASKS.md` tek canlı görev
otoritesi, GitHub `CI gate` zorunlu kabul kanıtı ve Depot yalnız shadow kanıtıdır.
Qwen sonucu danışmadır; deterministik bir kapıyı yükseltemez.

## Repo sınırı

Repoda bulunanlar:

- saf karar ve Depot kanıt reducer'ları;
- tek gözlem/aksiyon turu çalıştıran runner;
- immutable exact-SHA Depot workflow şablonu;
- **shadow/read-only varsayılanlı** örnek ayar;
- macOS LaunchAgent ve komut sarmalayıcılarını üreten kurucu;
- birim testleri ve operasyon runbook'u.

Repoda bulunmayanlar: GitHub/Depot tokenları, model ağırlıkları, etkin makine
ayarları, allowlist kimlikleri, loglar, raporlar, kilitler ve runtime state.

## Kurulum

macOS üzerinde repo kökünden:

```bash
node scripts/qwen-coordinator/install-local.mjs \
  --repo-root "$PWD" \
  --depot "$HOME/.local/bin/depot" \
  --depot-org YOUR_DEPOT_ORG_ID
```

Kurucu mevcut `~/.local/share/qwen-coordinator/config.json` dosyasını varsayılan
olarak korur. İlk kurulumda yazılan ayar `mode=shadow`,
`writeActionsEnabled=false`, `autoMergeEnabled=false` ve
`depotShadowEnabled=false` değerleriyle fail-closed başlar. `--replace-config`
mevcut ayarı zaman damgalı yedekledikten sonra sıfırlar; bilinçli kullanılmalıdır.

Önce elle doğrula:

```bash
qwen-coordinator-now
qwen-coordinator-status
```

Ardından LaunchAgent'ı kullanıcı oturumuna yüklemek için:

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/ai.yzt.qwen-coordinator.plist" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/ai.yzt.qwen-coordinator.plist"
```

15 saniyelik LaunchAgent turu her seferinde GitHub'a istek atmaz: runner boşta
60 saniye, yalnız canlı TASKS'e bağlı aktif GitHub/Depot CI varken 30 saniye
cache/poll aralığı uygular. GraphQL rate limiti 1000'in altına inerse 5 dakika,
250'nin altına inerse 15 dakika geri çekilir.
Koordinasyon issue'sundaki eski yorum sayfaları kesikse bu durum yalnız R1/R2
receipt'i gerektiren PR'ları bloke eder; R0-only PR'lar için ilgisiz geçmiş
sayfaları her poll'da çekilmez.

Masaüstü bildirimleri PR + exact head + karar anahtarıyla kalıcı olarak
tekilleştirilir. İlgisiz bir PR veya rapor fingerprint'i değiştiğinde aynı uyarı
yeniden gösterilmez; head veya karar değişirse yeni olay sayılır.

Depot sonucu yalnız non-empty workflow/job/attempt kanıtı terminal başarı
gösteriyorsa `pass` olur. Exact head dışındaki checkout, base drift ve `pass`
dışındaki her durum merge kapısını kapalı tutar. GitHub snapshot'ı eksik veya
ulaşılamazken çalışan shadow koşular iptal edilmez.
Depot API çağrısından önce diske yazılan launch reservation crash penceresinde
ikinci koşuyu engeller; çağrı sonucu belirsizse otomatik retry yapılmaz.

## Hızlı CI image'ı

Tekrarlanan Depot hazırlık maliyetini azaltmak için opsiyonel prewarmed image
oluşturulabilir. Kurulumdan sonra:

```bash
qwen-coordinator-build-ci-image
```

Komut önce Depot Code Access preflight çalıştırır. Repo transferinden sonra
`ziyabeey/randevu` yetkisi eksikse Depot'un verdiği yetkilendirme bağlantısı
tamamlanmadan devam etmez. Preflight geçince Node 24 toolcache, PostgreSQL client
ve `postgres:17` Docker katmanları snapshot'a alınır; başarılı build sonrasında
local config'te `depotCustomImageEnabled=true` açılır.

Bu image uygulama `node_modules` içeriğini taşımaz. `npm ci`, exact SHA/tree
kontrolü ve disposable PostgreSQL veritabanı her shadow koşuda yeniden çalışır.
Image kapalıyken standart `depot-ubuntu-24.04-16` fallback'i aynen korunur.

## Güvenli etkinleştirme sırası

1. Shadow raporlarını ve exact PR/head/base eşleşmesini doğrula.
2. Depot org/binary/workflow yollarını ayarla ve tek eşzamanlı koşu sınırını koru.
3. Gerekliyse yalnız PR yorum yazımını aç; ready/review/merge kapıları ayrı kalır.
4. R1/R2 allowlist'leri bağımsız, rol-bazlı ve birbirinden ayrık kimliklerle doldur.
5. Guarded eylemleri ancak gerçek PR üzerinde shadow pilot kanıtından sonra aç.

Yerel koordinatör R1/R2 isteği yazmaz veya sağlayıcı/model adı çağırmaz. Bağımsız
rolleri exact CI provenance ile başlatma yetkisi repository'nin canonical
`Development Review Automation` ve reusable `Development Review Router` akışında
kalır; koordinatör yalnız bu rollerin exact-head receipt'lerini tüketir.

`mode=guarded` tek başına yazma açmaz. Dış yazım için ayrıca
`writeActionsEnabled=true`, ilgili eylem bayrağı ve birebir
`allowedAutomaticActions` capability girdisi gerekir. Depot başlatma capability
allowlist'ine; Depot yorumunun GitHub'a yazılması hem capability allowlist'ine hem
de `writeActionsEnabled=true` değerine bağlıdır. Otomatik merge en son
etkinleştirilecek ayrı bir opt-in'dir.

## Test

```bash
node --check scripts/qwen-coordinator/lease.mjs
node --check scripts/qwen-coordinator/run-once.mjs
node --check scripts/qwen-coordinator/install-local.mjs
node --test tests/qwen-coordinator-*.test.mjs
```

Ayrıntılı işletim ve geri dönüş adımları için
[`docs/runbooks/qwen-coordinator.md`](../../docs/runbooks/qwen-coordinator.md)
dosyasına bak.
