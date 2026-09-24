# H19b sonucu (24 Eylül 2026)

- **Protokol:** H19B-PROTOKOL v0.2 (e3f1882).
- **Vakalar:** `vakalar.v0.1.json`, SHA-256 `3faa8790…`, cd6551f.
- **Model:** `jev-1.13.0`. Toplam 230 çağrı.
- **Ham çıktılar:** [`sonuc/2026-09-24T07-54-00-236Z/`](sonuc/2026-09-24T07-54-00-236Z/).
- **Önceden yazılmış analizin tam çıktısı:** [`rapor.md`](sonuc/2026-09-24T07-54-00-236Z/rapor.md).

**İkinci okuyucu:** Kör kontrol ölçümden önce tamamlandı (d0b9b62, 929c955; 07:48–07:52 UTC; ölçüm 07:54'te başladı). 12/12 etiket anahtarla uyuştu, vaka düşmedi. Kontrol edilen vakalar arasında Jev'in iki yön hatası (A05, B08) da var; ikinci okuyucu ikisini de `weakens` olarak etiketledi.

## Önceden yazılmış kurala göre sonuç: **karşılaştırılamaz**, H19c açılmaz

| # | Ölçüt | Değer | Eşik | |
|---|---|---|---|---|
| 1 | AUC (A+B ile C+D) | 0.96 (%95: 0.89–1.00) | ≥ 0.80 | geçti |
| 1a / 1b | A–C / B–D | 0.99 / 0.93 | ≥ 0.70 | geçti |
| 2 | \|P(C) − P(D)\| | 0.005 | ≤ 0.10 | geçti |
| 3 | J kolunda enjeksiyon \|Δ\| | 0.046 | ≤ 0.05 | geçti (sınırda) |
| 4 | Doğruluk / undetermined | %92.5 / %0 | ≥ %75 / ≤ %20 | geçti |
| 5 | V kolu H19a yönünü tekrarlamalı: enjeksiyonla D5 | **+0.035** | ≥ +0.10 | **karşılaştırılamaz** |

Kapı 5 tam da koyulduğu işi yaptı. Bu set H19a'daki sorunu **içermiyor**, bu yüzden J kolunun başarısı
K11'e (olgu koşullama) yazılamaz.

## Neden: set, eski soru için de kolay

| | J (olgu + Choice) | V (eski v0.1, olgusuz) | Yalnız olgular (Jev'siz) |
|---|---|---|---|
| AUC genel | 0.96 (yön); 0.99 ("etkiler": weakens + strengthens) | **1.00** (P(D5)) | 0.47 |
| A–C / B–D | 0.99 / 0.93 | 1.00 / 1.00 | 0.40 / 0.50 |

- **Eski soru her iki katmanda kusursuz ayırıyor.** H19a'da kilit bağlamlı etiketsiz vakalarda P(D5)
  ortalaması 0.81 idi. Burada kilit bağlamlı C hücresinde 0.08.
- **Sebep: C negatifleri fazla açık.** Hata kodu, çıktı ve doğrulama değişiklikleri; anlamca belirsizlik
  yok. H19a'daki kilit önyargısı belirsiz vakalarda ortaya çıkıyordu: kilitli fonksiyonda başka bir ekseni
  (kapasite, zaman, kiracı) değiştiren mutantlar. Bu sette öyle vaka yok.
- **Kapı 5 beklentimde de bir kalibrasyon hatası var.**
  - H19a'nın +0.20'si yalnız değişen satırlara eklenen satırla ölçülmüştü.
  - V kolu ise tam hunk kullanıyor. H19a'nın tam diff'teki karşılığı yaklaşık +0.10 idi, üstelik belirsiz
    vakalarda.
  - Yani beklenti iki yönden fazla iyimserdi.
- **Olgular yapılan işi taşımıyor.** Jev'siz "yalnız olgular" AUC 0.47. Ayrıştırmanın tamamı diff'i
  okumaktan geliyor; bunu eski soru da yapıyor.

## Yine de öğrendiklerimiz

1. **Olgu anlamsal kullanılmıyor, zayıf bir öncül gibi davranıyor.** Olgu çevirmede:
   - B'de beklenen düşüş yok: ortalama Δ −0.018; yalnız vakaların %20'si düştü.
   - C ve D ise olgunun yönüne kayıyor: kilit "var" denince D +0.092, "yok" denince C −0.078.
   - Önceden yazılmış okuma "olgu kullanılmıyor" diyor. İşaretli değerler, eşiğin (0.10) hemen altında bir
     JSON önyargısı gösteriyor. Senin uyardığın tuzağın küçük bir izi.
2. **Tespit kolay, yön zor.**
   - "Eşzamanlılığa dokunuyor mu" sorusunda J 0.99, V 1.00.
   - J'nin fazladan verdiği şey yön. A ve B'nin 20 pozitifinde yön 18/20 doğru.
   - İki yön hatası, yüzeyde "koruyucu görünen" kalıplarda:
     - A05: advisory kilit anahtarı hizmet adına daraltıldı → Jev "güçlendiriyor" dedi (0.75).
     - B08: çakışmada belirteci ezen `ON CONFLICT DO UPDATE` → "güçlendiriyor" (0.58).
3. **Kurulmuş tuzak tuttu.** D09'da salt okuma sorgusundan bir koşul silindi. Jev "zayıflatıyor" dedi
   (0.90); "silinen koşul satırı" tabanıyla aynı hata. V kolu da yarı yarıya düştü (P(D5) 0.54).
4. **Koruma ekleme/kaldırmada Jev, kod kuralından farklı değil.** E katmanında ikisi de 8/10 ve aynı iki
   vakada yanılıyor: gereksiz korumanın kaldırılması (E05) ve eklenmesi (E09). Bu, H19c için ilk veri:
   `guard_delta` olan durumlarda Jev kod kuralına şimdilik bir şey katmıyor.
5. **Kararlılık ve maliyet:**
   - J1 ile J2 arasında ortalama |ΔP| 0.018; argmax uyumu %100.
   - Çağrı başına ortalama 730 giriş tokenı.

## Sonraki adım önerisi: H19b′, yeni ön kayıt

- **Zor negatifler:** Kilitli fonksiyonda başka ekseni değiştiren gerçek H19 bench mutantları (D0, D2, D3,
  D4). H19a'nın başarısızlık modu tam burada.
- **Zor pozitifler:** Kilitsiz bağlamda ince yarışlar.
- **Birincil karşılaştırma mutlak AUC değil,** aynı vakalarda J ile V'nin kafa kafaya karşılaştırması
  (eşleştirilmiş). V mevcut yöntemdir; J onu geçmelidir.
- **Tespit ("etkiler mi") ve yön ayrı puanlanır.**
- **Kapı 5'in beklentisi** tam hunk koşulunda ve pilot olmadan değil, önceki ölçümle aynı koşuldan
  kalibre edilir.

## English handoff

The pre-registered result of H19b (fact-conditioned D5 Choice, 50 new cases, pinned `jev-1.13.0`) is
**inconclusive**:
- The primary J-arm gates passed: AUC 0.96, A–C 0.99, B–D 0.93, |C − D| 0.005, cue injection 0.046,
  accuracy 92.5%.
- The comparability gate failed: in the V arm, lock-cue injection moved D5 by only +0.035, against a required
  +0.10.
- The legacy v0.1 D5 question also separates the set perfectly (AUC 1.00). The C negatives are unambiguous
  business edits, so the H19a lexical-prior failure mode is absent and the J-arm success cannot be credited
  to fact conditioning.
- Facts alone give AUC 0.47. Fact flips show no semantic use (cell B unchanged) and a weak prior-like shift
  in C/D (−0.08 / +0.09).
- Jev gets the direction right in 18/20 positives. Its two misses are surface-protective patterns (a
  narrowed lock key; `ON CONFLICT DO UPDATE` that overwrites).
- It falls for a planted removed-predicate negative.
- It matches the code rule 8/10 on guard add/remove, with the same two misses.

Next step: a new pre-registration with hard negatives (other-axis mutants inside locked functions) and a
paired J vs V comparison.
