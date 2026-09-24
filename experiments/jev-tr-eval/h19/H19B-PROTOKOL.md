# H19b: olgu-koşullu D5, ileriye dönük test (ön kayıt)

**Durum:** Ön kayıt. Henüz vaka yok, Jev çağrısı yapılmadı. Bu dosya vakalar kurulmadan önce dondurulur
(SENTEZ K9, K11). Aşağıdaki eşikler ölçümden önce onaylanmalı. Ölçüm başladıktan sonra değiştirilen eşik
geçersiz sayılır.

**Hipotez:** Eşzamanlılık yapısını (S5) kod hesaplar ve olgu olarak verirse, Jev'in "davranışsal sonuç"
cevabı (J5) kilit ipucundan bağımsız olur ve gerçek etiketle ayrışır.

**Kapalı set:** DE-JEV-H19-R0 v0.1'in 16 vakası bu deneyde hiçbir tasarım seçimi için kullanılmaz.

## 1. Deterministik extractor (S5)

Olgular diff'ten değil, değişikliğin önceki ve sonraki **fonksiyon gövdesinden** hesaplanır (plpgsql
migration'ları).

| Olgu | Tanım (donmuş) |
|---|---|
| `lock_context` | Önceki gövdede `FOR UPDATE`, `FOR NO KEY UPDATE`, `pg_advisory_xact_lock`, `pg_advisory_lock` veya `SKIP LOCKED` var |
| `version_guard` | Güncellenen satırın `WHERE` koşulunda `version`, `*_version` veya `updated_at` karşılaştırması var |
| `changed_inside_locked_region` | Değişen satırlardan en az biri, aynı gövdede ilk kilit alımından sonra |
| `guard_delta` | Kilit veya `version_guard` önceden sonraya: `removed`, `added` ya da `unchanged` |
| `retry_path` | `exception when unique_violation`, `serialization_failure` veya `lock_not_available` dalı var |
| `transaction_boundary` | plpgsql fonksiyonu tek transaction'dır; yalnız `COMMIT`, `dblink` ya da iki RPC'ye bölünme varsa `changed` |

**Kısa devre (K11):**
- `guard_delta` `removed` ise D5 kodda "zayıflatıyor" olarak kararlaştırılır; `added` ise "güçlendiriyor".
- Bu vakalarda Jev'e sorulmaz. Bu vakalar extractor doğruluğu olarak ayrıca raporlanır.

Jev kolu yalnız `guard_delta = unchanged` olan artık (residual) vakaları görür.

