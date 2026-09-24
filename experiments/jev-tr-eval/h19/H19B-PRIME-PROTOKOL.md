# H19b′: zor D5 ayrımı ve K11 atıf testi (ön kayıt)

**Sürüm v0.1, mühürlü.** Bu dosya yeni vaka seti kurulmadan ve hiçbir H19b′ Jev çağrısı yapılmadan önce
yazılır. H19b ve H19a sonuçları tasarım girdisidir; bu ön kayıttan sonra soru, ölçüt, eşik veya vaka seçim
kuralı değiştirilirse yeni sürüm ve tamamen yeni vakalar gerekir.

## 0. Neden bu deney var

H19b'de olgu-koşullu J kolu güçlüydü (AUC 0.96), fakat eski V sorusu aynı sette D5'i kusursuz ayırdı
(AUC 1.00). H19a'daki başarısızlık modu sette yoktu: kilitli fonksiyonlarda D5 olmayan ama başka bir
semantik ekseni gerçekten değiştiren zor negatifler yerine çoğunlukla açık iş-mantığı/çıktı/doğrulama
negatifleri vardı.

H19b′ iki ayrı soruyu test eder:

1. **Adversarial detection:** Gerçek D5 ama kilit ipucu olmayan vakaları, D5 olmayan ama gerçek kilit
   bağlamı bulunan vakalardan J, V'den daha iyi ayırıyor mu?
2. **K11 attribution:** Eğer J daha iyiyse, bu iyilik verilen yapısal olgulardan mı geliyor, yoksa sadece
   Choice soru biçiminden mi?

Bu nedenle üç kol zorunludur:
- **JF:** facts + directional Choice.
- **J0:** aynı directional Choice, facts verilmez.
- **V:** DE-JEV-H19-R0 v0.1'in eski 6-eksen sorusu.

## 1. Kapalı geçmiş veri

Aşağıdaki vakalar ve sonuçlar yalnız tasarım gerekçesi olarak kullanılabilir; H19b′ ölçümüne girmez:
- DE-JEV-H19-R0 v0.1'in 16 vakası;
- H19a'nın 16 vakası ve ablation çağrıları;
- H19b'nin 50 vakası ve 230 çağrısı.

H19b′'de kullanılan mutasyonların kendisi yeni olmalıdır. Aynı üretim fonksiyonu yalnız aşağıdaki eşleştirme
kuralları gerektiriyorsa iki hücrede kullanılabilir; H19b'deki **aynı mutasyon** tekrar kullanılamaz.

## 2. Vaka matrisi: 64 vaka

Dört hücre, hücre başına **16 vaka**:

| | Gerçek kilit/yapı bağlamı var | Gerçek kilit/yapı bağlamı yok |
|---|---|---|
| **D5 etkisi var** | **A′ (16):** ince D5 değişikliği; yapı yüzeyde korunuyor | **B′ (16):** ince D5 değişikliği; diff'te D5 ipucu yok |
| **D5 etkisi yok** | **C′ (16):** kilitli fonksiyonda başka eksen değişiyor | **D′ (16):** kilitsiz fonksiyonda başka eksen değişiyor |

### A′: locked hard positives
- `lock_context=true`.
- `guard_delta=unchanged`.
- Değişiklik eşzamanlı davranışı gerçekten değiştirir ama "kilit eklendi/kaldırıldı" gibi yüzeysel değildir.
- 8 `weakens`, 8 `strengthens`.
- Örnek aileler: kontrolün kilit öncesi/sonrası taşınması; advisory anahtar kapsamının daralması/genişlemesi;
  kilit sonrası yeniden kontrolün kaldırılması/eklenmesi; kilidi atlayan erken yolun eklenmesi/kaldırılması.
- A05 tipi "koruyucu görünüyor ama yönü ters" örnekler özellikle dahil edilir.

### B′: cue-free hard positives
- `lock_context=false`.
- Diff, hunk başlığı, fonksiyon adı ve verilen dosya yolunda H19a ipucu sözlüğü
  `/for update|lock|version|advisory|serializ|skip locked|nowait/i` eşleşmez.
- 8 `weakens`, 8 `strengthens`.
- Örnek aileler: tek atomik koşullu UPDATE ↔ SELECT-then-UPDATE; durum koşulunun kaldırılması/eklenmesi;
  yarışan upsert'in overwrite/no-op semantiği; kapasite/benzersizlik check-then-act penceresi.
- `expectedVersion`, `version`, `lock`, `advisory` gibi açık sözcükler yasaktır.

### C′: locked hard negatives
- `lock_context=true`.
- D5 etiketi **no_effect**.
- Mutasyon açık mesaj/formatlama/no-op değildir; başka bir H19 eksenini **maddi olarak** değiştirir.
- Tam dağılım: 4×D0, 4×D2, 4×D3, 4×D4.
- Örnekler: kilitli fonksiyonda tenant/yetki kapsamı; snapshot/politika seçimi; kapasite kuralı; zaman sınırı.
- H19a'daki "kilit bağlamı + başka eksen" başarısızlık modunun doğrudan temsilidir.

