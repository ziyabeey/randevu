# H19a — ikinci analiz (h19a-2026-09-24T07-11-42-782Z)

## Tekrar üretim: C1 (v0.1, tam diff) ile önceki iki tur

C1, DE-JEV-H19-R0 çalıştırıcısının isteğini yeniden kuruyor; önceki turlar o çalıştırıcıyla yapıldı.

| Karşılaştırma | ort. |Δ| | en büyük |Δ| |
|---|---|---|
| tur 1 − tur 2 | 0.015 | 0.06 |
| C1 − tur 1 | 0.014 | 0.13 |
| C1 − tur 2 | 0.014 | 0.08 |

## Eksen bazında ayrışma (AUC; 0.5 = ayrışma yok, 1.0 = tam)

| Eksen | etiketli n | C1 | C2 | C3 | C4 | C5 | C6 | C7 |
|---|---|---|---|---|---|---|---|---|
| D0 | 8 | 0.70 | 0.83 | 0.70 | 0.88 | 0.77 | 0.87 | 0.84 |
| D1 | 6 | 0.85 | 0.72 | 0.85 | 0.72 | 0.87 | 0.78 | 0.72 |
| D2 | 4 | 0.65 | 0.56 | 0.67 | 0.56 | 0.60 | 0.69 | 0.61 |
| D3 | 3 | 0.97 | 0.92 | 1.00 | 0.95 | 0.97 | 0.92 | 0.95 |
| D4 | 5 | 0.95 | 0.88 | 0.95 | 0.93 | 0.95 | 0.85 | 0.83 |
| D5 | 6 | 0.57 | 0.40 | 0.60 | 0.41 | 0.45 | 0.33 | 0.35 |

## D5 2×2: etiket × kilit kelimesi (yalnız +/- girdisi; kilit = tek yapay bağlam satırı)

Değişen satırların hiçbirinde kilit kelimesi yok; C2/C4 girdisinde kilit kelimesi hiç yok, C6/C7 girdisinde tek satır var.

| Soru | Etiket | kilit yok | kilit var | kilit etkisi |
|---|---|---|---|---|
| v0.1 | D5 etiketli (n=6) | 0.48 | 0.68 | +0.20 |
| v0.1 | D5 etiketsiz (n=10) | 0.53 | 0.73 | +0.19 |
| v0.2 | D5 etiketli (n=6) | 0.46 | 0.66 | +0.19 |
| v0.2 | D5 etiketsiz (n=10) | 0.54 | 0.74 | +0.20 |

## En üst çift

| Koşul | D1xD5 en üstte | en sık en üst çiftler |
|---|---|---|
| C1 | 7/16 | D1xD5 7, D0xD3 2, D3xD5 2 |
| C2 | 7/16 | D1xD5 7, D0xD3 2, D3xD5 2 |
| C3 | 7/16 | D1xD5 7, D0xD3 2, D3xD5 2 |
| C4 | 7/16 | D1xD5 7, D0xD3 2, D3xD5 2 |
| C5 | 8/16 | D1xD5 8, D0xD3 2, D3xD4 1 |
| C6 | 7/16 | D1xD5 7, D4xD5 3, D0xD5 2 |
| C7 | 7/16 | D1xD5 7, D0xD5 3, D4xD5 2 |

## Eşleştirilmiş işaret testi (P(evet) farkı, aynı vaka)

| Karşılaştırma | Eksen | artan / azalan / eşit | p (iki yönlü) |
|---|---|---|---|
| C2 − C1 | D5 | 3 / 11 / 2 | 0.057 |
| C2 − C1 | D1 | 3 / 12 / 1 | 0.035 |
| C4 − C3 | D5 | 2 / 12 / 2 | 0.013 |
| C4 − C3 | D1 | 2 / 12 / 2 | 0.013 |
| C3 − C1 | D5 | 3 / 0 / 13 | 0.25 |
| C3 − C1 | D1 | 6 / 0 / 10 | 0.031 |
| C4 − C2 | D5 | 1 / 2 / 13 | 1.0 |
| C4 − C2 | D1 | 3 / 1 / 12 | 0.63 |
| C6 − C2 | D5 | 13 / 1 / 2 | 0.0018 |
| C6 − C2 | D1 | 12 / 1 / 3 | 0.0034 |
| C7 − C4 | D5 | 13 / 1 / 2 | 0.0018 |
| C7 − C4 | D1 | 12 / 1 / 3 | 0.0034 |
| C1 − C5 (7 vaka) | D5 | 4 / 0 / 3 | 0.13 |
| C1 − C5 (7 vaka) | D1 | 3 / 0 / 4 | 0.25 |

## Kilit satırı eklenince eksenlerin ortak hareketi

Ortalama Δ P(evet) (artan/azalan, |Δ| ≥ 0.05):

| Karşılaştırma | D0 | D1 | D2 | D3 | D4 | D5 |
|---|---|---|---|---|---|---|
| C6 − C2 | +0.041 (4/1) | +0.111 (12/1) | +0.055 (9/1) | +0.019 (3/1) | -0.013 (0/2) | +0.195 (13/1) |
| C7 − C4 | +0.043 (5/1) | +0.132 (12/1) | +0.054 (8/0) | +0.011 (3/1) | -0.011 (0/2) | +0.195 (13/1) |

| Karşılaştırma | r(ΔD1, ΔD5) | permütasyon p | logit r | tavan etkisi ayıklanmış kısmi r |
|---|---|---|---|---|
| C6 − C2 | 0.74 | 0.0009 | 0.76 | 0.52 |
| C7 − C4 | 0.75 | 0.0004 | 0.78 | 0.53 |
