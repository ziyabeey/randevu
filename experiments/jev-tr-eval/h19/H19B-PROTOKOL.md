# H19b: olgu-koşullu D5, ileriye dönük test (ön kayıt)

**Sürüm v0.2, mühürlü.** Vakalar kurulmadan ve hiçbir Jev çağrısı yapılmadan önce yazıldı (SENTEZ K9, K11).
Bu commit'ten sonra değişen ölçüt, soru metni veya olgu tanımı geçersiz sayılır. Değişiklik gerekirse yeni
bir ön kayıt açılır ve yeni vakalarla ölçülür.

| Sürüm | Değişiklik (ölçümden önce) |
|---|---|
| v0.1 | İlk tasarım |
| v0.2 | Olgu çevirme tanısal sonda oldu (değişmezlik ve yön ayrı ayrı). Extractor yalnız betimleyici; kod hüküm veren kısa devre yapmıyor, koruma değişen vakalar E katmanına taşındı. İkinci önbelleksiz tur (tur kararlılığı) eklendi. Güven aralıkları ve doğrulayıcı H19b-R2 kuralı yazıldı. H19c sorusu yazıldı. |

**Hipotez:** Eşzamanlılık yapısını (S5) kod betimler ve olgu olarak verirse, Jev'in "davranışsal sonuç"
cevabı (J5):
- kilit ipucundan bağımsız olur;
- gerçek etiketle ayrışır;
- olguyu, ilgili olduğu yerde anlamlı yönde kullanır.

**Kapalı set:** DE-JEV-H19-R0 v0.1'in 16 vakası bu deneyde hiçbir tasarım seçimi için kullanılmaz.

## 1. Deterministik extractor (S5): yalnız betimler

**Sahiplik sınırı:** Sözdizimi ve yapı kodun işidir; davranışsal sonuç Jev'in işidir.
- Olgular yalnız bir yapının **varlığını ve konumunu** söyler.
- Risk ya da hüküm söyleyen alan yasaktır: `race_risk`, `concurrency_broken`, `check_then_act`,
  `guarantee_weakened` ya da adı veya değeri bir sonuç bildiren herhangi bir alan.
- Olgu kümesi aşağıdaki tabloyla kapalıdır. Vakalar görüldükten sonra olgu eklenmez.

