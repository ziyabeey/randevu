# H19u: D1–D5 belirsizlik ayrıştırıcısı (ön kayıt)

**Sürüm v0.1, mühürlü.** Bu dosya H19u vaka seti kurulmadan ve hiçbir H19u Jev çağrısı yapılmadan önce yazılır.
Bu commit'ten sonra soru, eşik, vaka seçimi veya kabul kapısı değişirse yeni protokol ve tamamen yeni vakalar gerekir.

H19t sonucu: ham `P(D5)` iyi bir sıralayıcıdır fakat `τ=.64` tek başına System Two yükünü yeterince
azaltmamıştır. Başlıca hata kümesi D1 (idempotency / command identity / receipt) değişikliklerinin D5 gibi
skorlanmasıdır. H19u threshold tuning yapmaz. Yalnız bu **D1↔D5 semantik komşuluğunu** ikinci, ucuz bir
System One sorusuyla ayırmanın mümkün olup olmadığını sınar.

H19s kapalı kalır. H19u geçerse ancak ayrı bir shadow ön kaydı açılabilir.

## 1. Donmuş iki aşamalı router

### Aşama 1 — mevcut V

Model: `jev-1.13.0`. DE-JEV-H19-R0 v0.1 altı eksen sorusu aynen.

```text
high_D5 := P(D5) >= 0.64
high_D1 := P(D1) >= 0.64
```

- `high_D5 = false` → no-route.
- `high_D5 = true, high_D1 = false` → doğrudan route.
- `high_D5 = true, high_D1 = true` → **belirsiz mahalle**, Aşama 2 çağrılır.

`0.64` H19t'de önceden kalibre edilmiş eşiktir; H19u'da değiştirilmez.

### Aşama 2 — D1/D5 ayrıştırıcı Choice

Aşama 2 **V olasılıklarını, high_D1/high_D5 bayraklarını veya deterministik facts'i görmez**. Yalnız aynı diff
girdisini görür. Böylece ilk aşamanın skorları ikinci modele premise/cue olmaz.

Soru:

```text
Which description best matches the behavioral effect of the added and removed lines?

D1_ONLY:
  The change materially affects idempotency, command identity, replay/receipt semantics, request identity,
  or duplicate-command handling, but does not materially change concurrency, optimistic-version, locking,
  serialization, or race-sensitive behavior.

D5_ONLY:
  The change materially affects concurrency, optimistic-version, locking, serialization, stale-write
  protection, or race-sensitive behavior, but does not materially change idempotency/command identity.

BOTH:
  The change materially affects both the D1 family (idempotency/command identity/replay) and the D5 family
  (concurrency/version/locking/serialization).

NEITHER_OR_OTHER:
  It affects neither family materially, or the supplied diff is insufficient to determine either.
```

Tek Choice kullanılır. Başka explanation/facts verilmez.

### Bileşik route

```text
if P(D5) < .64:
    no-route
else if P(D1) < .64:
    route
else:
    route iff Choice in {D5_ONLY, BOTH}
```

## 2. Yeni set: 80 vaka

Tamamen yeni 80 mutasyon, dört eşit katman:

| Katman | n | Gerçek etiket |
|---|---:|---|
| A | 20 | D1 only |
| B | 20 | D5 only |
| C | 20 | D1 + D5 |
| D | 20 | neither D1 nor D5; D0/D2/D3/D4 değişiklikleri |

### A — D1 only
- Gerçek tekrar/idempotency/command-identity davranışı değişir.
- D5 maddi olarak değişmez.
- En az 8 vaka receipt/request-hash/replay ailesinden, kalanlar farklı D1 ailelerinden.
- Salt mesaj değişikliği kullanılmaz.

### B — D5 only
- Gerçek concurrency/version/locking/serialization davranışı değişir.
- D1 maddi olarak değişmez.
- 10 weakens + 10 strengthens mümkün olduğunca dengeli.

### C — D1 + D5
- İki eksen birlikte maddi olarak değişir.
- En az 4 farklı mekanizma ailesi.
- Yön yalnız çeşitlilik kaydıdır.

### D — neither
- D1 ve D5 değişmez.
- D0/D2/D3/D4 her biri 5 vaka.
- Açık no-op/mesaj/formatlama negatifleri kullanılmaz.

R0/H19a, H19b, H19b′, H19d ve H19t'deki aynı mutasyonlar yasaktır.

## 3. Denge ve naif özellik kapısı

Model çağrısından önce yalnız set dengelemesi için hesaplanır, Jev'e verilmez:

- cue sözlüğü: `/for update|lock|version|advisory|serializ|idempoten|request_hash|receipt|replay/i`
- `lock_context`
- diff boyutu, eklenen/silinen satır
- silinen where/and
- added exists/select
- removed-predicate
- function family

Denge:
- dört katmanda cue-present oranları arasında max fark ≤ 25 yüzde puan;
- dört katmanda lock_context oranları arasında max fark ≤ 25 yüzde puan;
- tek function family hiçbir katmanda > %50 olamaz.

Naif gate:
- A vs C (D1-only vs both)
- B vs C (D5-only vs both)
- D5-involved (B+C) vs not (A+D)

üzerinde her tek naif özellik AUC ≤ 0.70 olmalıdır. Aşarsa set model çağrısından önce yeniden dengelenir.

## 4. Kör ikinci okuyucu

Freeze sonrası, ilk Jev çağrısından önce sabit tohumla 16 vaka:
- A/B/C/D katmanlarından dörder.

