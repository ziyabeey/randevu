# DE-JEV-H19-R0 — ilk canlı Jev ölçümü (24 Eylül 2026)

Kaynak: `exp/de-jev-h19-r0-shadow-20260924` @ `0d496d7` (ziyabeey1-ai). Bu çalışma o branch'i
**değiştirmeden**, ayrı bir salt-okunur kopyada, onların kendi çalıştırıcısı
(`scripts/run-h19-axis-jev-shadow.mjs`) ve skorlayıcısıyla (`scripts/h19-axis-shadow-score.mjs`) yapıldı.
Model `jev-1.13.0` (sabit), soru bankası `DE-JEV-H19-AXIS` v0.1.0, 16 dondurulmuş vaka, iki bağımsız tur
(önbelleksiz, her turda 16 canlı çağrı). Ham çıktılar: [`sonuc/`](sonuc/).

## Sonuç

| | Rastgele beklenti | Tur 1 | Tur 2 |
|---|---|---|---|
| Beklenen çift 1. sırada | 1/15 = %6.7 | **4/16 = %25** | 4/16 = %25 |
| Beklenen çift ilk 3'te | 3/15 = %20 | **11/16 = %68.8** | 10/16 = %62.5 |
| MRR | ≈ 0.22 | **0.50** | 0.49 |
| Prospective (14) top-3 | %20 | %64.3 | %57.1 |
| Holdout (2) top-3 | %20 | 2/2 | 2/2 |
| Prospective'te en üste holdout çifti koyma | — | %7.1 | %14.3 |

Şans dışı: rastgele sıralamanın top-1'de ≥ 4/16 başarma olasılığı ≈ 0.019, top-3'te ≥ 10/16 ≈ 0.0002.
Turlar arası eksen olasılığı farkı ortalama 0.015 (en fazla 0.06); top-3 farkı sınırdaki bir vakadan.

## Eksen bazında (tur 1, eşik 0.5)

| Eksen | Ort. P(evet), etiketli | Ort. P(evet), etiketsiz | Etiketlide "evet" | Etiketsizde "evet" |
|---|---|---|---|---|
| D0 kiracı/yetki | 0.47 | 0.21 | 4/8 | 1/8 |
| D1 atomiklik/idempotency | 0.74 | 0.48 | 6/6 | 5/10 |
| D2 snapshot/politika | 0.48 | 0.34 | 2/4 | 3/12 |
| D3 personel/kapasite | **0.82** | **0.16** | 3/3 | 1/13 |
| D4 zaman/sınır | **0.59** | **0.10** | 3/5 | 1/11 |
| D5 eşzamanlılık/sürüm | 0.69 | **0.64** | 4/6 | **8/10** |

- **D3 ve D4 iyi ayrışıyor.**
- **D5 neredeyse her vakada yüksek** (etiketsizde 0.64); D1 de yüksek eğilimli. Sonuç: 16 vakanın 6'sında
  en üst çift `D1xD5` (çekim noktası).
- D0 ve D2 zayıf (etiketlide ancak yarısı "evet").

## D5 eğilimi üzerine gözlem (hipotez, doğrulanmadı)

Kilit ifadeleri (`for update`, `lock`, `version`…) hiçbir vakada **değişen** satırlarda yok; 7 vakada
yalnız çevre bağlam satırlarında var. D5 etiketsiz vakalarda bağlamda kilit ifadesi olanlarda ort. P(D5)
0.81, olmayanlarda 0.53. Jev'in kelimesi kelimesine okuma eğilimiyle (TypeSafe jaggedness #1) uyumlu, ama
tek başına açıklamıyor (ör. C02, C09 bağlamda kilit olmadan 0.83 / 0.75).

**Etiket sınırı:** etiket, H19'un hedeflediği tek çifttir; mutantın dokunduğu tüm eksenler değildir. Ör. C01
`f11_lock_order_final_repair` içinde kilit sonrası yeniden planlamayı kaldırıyor; D5 "yanlış evet"i gerçekte
doğru olabilir. Eksen bazındaki "yanlış evet" sayıları bu yüzden üst sınırdır.

## Kaynak branch'te bulunan hata

`tests/h19-axis-benchmark-artifacts.test.mjs` satır 33 derlenmiyor (`SyntaxError: Invalid regular
expression flags`):

```js
const forbidden = /\\bH19\\b|EXP-H19|exp\\/h19|\\bD[0-5]\\s*[x×]\\s*D[0-5]\\b/i;
```

Regex literal içindeki `\\/` kaçışı literal'i erken bitiriyor. Muhtemel düzeltme: `\\` yerine `\` (ör.
`/\bH19\b|EXP-H19|exp\/h19|\bD[0-5]\s*[x×]\s*D[0-5]\b/i`). Diğer 11 test geçiyor.

## Öneriler (v0.1 sonuçlarını değiştirmeden)

1. **v0.2 hipotezi:** Soruların kapsamını değişen satırlara bağlamak ("yalnız `+`/`-` satırları sayılır; bağlam
   satırları sayılmaz") ya da bağlam satırlarını girdiden çıkarmak. Bu 16 vakaya bakılarak yazıldığı için
   **aynı 16 vakayla değil**, yeni vakalarla ölçülmeli.
2. **Hazır yeni veri:** Bugünkü bench turlarının temiz üç kollu HIT'leri (customers D0×D5, products D0×D2,
   customers D1×D5, expenses D1×D2, reporting D2×D4) v0.1 ile v0.2'yi karşılaştırmak için doğal yeni settir.
3. **Etiket zenginleştirme:** Tek çift yerine "mutantın dokunduğu eksenler" (çoklu etiket) tutulursa eksen
   bazında doğruluk ölçülebilir; çift sıralaması ayrı metrik olarak kalır.
4. n = 16 küçük; promosyon eşiği konmadan önce en az yeni setle ikinci ölçüm gerekli.

## English handoff for the DE-JEV-H19-R0 owner

Ran your unmodified runner/scorer at `0d496d7` with pinned `jev-1.13.0`, two uncached runs of 16 cases.
Top-1 25% (random 6.7%), top-3 68.8% / 62.5% (random 20%), MRR 0.50 / 0.49 (random ≈ 0.22); run-to-run axis
probability delta mean 0.015. D3/D4 discriminate well; D5 is high regardless of label (0.64 mean on
unlabeled cases) and D1×D5 is the top pair in 6/16 cases. Lock keywords appear only in unchanged context
lines, which may drive D5 via literal reading; test a changed-lines-only scope as v0.2 on today's new bench
HITs, not on these 16. `tests/h19-axis-benchmark-artifacts.test.mjs:33` fails to parse (regex literal escaping).
Facts and scores: `experiments/jev-tr-eval/h19/sonuc/` on `claude/upbeat-maxwell-kiof98`.

## Devamı

D5 eğilimi üzerine bağlam ablation deneyi (H19a): [`H19A-RAPOR.md`](H19A-RAPOR.md).
