# Context Pack ve görev boyutlandırma

Bu belge, büyük görevlerde ajan context'inin şişmesini önlemek için mevcut ajan çalışma akışına eklenen hafif protokoldür. Yeni bir orkestrasyon katmanı veya ikinci görev sistemi oluşturmaz. Canlı durum için yalnız `TASKS.md` authoritative kalır. Açık PR'lar, faz/kontrat belgeleri ve devir kayıtları çalışma/tarihsel kanıt sağlar; TASKS ile paralel durum tablosu oluşturmaz.

Amaç: her ajanın tüm projeyi yeniden öğrenmesi yerine, görevi çözmek için gereken en küçük doğrulanmış bağlamla çalışması.

## 1. Üç katmanlı context modeli

Her çalışma context'i üç katmana ayrılır:

### L0 — Global

Her görevde geçerli, küçük ve kararlı kurallar:

- `AGENTS.md`
- `CONTRIBUTING.md`
- `docs/plan/agent-workflow.md`
- güvenlik, tenant, para, migration ve CI ilkeleri

L0 proje tarihçesi değildir. Yalnız herkese ortak çalışma sözleşmesidir.

### L1 — Domain

Görevin ait olduğu alanın sözleşmeleri ve doğrulanmış kararları:

- ilgili faz belgesi
- ilgili mimari kontrat
- gerekiyorsa `DECISIONS.md` içindeki doğrudan ilgili kararlar
- aynı domainin mevcut handoff/acceptance kaydı

Ajan ilgisiz domainleri sırf "context olsun" diye okumaz.

### L2 — Task

Uygulayıcının gerçekten değiştireceği dar çalışma paketi:

- görev kimliği
- amaç ve beklenen davranış
- base `main` SHA
- branch / mevcut PR
- yazılabilir dosyalar
- korunacak/değişecek kontratlar
- kapsam dışı
- acceptance kriterleri
- validation budget
- bilinen blocker/risk
- sonraki tek somut adım

Kod yazımı L2 üzerinden yürür. L0 ve L1 sınır koyar; L2 işi tarif eder.

## 2. Context Pack

Koordinatör M veya L büyüklüğündeki işlerde görev paketini aşağıdaki kısa formatta yazar. S işlerde mevcut görev paketi yeterliyse ayrı belge gerekmez. Context Pack yeni bir source-of-truth değildir; authoritative kayıtlara işaret eden çalışma özeti olmalıdır.

```text
CONTEXT PACK
Task / domain:
Goal:
Base main SHA:
Current branch / PR / head:
Validation budget:

Read first:
- exact phase/contract
- exact implementation files
- exact tests

Writable scope:
- ...

Do not touch:
- ...

Contracts / invariants:
- ...

Acceptance:
- ...

Known blockers / risks:
- ...

Next executable step:
- ...
```

Context Pack'e uzun sohbet özeti, ilgisiz ürün vizyonu veya tekrar eden repo dokümantasyonu kopyalanmaz. Gerekli ayrıntı canonical belgeye linklenir.

## 3. Görev boyutu

Boyut dosya sayısından önce değişen authority, contract ve risk alanına göre belirlenir.

| Boyut | Tipik kapsam | Kural |
| --- | --- | --- |
| **S** | tek davranış, tek authority, 1–3 dosya, dar test | doğrudan uygulanabilir |
| **M** | tek ana authority, birkaç dosya/katman, açık contract | Context Pack önerilir |
| **L** | birden fazla katman veya 2 risk alanı; DB + API + UI gibi | Context Pack zorunlu, alt dilimler yazılır |
| **XL** | birden fazla authority/source-of-truth değişiyor; bağımsız migration/security/UI/finance sınırları birlikte | tek implementer görevi olarak açılamaz; önce S/M/L parçalara bölünür |

Aşağıdakilerden biri varsa görev en az L kabul edilir:

- iki farklı authoritative state veya source-of-truth değişiyorsa
- DB/migration ile kullanıcı akışı aynı görevde yeni davranış kazanıyorsa
- security/access ve para/ledger riskleri birlikte değişiyorsa
- backend contract henüz donmadan frontend paralel uygulanmak isteniyorsa
- kabul kanıtı tek bir test yüzeyiyle açıklanamıyorsa

## 4. Büyük işi bölme kuralı

Büyük iş feature ekranlarına göre değil, contract ve authority sınırlarına göre bölünür.

Örnek:

```text
"Multi-service booking yap"
```

yerine:

```text
contract / snapshot
DB transaction
availability
public plan/create
operator create
notification/outbox
HTTP acceptance
browser acceptance
```

Horizontal ortak motor ile vertical ürün adaptörü aynı görevde yeni authority yaratmamalıdır. Önce ortak contract donar, sonra bağımlı yüzeyler o contract'a karşı ilerler.

Bir alt görev diğerinin henüz uygulanmamış davranışını mevcut kabul edemez. Paralel çalışma gerekiyorsa ortak alanlar, örnek request/response, hata kodları, tenant/time/money anlamları ve merge sırası önce kalıcı kontratta sabitlenir.

## 5. Context Refresh

Uzun sohbet veya devir context'i sonsuza kadar taşınmaz. Aşağıdaki durumlardan biri oluştuğunda koordinatör yeni bir kısa Context Pack üretir ve sonraki çalışma bu snapshot'tan devam eder:

- görev birden fazla oturuma veya uygulayıcıya devredildiyse
- base/head anlamlı biçimde değişti veya önemli bağımlılık main'e birleştiyse
- acceptance/kapsam değiştiyse
- aynı görev içinde üç veya daha fazla yön değişikliği olduysa
- aynı hipotez 2–3 kez başarısız oldu ve yeni yaklaşım gerekiyorsa
- eski sohbetin hangi kararının hâlâ geçerli olduğu belirsizleştiyse

Refresh eski kanıtı silmez. Yalnız current state'i yeniden sıkıştırır ve canonical PR/TASKS/handoff kayıtlarına bağlar.

## 6. Okuma bütçesi

Ajan varsayılan olarak şu sırada okur:

1. L0 çalışma kuralları
2. görev için tek L1 domain/faz/contract seti
3. L2 exact dosya ve testler

Repo genelini taramak yalnız görev sınırı gerçekten bilinmiyorsa veya koordinatör discovery/preflight görevi verdiyse uygundur. Uygulama ajanı discovery bahanesiyle tüm ürünü yeniden modellemez.

## 7. Handoff ile ilişki

`CONTRIBUTING.md` içindeki devir şablonu authoritative kalır. Context Pack onun yerine geçmez.

Yeni oturuma hızlı giriş gerekiyorsa devir kaydının başına şu beş satırlık özet eklenebilir:

```text
DONE: ...
CURRENT HEAD: ...
BLOCKER: ...
DO NOT TOUCH: ...
NEXT: ...
```

Ayrıntılı kanıt, kontrat, test ve başarısız kontroller mevcut handoff/PR içinde kalır.

## 8. Temel prensip

Büyük bir görevi küçültmenin ölçüsü "kaç dosya" değil, "kaç bağımsız gerçeği aynı anda değiştiriyoruz" sorusudur.

Bir görev iki farklı authority'yi aynı anda yeniden tanımlıyorsa varsayılan hareket kod yazmak değil, sınırı bölmektir.