Olgular, değişikliğin önceki ve sonraki **fonksiyon gövdesinden** hesaplanır (plpgsql migration'ları).

| Olgu | Tanım (donmuş) |
|---|---|
| `lock_context` | Önceki gövdede `FOR UPDATE`, `FOR NO KEY UPDATE`, `pg_advisory_xact_lock`, `pg_advisory_lock` veya `SKIP LOCKED` var |
| `version_guard` | Güncellenen satırın `WHERE` koşulunda `version`, `*_version` veya `updated_at` karşılaştırması var (önceki gövde) |
| `changed_inside_locked_region` | Değişen satırlardan en az biri, aynı gövdede ilk kilit alımından sonra |
| `guard_delta` | Kilit veya `version_guard` önceden sonraya: `removed`, `added` ya da `unchanged` (betimleyici; hüküm değil) |
| `retry_path` | `exception when unique_violation`, `serialization_failure` veya `lock_not_available` dalı var |
| `transaction_boundary` | plpgsql fonksiyonu tek transaction'dır; yalnız `COMMIT`, `dblink` ya da iki RPC'ye bölünme varsa `changed` |

`guard_delta ≠ unchanged` olan vakalar **E katmanıdır**:
- Jev'e sorulur ve ayrı raporlanır; birincil ölçütlere girmez.
- "removed → zayıflatıyor, added → güçlendiriyor" kod kuralı yalnız **Jev'siz karşılaştırma noktası** olarak
  kaydedilir (H19c için). Hüküm olarak kullanılmaz.

**İpucu sözlüğü (H19a'dan aynen):**
`/for update|lock|version|advisory|serializ|skip locked|nowait/i`.
- B ve D hücrelerinde Jev girdisinin hiçbir yerinde (hunk başlığı, fonksiyon adı ve bağlam dahil) bu
  sözlükten kelime geçmez. Bunu script doğrular.
- `expectedVersion` benzeri bir alanın kaldırılması hem "version" kelimesini içerir hem de `version_guard`
  değişimidir. Bu yüzden B'ye değil, E'ye girer.

## 2. Tasarım

| | İpucu/yapı var (`lock_context = true`) | İpucu/yapı yok |
|---|---|---|
| **Gerçek D5** | **A:** kilit duruyor ama güvence deliniyor. Ör. kontrolün kilit alımından öne taşınması, advisory kilit anahtarının daraltılması, kilit sonrası yeniden kontrolün silinmesi, kilidi atlayıp yazan erken dönüş. | **B:** yapı yok, yarış yaratılıyor. Ör. tek atomik `UPDATE … WHERE n > 0` yerine önce `SELECT` sonra `UPDATE`, durum koşullu geçişte `AND status = 'pending'` koşulunun silinmesi, kilitsiz "say sonra ekle". |
| **D5 değil** | **C:** kilitli bölgede yalnız iş mantığı değişiyor. Ör. mesaj metni, yuvarlama, dönen JSON'a alan eklenmesi, girdi biçimi doğrulaması. | **D:** yapısız fonksiyonda yalnız iş mantığı değişiyor. |

- **A–D:** hücre başına 10 vaka, yani 20 gerçek D5 ve 20 D5 değil. Hepsinde `guard_delta = unchanged`.
- **E:** 10 vaka (5 kaldırma, 5 ekleme).
- **Kaynak:** `supabase/migrations` içindeki gerçek fonksiyonlar. 24 Eylül sayımı: 73 migration; bunların
  38'inde `for update`, 31'inde advisory lock, 23'ünde sürüm kalıbı var; ayrıca 51 `on conflict` satırı ve
  13 retry dalı bulunuyor.
- **Mutasyonlar** elle yazılmış küçük değişikliklerdir. Her vaka `origin: synthetic | bench` alanını taşır;
  metrikler kaynağa göre de ayrılır.
- **Ölçümden önce her vaka için yazılır:** etiket, gerekçe, hücre ve olgu çevirme beklentisi (bkz. §3). Vaka
  dosyasının SHA-256'sı commit'lenir.
- **İkinci okuyucu** rastgele (sabit tohumlu) en az 10 vakanın etiketini kontrol eder. Anlaşmazlık varsa vaka
  düşer. Jev sonucunu gördükten sonra etiket değiştirilmez.

## 3. Kollar ve sondalar

| Kol | Girdi | Soru | Tur |
|---|---|---|---|
| **J (birincil)** | `facts` (S5) + tam hunk diff | Tek Choice (aşağıda) | 2 önbelleksiz tur; **1. tur birincil** |
| **V (kontrol)** | Yalnız tam diff; DE-JEV-H19-R0 v0.1 isteği aynen | 6 eksen noul | 1 tur |

J sorusu (İngilizce, donmuş):

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

**İpucu enjeksiyonu (sözcüksel dayanıklılık):**
- B ve D vakalarına tek bağlam satırı `   for update;` eklenir.
- J kolunda `facts` değişmez, yani olgu "kilit yok" demeye devam eder; beklenen etki yaklaşık 0.
- V kolunda H19a'daki +0.20'nin tekrarı beklenir.

**Olgu çevirme (tanısal sonda, genel bir "küçük etki iyidir" metriği değil):**
- `lock_context` ve `changed_inside_locked_region` birlikte tersine çevrilir.
- Olgu dünyanın tarifini değiştirir. Bu yüzden beklenti hücreye göre önceden yazılır:

| Hücre | Çevirme | Önceden yazılan beklenti | Gerekçe |
|---|---|---|---|
| C | true → false | **değişmez** | Yalnız iş mantığı; kilit olsa da olmasa da eşzamanlı istekler aynı etkileşir |
| D | false → true | **değişmez** | Aynı |
| B | false → true | **P(weakens) düşer** | Değişen bölgeyi kapsayan kilit, check-then-act penceresini kapatır |
| A | true → false | belirtilmez, yalnız raporlanır | Mutasyon kilide göre tanımlı; kilitsiz öncül tutarsız olur |
| E | çevrilmez | | |

Vaka bazında sapma, ancak ölçümden önce ve gerekçesiyle `flip_expectation` alanına yazılabilir.

## 4. Ölçütler

### Kabul kapıları (J kolu, 1. tur; skor P(`weakens`))

| # | Ölçüt | Eşik | Karşılaştırma noktası |
|---|---|---|---|
| 1 | Ayrışma: AUC (A+B ile C+D) | genel ≥ 0.80 | H19a D5 AUC 0.33–0.60 |
| 1a | Olgu = true katmanı: AUC (A ile C) | ≥ 0.70 | |
| 1b | Olgu = false katmanı: AUC (B ile D) | ≥ 0.70 | |
| 2 | Kısayoldan bağımsızlık: \|ort. P(weakens \| C) − ort. P(weakens \| D)\| | ≤ 0.10 | H19a ipucu etkisi +0.20 |
| 3 | Sözcüksel dayanıklılık: J kolunda enjeksiyonla ort. \|Δ P(weakens)\| (B+D) | ≤ 0.05 | |
| 4 | Choice doğruluğu (argmax; `undetermined` yanlış sayılır) | ≥ %75; `undetermined` ≤ %20 | |
| 5 | V kolu H19a yönünü tekrarlamalı: enjeksiyonla D5 ≥ +0.10 | yoksa sonuç "karşılaştırılamaz" | |

### Önceden tanımlı ikincil ölçütler (eşiksiz, yorum kuralı yazılı)

- **Tur kararlılığı (J, 1. tur ile 2. tur):** ort. |ΔP(weakens)|, argmax uyumu ve 2. turun AUC'si.
  - H19a'daki tur gürültüsü 0.015 idi.
  - Yukarıdaki kapı farkları bu gürültüye göre okunur.
- **Olgu çevirme okuması:**

| Değişmezlik kümesi (C+D): ort. \|Δ\| | B kümesi: düşüş yönünde ≥ 0.05 kayan pay | Okuma |
|---|---|---|
| ≤ 0.10 | ≥ %70 | Olgu anlamsal olarak kullanılıyor (hedef) |
| ≤ 0.10 | < %70 | Olgu kullanılmıyor; ayrışma yama metninden geliyor. H19c'de olgunun katkısı ayrıca ölçülmeli |
| > 0.10 | herhangi | **Olgu yeni kısayol** (regex önyargısı JSON önyargısına dönüştü). Kapılar geçse bile H19c olgu bozma sondası içermeli |

- **E katmanı:** Jev'in `removed`/`added` vakalarındaki doğruluğu ve Jev'siz kod kuralıyla uyumu.
- **V kolu:** D5 AUC, eksen bazında enjeksiyon Δ'sı ve r(ΔD1, ΔD5). Ham, logit ve tavan etkisi ayıklanmış
  olarak raporlanır (H19a: 0.74 / 0.76 / 0.52; "transaction/eşzamanlılık anlam komşuluğu" hipotezi).
- **Token ve gecikme** raporlanır. Performans ayrıca H19-perf'te ölçülür; yetenek iddiasına karışmaz.

### İstatistiksel güç ve doğrulama (Hanley–McNeil, AUC = 0.80 için %95 aralık)

| Örneklem | Aralık |
|---|---|
| 20 + 20 (H19b genel) | 0.66–0.94 |
| 10 + 10 (katman) | 0.60–1.00; katman eşiği 0.70'te 0.47–0.93 |
| 40 + 40 (H19b + R2 birleşik) | 0.70–0.90 |

**Sonuç kuralı:**
- **1–5 geçerse:** Yalnız "H19c'ye geçiş" hakkı doğar. "D5 çözüldü" iddiası yapılmaz.
- **Doğrulama (H19b-R2):**
  - aynı mühürlü protokol ve aynı soru metni kullanılır;
  - 40 tamamen yeni vaka, hücre başına 10;
  - H19b'de kullanılan hiçbir fonksiyon tekrar kullanılmaz.
  - Promosyon veya genel iddia yalnız R2 de geçerse yapılır. Birleşik 40 + 40 AUC güven aralığıyla raporlanır.
- **1 veya 2 kalırsa:** D5 yalnız betimleyici olgu olarak kalır. Jev D5 için kullanılmaz.

## 5. Sonraki: H19c (ayrı ön kayıt)

Soru: **Olgu-koşullu Jev sinyali, aynı deterministik olgulara sahip ama Jev kullanmayan bir dispatcher'a göre
ileriye dönük ek değer sağlıyor mu?** Jev'siz taraf, olgulardan ve E katmanındaki kod kuralından kurulur.

## 6. Kapsam dışı

- H19 dosyaları ve DE-JEV-H19-R0 branch'i değişmez.
- Dispatcher'a, CI'a, `TASKS.md`'ye dokunulmaz.
