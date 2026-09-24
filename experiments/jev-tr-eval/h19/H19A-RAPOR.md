# H19a: D5 bağlam ablation deneyi (24 Eylül 2026)

**Soru:** D5'in (eşzamanlılık/sürüm) neredeyse her vakada yüksek çıkmasının sebebi girdideki kilit
kelimeleri mi, soru kapsamı mı, yoksa gerçek bir anlamsal sinyal mi?

**Yöntem:** DE-JEV-H19-R0 v0.1'in 16 dondurulmuş vakası kullanıldı; kaynak branch'teki girdiler
değiştirilmedi ([`kaynak/`](kaynak/), [`PROVENANCE.json`](kaynak/PROVENANCE.json)). Her koşulda aynı vakada
tek bir değişken değiştirildi. Model `jev-1.13.0` sabit. Koşul başına 16 canlı çağrı yapıldı, toplam 112.
Hiçbir şey ayarlanmadı; bu bir duyarlılık ölçümüdür, v0.2'nin doğruluk ölçümü değildir.

| Koşul | Soru | Girdi |
|---|---|---|
| C1 | v0.1 (soru bankası aynen) | tam diff |
| C2 | v0.1 | yalnız `+`/`-` satırları (hunk başlığı çıplak) |
| C3 | v0.2 ("yalnız `+`/`-` satırlarını değerlendir; bağlam sayılmaz") | tam diff |
| C4 | v0.2 | yalnız `+`/`-` |
| C5 | v0.1 | tam diff, kilit kelimesi geçen bağlam satırları çıkarılmış |
| C6 | v0.1 | yalnız `+`/`-` + tek yapay bağlam satırı `   for update;` |
| C7 | v0.2 | yalnız `+`/`-` + aynı yapay satır |

Çalıştırma: `NODE_USE_ENV_PROXY=1 node h19/h19a.mjs`. API'siz ikinci analiz:
`node h19/h19a-analiz.mjs h19/sonuc/h19a-<ts>`.
Ham çıktılar: [`sonuc/h19a-2026-09-24T07-11-42-782Z/`](sonuc/h19a-2026-09-24T07-11-42-782Z/)
(`report.md`, `analiz.md` ve koşul başına `facts-C*.json`).

**Tekrar üretim:** C1, önceki iki turun isteğini yeniden kuruyor. C1 ile önceki turlar arasındaki eksen
olasılığı farkı ortalama 0.014. Bu, önceki iki turun kendi aralarındaki farka (0.015) eşit. Yani isteği
doğru kopyaladık; aşağıdaki 0.1–0.2'lik etkiler ise tur gürültüsünün 10 katından büyük.

## Bulgular

**1. Soru kapsamı talimatı işlemiyor.**
- v0.2'nin "bağlam satırları sayılmaz" cümlesi D5'i değiştirmedi:
  - C3 − C1: ort. +0.02; 16 vakanın 13'ünde |Δ| < 0.05.
  - C4 − C2: 0.00; 13 vakada eşit.
- D1'i beklenenin tersine biraz artırdı: C3 − C1 +0.04, 6 artan / 0 azalan, p = 0.031.
- En net kanıt: yapay kilit satırının etkisi v0.2'de de aynı kaldı. Talimat "bağlamı sayma" dediği halde
  C7 − C4 = C6 − C2 = **+0.195**.

**2. Tek bir kilit kelimesi D5'i etiketten bağımsız olarak yaklaşık +0.20 artırıyor.**
Değişen satırların hiçbirinde kilit kelimesi yok. Bu yüzden C2/C4 girdisinde kilit kelimesi hiç yok,
C6/C7 girdisinde ise tek satır var:

| | kilit kelimesi yok (C2) | tek kilit satırı (C6) | etki |
|---|---|---|---|
| D5 etiketli (n=6) | 0.48 | 0.68 | +0.20 |
| D5 etiketsiz (n=10) | 0.53 | 0.73 | +0.19 |
| etiket etkisi | −0.05 | −0.05 | |

