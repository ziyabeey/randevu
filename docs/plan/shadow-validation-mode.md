# Shadow Validation Mode v1

Bu belge, uzun süren CI/validation pencerelerinde uygulayıcı ajanın boşta beklemeden fakat henüz doğrulanmamış head üzerinde yeni semantic write üretmeden çalışmaya devam etmesini tanımlar. Mevcut görev, reviewer, CI ve merge protokollerini değiştirmez; onların arasındaki bekleme boşluğunu güvenli read-only çalışma ile doldurur.

Canlı görev/durum için yalnız `TASKS.md` authoritative kalır. Açık PR, faz/kontrat belgeleri, Context Pack ve Issue #65 yalnız çalışma/koordinasyon kanıtı sağlar; TASKS ile paralel durum kaynağı oluşturmaz. Shadow Mode ikinci görev sistemi, ikinci ajan veya yeni reviewer değildir.

## 1. State machine

Varsayılan uygulayıcı aynı görev ve aynı kimlikle şu modlar arasında geçer:

```text
ACTIVE
  -> push / validation starts
VALIDATING
  -> external CI/check is still running
SHADOW
  -> validation result
ACTIVE / REPAIR / REVIEW
```

- **ACTIVE:** görev scope'u içinde yazma ve implementation yapılabilir.
- **VALIDATING:** exact head için zorunlu doğrulama başlatılmıştır.
- **SHADOW:** aynı ajan aynı task üzerinde read-only, bounded hazırlık ve evidence çalışması yapar.
- **REPAIR:** validation kırmızıysa exact failure'a göre yeniden write yapılabilir.
- **REVIEW:** candidate yeşil ve görev bağımsız review kapısına hazırsa reviewer akışı başlar.

Shadow Mode aynı ajanı reviewer yapmaz. R1/R2 bağımsızlığı aynen korunur.

## 2. Shadow'a giriş koşulu

Shadow Mode yalnız şu koşullar birlikte sağlandığında açılır:

1. uygulayıcı exact bir `shadow_base_sha` üretmiştir;
2. bu SHA için CI, remote validation veya eşdeğer uzun süren doğrulama çalışıyordur;
3. sonuç gelmeden yeni semantic write üretmek güvenli değildir;
4. current task içinde faydalı read-only çalışma vardır.

Sırf boşta kalmamak için scope genişletilmez. Faydalı bounded iş kalmadıysa ajan yeni domain keşfine çıkmaz; validation state'ini yeniden kontrol eder.

## 3. Shadow'da izin verilen işler

Shadow yalnız current task ve en fazla bir doğrudan dependency hop'u içinde kalır. Uygun işler:

- current PR/head/diff ve changed-file risk scan;
- acceptance coverage ve invariant gap analizi;
- reviewer için exact file/risk/evidence map hazırlığı;
- current task'in doğrudan dependency/contract uyumunu read-only doğrulama;
- CI failure çıkarsa hangi assertion'ın hangi invariantı temsil ettiğini sınıflandırmaya hazırlık;
- TASKS/handoff/Context Pack tutarlılık kontrolü;
- evidence reference'larını derleme;
- sonraki tek executable step'i hazırlama.

Shadow çıktısı implementation kanıtı sayılmaz; yalnız validation sonucu ile birlikte anlam kazanır.

## 4. Shadow'da yasak işler

Shadow sırasında:

- branch/code/migration/runtime write yok;
- yeni semantic commit yok;
- PR ready/merge yok;
- task ownership veya acceptance state değiştiren coordination write yok;
- yeni feature/domain başlatmak yok;
- ikinci shadow veya recursive discovery başlatmak yok;
- bağımsız R1/R2 review yerine implementer self-review verdict üretmek yok.

Kullanıcı/koordinatör açıkça yeni write isterse önce Shadow Mode kapanır, head/state yeniden doğrulanır ve ACTIVE moda geçilir.

## 5. Context bütçesi ve compaction

Shadow scratch geçicidir. Aynı validation penceresinde varsayılan sınırlar:

- en fazla **3 micro-task**;
- en fazla **1 dependency hop**;
- current task dışına çıkmama;
- shadow kaynaklı context artışı yaklaşık **%10** ile sınırlı;
- kalıcı Shadow Receipt hedefi **1500 token veya daha kısa**.

Her micro-task sonrasında validation state yeniden kontrol edilir. CI uzun sürüyorsa ajan raw log/diff kopyalamak yerine kanıt adreslerini taşır.

Shadow sonunda yalnız şu bilgiler kalıcılaştırılır:

```text
SHADOW RECEIPT
shadow_base_sha: ...
confirmed_findings:
- ...
blocker_if_any:
- ...
next_if_green:
- ...
next_if_red:
- ...
evidence_refs:
- ...
```

Ham tool output, duplicate gözlemler, spekülasyon ve stale SHA ayrıntıları compact edilir veya atılır.

## 6. SHA fencing

Bütün head-specific shadow bulguları `shadow_base_sha`'ya bağlıdır.

```text
if current_head != shadow_base_sha:
    invalidate head-specific shadow scratch
    keep only clearly reusable contract-level findings
    re-read current PR/head before further analysis
```

Eski head'in failure'ı current head'e taşınmaz. Yeni commit geldiyse eski CI kırmızısı ancak aynı SHA hâlâ current candidate ise takip edilir.

## 7. TinyFish / browser policy

Repo ve GitHub development path'inde **TinyFish kullanılmaz**.

GitHub/PR/Issue/commit/CI/file işlemlerinde öncelik sırası:

1. native GitHub connector/API;
2. repo dosya/CI araçları;
3. görev için tanımlı özel test veya browser acceptance aracı.

TinyFish veya genel browser automation, GitHub/CI/PR okumak ya da repo mutation yapmak için fallback değildir. Yalnız native connector/tool bulunmayan, açıkça external browser interaction gerektiren kullanıcı-directed bir işte ayrıca değerlendirilebilir. Gerçek ürün browser acceptance'ı için repo protokolünde tanımlı `control-browser` yolu korunur.

## 8. Reviewer ve merge sınırı

Shadow Mode şu kapıları azaltmaz:

- exact-head required CI;
- validation budget'a göre R1/R2 bağımsız review;
- implementer self-ready/merge yasağı olan görevlerde coordinator gate;
- post-merge main CI;
- staging yalnız hosted-only residual gerektiğinde.

Shadow sırasında bulunan bir risk semantic repair gerektiriyorsa ajan ACTIVE/REPAIR moda döner, yeni exact head üretir ve eski semantic review receipt'leri yeni head için otomatik olarak yeterli sayılmaz.

## 9. Operasyonel amaç

Bu protokolün iki hedefi vardır:

1. uzun CI/validation sırasında idle bekleme ve bağlantı kopması riskini azaltmak;
2. aynı ajanın context'ini sınırsız keşifle şişirmeden faydalı read-only çalışma yapmasını sağlamak.

Temel kural:

> Aynı ajan düşünmeye devam eder; her düşündüğünü kalıcı context'e taşımaz.