İkinci okuyucu yalnız diff + gerekirse fonksiyon bağlamını görür ve şu etiketi verir:
- `D1_ONLY`
- `D5_ONLY`
- `BOTH`
- `NEITHER_OR_OTHER`

Anahtar ayrı dosyada kalır. Uyuşmazlıkta vaka düşer; yeniden etiketlenmez ve yerine yenisi konmaz.
Kör cevap commit'i ilk H19u çağrısından önce olmalıdır.

## 5. Çalıştırma

Yeni 80 vaka için:

- V1: altı eksen V sorusu, 80 çağrı.
- R1: ayrıştırıcı Choice, 80 çağrı.
- R2: ayrıştırıcı Choice ikinci uncached tur, 80 çağrı.

Toplam 240 çağrı (düşen yoksa).

R1/R2 **tüm vakalarda** çalıştırılır; ancak operasyonel bileşik router yalnız V1'de belirsiz mahalleye düşen
vakalarda R1 sonucunu kullanır. Böylece resolver'ın kendi yeteneği ayrıca ölçülebilir.

Analiz scripti ilk canlı çağrıdan önce commit'lenir.

## 6. Birincil yetenek kapısı — resolver D1-only ile D5-involved'ı ayırıyor mu?

Resolver binary okuması:

```text
resolver_routes_D5 := Choice in {D5_ONLY, BOTH}
```

### U1

R1 üzerinde:
- B+C (D5 involved) recall ≥ %90
- A (D1 only) FPR ≤ %30
- D (neither) FPR ≤ %25
- C (both) recall ≥ %85

Ek olarak exact 4-class accuracy ≥ %70.

U1'in tamamı gerekir.

## 7. Birincil operasyonel kapı — bileşik router

Baseline: H19t router `P(D5)>=.64`.

Candidate: §1'deki bileşik router.

### U2

Yeni 80 vakada candidate:
- genel D5 recall (B+C) ≥ %90
- B recall ≥ %90
- C recall ≥ %85
- genel non-D5 FPR (A+D) ≤ %30
- A / D1-only FPR ≤ %30

Baseline'a göre:
- D5 recall kaybı ≤ 5 yüzde puan
- C recall kaybı ≤ 10 yüzde puan
- genel FPR en az 10 yüzde puan düşmeli
- toplam System Two route oranı en az 10 yüzde puan düşmeli

Bu dört karşılaştırmanın tamamı gerekir.

## 8. Resolver çağrı bütçesi

Belirsiz mahalle:
`P(D5)>=.64 && P(D1)>=.64`.

### U3

- Resolver çağrılan vaka oranı ≤ %60.
- Candidate'ın System Two route sayısı + resolver çağrı sayısı ayrıca raporlanır.
- Resolver, System Two ile aynı maliyet kabul edilmez; token/latency ayrı raporlanır.
- Ancak candidate System Two çağrılarını baseline'a göre azaltmıyorsa U3 geçemez.

U3 bir maliyet gate'idir, toplam token parasal maliyet iddiası değildir.

## 9. Bağlam dayanıklılığı

### U4

Candidate için:
- cue-present D5 recall ≥ %85
- cue-free D5 recall ≥ %85
- lock-context true/false D5 recall her biri ≥ %85
- A katmanında cue-present ve cue-free FPR'nin her biri ≤ %40

Resolver exact accuracy:
- cue-present ≥ %65
- cue-free ≥ %65

## 10. Kararlılık

R1 ↔ R2:

### U5

- Choice argmax agreement ≥ %90
- binary `resolver_routes_D5` agreement ≥ %95
- R2'de U1 binary recall/FPR metriklerinden hiçbiri 10 yüzde puandan fazla kötüleşmez.

V kararlılığı H19t/H19d'de tekrar tekrar ölçüldüğü için H19u yalnız bir V turu kullanır.

## 11. İkincil raporlar

Gate değildir:
- V1 ham P(D1), P(D5) dağılımları A/B/C/D;
- belirsiz mahallede gerçek sınıf dağılımı;
- resolver confusion matrix;
- mekanizma ailesine göre hata;
- removed-predicate / request-hash / receipt / stale-token aileleri;
- token ve latency;
- balanced-set precision yalnız test prevalansı bağlamında.

Threshold sweep, yeni skor veya post-hoc üçüncü soru yasaktır.

## 12. Sonuç kuralı

H19u yalnız **U1 + U2 + U3 + U4 + U5** birlikte geçerse başarılıdır.

Desteklenen dar iddia:

> Sabit `P(D5)>=.64` ön filtresindeki D1/D5 belirsizliği, V skorları modele premise olarak verilmeden,
> aynı diff üzerinde ikinci küçük Choice ile prospective olarak ayrıştırıldı; bileşik router D5 recall'ını
> korurken D1 kaynaklı yanlış alarmları ve System Two çağrı yükünü azalttı.

Geçerse sonraki adım **H19s** olabilir:
- yalnız shadow;
- gerçek PR/diff prevalansı;
- resolver + System Two toplam maliyet;
- kaçırılan vakalar insan/ana reviewer sonucu ile karşılaştırılır.

Herhangi bir gate kalırsa:
- H19s açılmaz;
- aynı sette yeni prompt/threshold aranmaz;
- D1/D5 ayrımının Jev System One ile bu biçimde çözülemediği kaydedilir;
- ham V vektörü yalnız ranker/sinyal olarak kalır.