- Eşleştirilmiş sonuç: 13 vakada artış, 1'de azalış, p = 0.0018. v0.2'de de aynı.
- D1 de aynı satırla artıyor: +0.11 / +0.13, 12 artan / 1 azalan, p = 0.0034.
- Uç örnekler (C2 → C6):
  - C03 (D0×D4, zaman sınırı) 0.16 → 0.48;
  - C15 (D0×D4) 0.30 → 0.66;
  - C12 (D2×D5) 0.26 → 0.68.

**3. Yalnız değişen satırları vermek de çözüm değil.**
- C2 − C1: D5 −0.14, 11 azalan; D1 −0.14, 12 azalan.
- C4 − C3: her iki eksende 12 azalan, p = 0.013.
- Ama düşüş etiketli D5'te de oluyor: 0.69 → 0.48; C10 0.83 → 0.21, C08 0.92 → 0.56. Yani bağlam, gerçek D5
  vakalarında gerçek kanıtın bir parçası (değişikliğin bir kilit bölgesinde olması).
- D5 AUC (ayrışma; 0.5 = ayrışma yok):

  | C1 | C2 | C3 | C4 | C5 | C6 | C7 |
  |---|---|---|---|---|---|---|
  | 0.57 | 0.40 | 0.60 | 0.41 | 0.45 | 0.33 | 0.35 |

  **Hiçbir koşulda D5 ayrışmıyor**; yalnız seviyesi değişiyor.

**4. Gerçek kilit bağlamını çıkarmak etkiyi kısmen geri alıyor.**
- Bu karşılaştırma yalnız bağlamında kilit kelimesi olan 7 vakada yapıldı.
- C1 − C5 = +0.10 (4 artan / 0 azalan, p = 0.13).
- Yapay satırdan küçük, çünkü C5'te diğer bağlam satırları duruyor.

**5. Sıralama metrikleri hiçbir koşulda anlamlı değişmedi.**
- Top-1 her koşulda 4/16.
- Top-3 9–12/16 aralığında. Aynı girdiyle yapılan üç tur 9, 10 ve 11 verdi; yani koşullar arası top-3
  farkları tur gürültüsü içinde.