**İpucu sözlüğü (H19a'dan aynen):**
`/for update|lock|version|advisory|serializ|skip locked|nowait/i`.
"İpucu yok" hücresindeki bir vakanın girdisinde, bağlam dahil hiçbir yerde bu sözlükten kelime geçmez. Bunu
script doğrular.
Not: `expectedVersion` benzeri bir alanın kaldırılması "version" kelimesini içerir. Ayrıca `version_guard`
olarak yakalanır ve kısa devreye girer. Bu yüzden B hücresine giremez.

## 2. 2×2 tasarım (yalnız residual vakalar)

| | İpucu/yapı var (`lock_context = true`) | İpucu/yapı yok |
|---|---|---|
| **Gerçek D5** | **A:** kilit duruyor ama güvence deliniyor. Ör. kontrolün kilit alımından öne taşınması, advisory kilit anahtarının daraltılması, kilit sonrası yeniden kontrolün silinmesi, kilidi atlayıp yazan erken dönüş. | **B:** yapı yok, yarış yaratılıyor. Ör. tek atomik `UPDATE … SET n = n - 1 WHERE n > 0` yerine önce `SELECT` sonra `UPDATE` (check-then-act), durum koşullu geçişte `AND status = 'pending'` koşulunun silinmesi, kilitsiz "say sonra ekle" kapasite kontrolü. |
| **D5 değil** | **C:** kilitli bölgede yalnız iş mantığı değişiyor. Ör. mesaj metni, yuvarlama, dönen JSON'a alan eklenmesi, girdi biçimi doğrulaması. | **D:** yapısız fonksiyonda yalnız iş mantığı değişiyor. |

- **Hücre başına 10 vaka, toplam 40 residual vaka.** Kısa devre vakaları ek olarak kurulur (10 adet;
  5 kaldırma, 5 ekleme).
- **Kaynak:** `supabase/migrations` içindeki gerçek fonksiyonlar. 24 Eylül sayımı: 73 migration; bunların 38'inde
  `for update`, 31'inde advisory lock, 23'ünde sürüm kalıbı var; 51 `on conflict`, 13 retry dalı.
- **Mutasyonlar** elle yazılmış küçük diff'lerdir. Her vaka `origin: synthetic | bench` alanını taşır.
  Bugünkü bench HIT'leri (customers D0×D5, D1×D5) varsa `bench` olarak eklenir. Metrikler kaynağa göre de
  ayrılır.
- **Etiket, gerekçesi ve hücresi** Jev çağrısından önce yazılır. Vaka dosyasının SHA-256'sı ölçümden önce
  commit'lenir.
- **İkinci okuyucu** (kullanıcı ya da H19 sahibi) rastgele en az 10 vakanın etiketini kontrol eder.
  Anlaşmazlık varsa vaka düşer. Jev sonucunu gördükten sonra etiket değiştirilmez.

## 3. Kollar (aynı vakalar)

| Kol | Girdi | Soru |
|---|---|---|
| **J (birincil)** | `facts` (S5) + tam hunk diff (H19a: bağlam gerçek kanıt taşıyor) | Tek Choice (aşağıda) |
| **V (kontrol)** | Yalnız tam diff; DE-JEV-H19-R0 v0.1 isteği aynen | 6 eksen noul |

Sondalar (vaka içi müdahale; H19a yöntemi):
- **İpucu enjeksiyonu:** B ve D vakalarına tek bağlam satırı `   for update;` eklenir.
  - J kolunda `facts` değişmez (`lock_context = false`). Etki yaklaşık 0 beklenir.
  - V kolunda H19a'daki +0.20'nin tekrarı beklenir.
- **Olgu çevirme:** J kolunda `lock_context` ve `changed_inside_locked_region` değerleri ters çevrilir. Bu,
  olgunun yeni ipucu olup olmadığını (öncüle kilitlenme) ölçer.

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

## 4. Kabul ölçütleri (öneri; ölçümden önce onaylanacak)

"Gerçek D5" için skor olarak J kolunda P(`weakens`) kullanılır.

| # | Ölçüt | Eşik | Karşılaştırma noktası |
|---|---|---|---|
| 1 | Anlamsal ayrışma: gerçek D5 ile D5 değil arasında AUC | genel ≥ 0.80; A–C ve B–D katmanlarının her birinde ≥ 0.70 | H19a D5 AUC 0.33–0.60 |
| 2 | İpucundan bağımsızlık: \|ort. P(weakens \| C) − ort. P(weakens \| D)\| | ≤ 0.10 | H19a ipucu etkisi +0.20 |
| 3 | İpucu enjeksiyonu (J kolu, B+D): ort. \|Δ P(weakens)\| | ≤ 0.05 | |
| 4 | Choice doğruluğu (argmax; `undetermined` yanlış sayılır) | ≥ %75; `undetermined` ≤ %20 | |
| 5 | V kolu H19a yönünü tekrarlamalı: enjeksiyonla D5 ≥ +0.10 | yoksa sonuç "karşılaştırılamaz" | |

Eşiksiz raporlananlar:
- olgu çevirme duyarlılığı;
- V kolunda r(ΔD1, ΔD5): ham, logit ve tavan etkisi ayıklanmış (H19a: 0.74 / 0.76 / 0.52);
- extractor kısa devre doğruluğu;
- token ve gecikme. Performans ayrıca H19-perf'te ölçülür; yetenek iddiasına karışmaz.

**Sonuç kuralı:**
- 1–4 geçerse → H19c'ye (dispatcher'da gölge kullanım) geçilir.
- 1 veya 2 kalırsa → D5 yalnız kodda hesaplanan bir olgu olarak kalır; Jev D5 için kullanılmaz.
- Hücre başına n=10 ile AUC'nin %95 güven aralığı yaklaşık ±0.2'dir. Bu eşikler "H19c'ye geç" içindir,
  promosyon için değil.

## 5. Kapsam dışı

- H19 dosyaları ve DE-JEV-H19-R0 branch'i değişmez.
- Dispatcher'a, CI'a, `TASKS.md`'ye dokunulmaz.
- H19c ayrı bir ön kayıttır.