### D′: cue-free hard negatives
- `lock_context=false`.
- D5 etiketi **no_effect**.
- C′ ile aynı dağılım: 4×D0, 4×D2, 4×D3, 4×D4.
- Açık mesaj/çıktı/biçim değişiklikleri birincil negatif olarak kullanılamaz.

### Eşleştirme
- A′ ve C′ mümkün olduğunca aynı 16 üretim fonksiyonunda eşleştirilir: biri D5, biri başka-eksen mutasyonu.
- B′ ve D′ mümkün olduğunca aynı 16 üretim fonksiyonunda eşleştirilir.
- Eşleştirme yapılamayan vaka sayısı hücre başına en fazla 4'tür ve ölçümden önce raporlanır.
- Diff boyutu, eklenen/silinen satır sayısı ve `where/and` silme oranı hücreler arasında ölçülür. Herhangi
  bir tek naif özellik B′–C′ ayrımında AUC > 0.70 verirse set **dondurulmaz**; vakalar model çağrısı
  yapılmadan yeniden dengelenir.

## 3. Etiket ve extractor sahipliği

Etiketler: `weakens`, `strengthens`, `no_effect`, `undetermined`.

- Fonksiyon düzeyi politika H19b ile aynıdır.
- Extractor yalnız yapıyı betimler; hüküm bildiren alan yasaktır (SENTEZ K11).
- H19b v0.2'nin donmuş fact şeması kullanılır:
  `lock_context`, `version_guard`, `changed_inside_locked_region`, `guard_delta`, `retry_path`,
  `transaction_boundary`.
- Bir vakanın gerçek etiketi facts'ten türetilmez.
- A′–D′ için `guard_delta=unchanged`. `guard_delta` değişen vaka bu deneyin ana setine alınmaz.

## 4. Kör ikinci okuyucu

Model çağrısından önce sabit tohumla **16 vaka** seçilir:
- A′ 4, B′ 4, C′ 4, D′ 4.
- A′ ve B′ örneğinde direction da kontrol edilir.
- C′/D′ içinde D0/D2/D3/D4 mümkün olduğunca dengeli seçilir.
- İkinci okuyucu yalnız diff + gerekli fonksiyon bağlamını görür; hücre ve anahtar ayrı dosyada kalır.
- Uyuşmazlıkta vaka yeniden etiketlenmez, **düşer**. Düşen vakanın eşlenmiş çifti de ana paired analizden
  düşer; set yeni vakayla doldurulmaz.
- Kör etiket commit'i model çağrısından önce olmalıdır.

## 5. Kollar

Model `jev-1.13.0` sabittir.

### JF: facts + Choice
H19b'deki Choice aynen kullanılır:

```text
instructions: `facts` were computed by code from the full function before and after the change and are
  correct. How do the added and removed lines in `patch` change the protection against concurrent requests
  interfering with each other in this function?
weakens:      Concurrent requests can now interfere where they could not before: an existing protection
              (row lock, advisory lock, row predicate, single-statement update, uniqueness) is bypassed or
              narrowed, or a check-then-act window is introduced.
strengthens:  Concurrent requests are now better protected than before.
no_effect:    Only business logic, output or validation changes; concurrent requests interact exactly as
              before.
undetermined: The patch and facts are not enough to tell.
```

### J0: Choice, facts yok
Criteria JF ile kelimesi kelimesine aynıdır. Instructions yalnız ilk facts cümlesi çıkarılarak kullanılır:

```text
How do the added and removed lines in `patch` change the protection against concurrent requests
interfering with each other in this function?
```

### V: eski kontrol
DE-JEV-H19-R0 v0.1'in 6-eksen `noul` isteği aynen. Ana skor `P(D5)`.

### Tur
- **JF1** birincil.
- **JF2** ikinci önbelleksiz kararlılık turu.
- **J0** bir tur.
- **V** bir tur.
- Toplam başlangıçta 64 vaka kalırsa 256 canlı çağrı.
- Önceki tüm deneyler gibi cache kullanılmaz.

## 6. Skorlar: detection ve direction ayrı

### Detection
Bir vakanın D5'e **dokunma** skoru:
- JF/J0: `P(weakens) + P(strengthens)`.
- V: `P(D5)`.

Pozitif = A′+B′. Negatif = C′+D′.

### Direction
Yalnız gerçek D5 vakalarında (A′+B′):
- doğru direction argmax: `weakens` veya `strengthens`;
- `no_effect` ve `undetermined` direction hatasıdır.
- Weakens ve strengthens ayrı ayrı raporlanır.