- D1×D5 çekim noktası her koşulda 7/16 (C5'te 8/16). Hiçbir müdahale onu kırmadı.

**6. Diğer eksenler.**
- D3 ve D4 her koşulda sağlam (AUC ≥ 0.83).
- D1 yalnız değişen satırlarla biraz kaybediyor (0.85 → 0.72).
- D0 kazanıyor (0.70 → 0.83–0.88). Ama kazanç 2 vakadan geliyor (C08 0.58 → 0.23, C15 0.46 → 0.69) ve
  bağlamda kiracı kelimesi kalıbı yok. Açıklanamadı, genellenmemeli.

## Yorum

Bu biçimiyle Jev'in D5 cevabı pratikte "metinde bir kilit/eşzamanlılık işareti var mı" sorusunun cevabı.
"Değişen satırlar eşzamanlılık davranışını değiştiriyor mu" sorusunu yanıtlamıyor. İki aday düzeltmenin
hiçbiri bunu çözmüyor:
- **Prompt kapsamı (v0.2):** Etkisiz. Jev'in kelimesi kelimesine okuma eğilimi talimatla bastırılamıyor.
- **Bağlamı atmak:** Önyargıyla birlikte gerçek kanıtı da atıyor.

Deterministik ilke (SENTEZ K1/K2): Bir regex'in bulabildiği işaret, modelin sezmesine bırakılmaz; kodun
ürettiği bir olgu olur. Buna göre D5 için v0.2 önerisi şöyle (henüz ölçülmedi, yeni vakalarda ölçülmeli):

1. Kod, `lock_context` olgusunu hesaplar: hunk'ta veya fonksiyonda `for update`, advisory lock, `version`
   kontrolü var mı ve değişen satırlar o bölgenin içinde mi. Bu olgu `state` içinde açıkça verilir.
2. Jev'e artık "D5'e dokunuyor mu" diye sorulmaz. Olgu verildikten sonra değişen satırların etkisi sorulur:
   kilide göre sıralama değişti mi, sürüm/çakışma kontrolü kaldırıldı mı, yeniden deneme davranışı değişti mi.
   Mümkünse küçük bir Choice olarak sorulur.
3. Ölçüm, senin önerdiğin D5 2×2 ile ve **yeni vakalarla** yapılır. Dört hücrenin hepsinde vaka olmalı:
   - gerçek D5, kilit kelimesi yok (ör. `updated_at` / sürüm kontrolünün kaldırılması);
   - D5 değil, kilit kelimesi yakında.

   Bugünkü bench HIT'lerinden customers D0×D5 ve D1×D5 ilk adaylar.

## Sınırlar

- n = 16 ve her koşul tek tur. Tur gürültüsü küçük (0.015), ama sıralama metrikleri bu boyutta oynak.
- Etiket tek hedef çift. "Etiketsiz" vakaların bir kısmı gerçekte D5'e dokunuyor olabilir (ör. C01). Bu
  yüzden etiket etkisinin sıfır çıkması kısmen etiket gürültüsü olabilir. Kilit kelimesinin etkisi ise
  etiketten bağımsız olarak ölçüldü.
- Yapay satır anlamca boş değil: bir inceleyici de `FOR UPDATE` yakınındaki bir değişikliği biraz daha
  şüpheli bulur. Sorun şu iki noktada:
  - etkinin etiketten bağımsız ve büyük olması;
  - "bağlamı sayma" talimatına rağmen hiç azalmaması.
- Bu 16 vaka üzerinde hiçbir eşik, soru veya girdi politikası seçilmemeli. Eksen bazında farklı girdi
  politikası (D0 için yalnız değişen satırlar, D1/D4 için tam diff) cazip görünüyor, ama aynı vakalardan
  türetildiği için yeni vakalarda doğrulanmadan kullanılmamalı.

## Mühür cümlesi (güncellenmiş öneri)

> Jev-1.13.0 demonstrates reproducible, above-random sensitivity to H19 axis structure on the frozen
> DE-JEV-H19-AXIS v0.1 benchmark. A within-case ablation shows that its D5 answer tracks lexical lock
> cues (+0.20 for one injected context line, independent of the label), is not corrected by a
> changed-lines-only instruction, and loses real evidence when context is removed; D5 must not be
> calibrated or promoted until a code-owned lock-context fact is tested on prospective cases.

## English handoff for the DE-JEV-H19-R0 owner

Within-case ablation on your frozen v0.1 inputs (unchanged), pinned `jev-1.13.0`, 7 conditions × 16 cases.
The replication condition matches your runner (mean |Δ| 0.014 vs run-to-run 0.015).
- A changed-lines-only instruction (v0.2 wording) has no effect on D5 (mean Δ 0.00–0.02; 13/16 unchanged).
- One injected context line `for update;` raises P(D5) by +0.20 on both labeled and unlabeled cases (13 up /
  1 down, p = 0.0018), with and without that instruction.
- Stripping context lowers D5 and D1 (−0.14 to −0.17) but also removes true-D5 evidence (labeled D5 0.69 →
  0.48). D5 AUC is 0.33–0.60 in every condition.
- Top-1 stays at 4/16 and D1×D5 stays the top pair in 7/16 cases throughout.

Suggestion: compute a lock-context fact in code, pass it in state, and ask about the changed lines' effect
given that fact. Measure it on new bench HITs with a D5 × lock-cue 2×2, not on these 16.
Files: `experiments/jev-tr-eval/h19/` on `claude/upbeat-maxwell-kiof98`.