## 7. Birincil test: H19a'nın adversarial çaprazı

**Birincil karşılaştırma B′ (gerçek D5, cue yok) ile C′ (D5 değil, lock context var) arasındadır.**
Bu çapraz eski lexical prior için ters kurulumdur.

Her kol için AUC(B′ pozitif, C′ negatif) hesaplanır.

### Gate P1: mevcut yöntemi geç
- `AUC_JF(B′,C′) - AUC_V(B′,C′) >= 0.10`
- ve paired bootstrap (vaka kimliği üzerinden, 10,000 tekrar, sabit tohum) %95 GA'nın alt sınırı **> 0**.
- ayrıca `AUC_JF(B′,C′) >= 0.80`.

Bu üç koşulun tamamı gerekir.

## 8. K11 atıf kapısı

JF'nin V'yi geçmesi tek başına facts'e kredi vermez.

### Gate P2: facts ek değeri
Aynı adversarial çaprazta:
- `AUC_JF - AUC_J0 >= 0.05`;
- paired bootstrap %95 GA alt sınırı **>= 0**.

Ek olarak C′'de lock fact'inin yalnız "lock var" diye detection skorunu yükseltmediğini görmek için:
- `mean detection_JF(C′) - mean detection_J0(C′) <= +0.05`.

**Okuma:**
- P1 geçer, P2 kalırsa: iyileşme varsa Choice/framing'e yazılır; **K11 doğrulanmış sayılmaz**.
- P1 ve P2 geçerse: fact-conditioning için prospective ek değer vardır; H19c'ye geçiş hakkı doğabilir.
- J0, JF'den daha iyi çıkarsa K11 bu kullanımda negatif katkı olarak raporlanır.

## 9. Genel koruma kapıları

### Gate P3: dört hücrede ayrışma
JF1 detection:
- genel AUC(A′+B′ vs C′+D′) >= 0.80;
- A′–C′ AUC >= 0.75;
- B′–D′ AUC >= 0.75.

### Gate P4: hard-negative kontrolü
- C′ Choice argmax `no_effect` doğruluğu >= 75%;
- D′ Choice argmax `no_effect` doğruluğu >= 75%;
- C′ ile D′ ortalama detection skoru farkı |C′−D′| <= 0.10.

### Gate P5: direction
A′+B′ üzerinde JF1:
- direction doğruluğu >= 80%;
- `weakens` doğruluğu >= 75%;
- `strengthens` doğruluğu >= 75%;
- `undetermined` <= 15%.

### Gate P6: kararlılık
JF1–JF2:
- ort. |Δ detection| <= 0.05;
- direction argmax uyumu >= 90%;
- JF2 birincil adversarial AUC, JF1'den 0.10'dan fazla düşmez.

## 10. İkincil, eşiksiz analizler

- JF/J0/V için tüm hücre AUC'leri ve hücre ortalamaları.
- A′–C′ ve B′–D′ eşlenmiş fonksiyon çiftlerinde "pozitif skoru > negatif skor" oranı.
- D0, D2, D3, D4 bazında C′ ve D′ false-positive profili.
- A′/B′ weakens vs strengthens hata tipleri.
- A05/B08 benzeri "surface-protective" aileler ayrı etiketlenip raporlanır, fakat ölçümden sonra yeni aile
  tanımlanmaz.
- D09 benzeri "removed predicate" aileleri önceden işaretlenir ve hata oranı raporlanır.
- Facts-only naif baseline ve diff-size / removed-where / added-select gibi Jev'siz baselines raporlanır.
- Token ve gecikme.
- V kolunda D1 ve D5 eş hareketi raporlanır; bu deneyin kabul kapısı değildir.

## 11. Sonuç kuralı

- **P1–P6'nın tamamı geçerse:** H19c açılır. İddia yalnız şudur:
  "Zor, H19a-benzeri prospective vakalarda fact-conditioned directional Jev, legacy D5 detection'ı geçiyor
  ve facts aynı Choice sorusuna ölçülebilir ek değer katıyor."
- **P1 geçer, P2 kalırsa:** H19c açılmaz. K11'e kredi yok; ayrı bir soru-biçimi deneyi düşünülebilir.
- **P1 kalırsa:** JF mevcut V yöntemini geçmemiştir; H19c açılmaz.
- **P3/P4/P5/P6'dan biri kalırsa:** performans yeterince genel, yönsel veya kararlı değildir; H19c açılmaz.
- Hiçbir sonuç "D5 çözüldü" veya genel üretim promosyonu anlamına gelmez.

## 12. Kapsam dışı

- H19b sonuçlarına göre eşik ayarı yapılmaz.
- Vaka görüldükten sonra soru/criteria/fact şeması değiştirilmez.
- Dispatcher, CI ve üretim motoru değiştirilmez.
- H19c kodlanmaz veya çalıştırılmaz.
