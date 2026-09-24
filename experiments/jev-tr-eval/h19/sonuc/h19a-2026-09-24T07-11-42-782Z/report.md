# H19a — bağlam ablation (2026-09-24T07:11:43.796Z)

Model jev-1.13.0; 16 dondurulmuş vaka; koşul başına 16 canlı çağrı.

## Koşullar ve sıralama metrikleri (aynı 16 vaka — yalnız karşılaştırma içindir, promosyon kanıtı değildir)

| Koşul | Soru | Girdi | Top-1 | Top-3 | MRR | ort. token |
|---|---|---|---|---|---|---|
| C1 | v0.1 | full | 25.0% | 56.3% | 0.482 | 897 |
| C2 | v0.1 | changed | 25.0% | 75.0% | 0.504 | 816 |
| C3 | v0.2 | full | 25.0% | 68.8% | 0.482 | 1137 |
| C4 | v0.2 | changed | 25.0% | 68.8% | 0.524 | 1056 |
| C5 | v0.1 | nolockctx | 25.0% | 62.5% | 0.485 | 888 |
| C6 | v0.1 | changed+lock | 25.0% | 56.3% | 0.469 | 820 |
| C7 | v0.2 | changed+lock | 25.0% | 62.5% | 0.507 | 1060 |

## D5: etikete göre ortalama P(evet)

| Koşul | etiketli | etiketsiz | etiketsiz, bağlamda kilit | etiketsiz, bağlamda kilit yok |
|---|---|---|---|---|
| C1 | 0.69 (n=6) | 0.64 (n=10) | 0.81 | 0.53 |
| C2 | 0.48 (n=6) | 0.53 (n=10) | 0.57 | 0.51 |
| C3 | 0.71 (n=6) | 0.66 (n=10) | 0.82 | 0.55 |
| C4 | 0.46 (n=6) | 0.54 (n=10) | 0.58 | 0.51 |
| C5 | 0.61 (n=6) | 0.61 (n=10) | 0.75 | 0.52 |
| C6 | 0.68 (n=6) | 0.73 (n=10) | 0.76 | 0.70 |
| C7 | 0.66 (n=6) | 0.74 (n=10) | 0.77 | 0.71 |

## D1: etikete göre ortalama P(evet)

| Koşul | etiketli | etiketsiz | etiketsiz, bağlamda kilit | etiketsiz, bağlamda kilit yok |
|---|---|---|---|---|
| C1 | 0.74 (n=6) | 0.48 (n=10) | 0.55 | 0.41 |
| C2 | 0.57 (n=6) | 0.35 (n=10) | 0.36 | 0.34 |
| C3 | 0.79 (n=6) | 0.52 (n=10) | 0.59 | 0.44 |
| C4 | 0.60 (n=6) | 0.37 (n=10) | 0.36 | 0.38 |
| C5 | 0.73 (n=6) | 0.46 (n=10) | 0.51 | 0.41 |
| C6 | 0.67 (n=6) | 0.47 (n=10) | 0.46 | 0.49 |
| C7 | 0.69 (n=6) | 0.53 (n=10) | 0.47 | 0.58 |

## Eşleştirilmiş farklar (aynı vaka, tek değişken)

| Karşılaştırma | Ne ölçer | Eksen | ort. Δ | artan / azalan / eşit (|Δ|<0.05) |
|---|---|---|---|---|
| C2 − C1 | girdi kapsamı (v0.1 soru) | D5 | -0.144 | 3 / 11 / 2 |
| C2 − C1 | girdi kapsamı (v0.1 soru) | D1 | -0.144 | 3 / 12 / 1 |
| C4 − C3 | girdi kapsamı (v0.2 soru) | D5 | -0.168 | 2 / 12 / 2 |
| C4 − C3 | girdi kapsamı (v0.2 soru) | D1 | -0.161 | 2 / 12 / 2 |
| C3 − C1 | soru kapsamı (tam diff) | D5 | +0.022 | 3 / 0 / 13 |
| C3 − C1 | soru kapsamı (tam diff) | D1 | +0.040 | 6 / 0 / 10 |
| C4 − C2 | soru kapsamı (yalnız +/-) | D5 | -0.001 | 1 / 2 / 13 |
| C4 − C2 | soru kapsamı (yalnız +/-) | D1 | +0.023 | 3 / 1 / 12 |
| C6 − C2 | yapay kilit satırı ekle (v0.1) | D5 | +0.195 | 13 / 1 / 2 |
| C6 − C2 | yapay kilit satırı ekle (v0.1) | D1 | +0.111 | 12 / 1 / 3 |
| C7 − C4 | yapay kilit satırı ekle (v0.2) | D5 | +0.195 | 13 / 1 / 2 |
| C7 − C4 | yapay kilit satırı ekle (v0.2) | D1 | +0.132 | 12 / 1 / 3 |
| C1 − C5 | gerçek kilit bağlamını geri koy (yalnız kilit bağlamlı 7 vaka) | D5 | +0.099 | 4 / 0 / 3 |
| C1 − C5 | gerçek kilit bağlamını geri koy (yalnız kilit bağlamlı 7 vaka) | D1 | +0.046 | 3 / 0 / 4 |

## Vaka bazında P(D5)

| Vaka | D5 etiketli | bağlamda kilit | C1 | C2 | C3 | C4 | C5 | C6 | C7 |
|---|---|---|---|---|---|---|---|---|---|
| C01 | hayır | var | 0.82 | 0.58 | 0.84 | 0.58 | 0.78 | 0.62 | 0.60 |
| C02 | hayır | — | 0.83 | 0.71 | 0.87 | 0.75 | 0.80 | 0.87 | 0.91 |
| C03 | hayır | — | 0.11 | 0.16 | 0.12 | 0.15 | 0.10 | 0.48 | 0.59 |
| C04 | hayır | var | 0.89 | 0.79 | 0.91 | 0.84 | 0.85 | 0.90 | 0.91 |
| C05 | evet | var | 0.75 | 0.70 | 0.80 | 0.53 | 0.68 | 0.64 | 0.49 |
| C06 | evet | — | 0.81 | 0.69 | 0.82 | 0.71 | 0.80 | 0.83 | 0.84 |
| C07 | hayır | var | 0.76 | 0.40 | 0.77 | 0.42 | 0.76 | 0.77 | 0.79 |
| C08 | evet | var | 0.92 | 0.56 | 0.94 | 0.61 | 0.65 | 0.66 | 0.72 |
| C09 | hayır | — | 0.75 | 0.78 | 0.74 | 0.77 | 0.76 | 0.76 | 0.71 |
| C10 | evet | var | 0.83 | 0.21 | 0.85 | 0.14 | 0.71 | 0.57 | 0.53 |
| C11 | hayır | — | 0.65 | 0.48 | 0.68 | 0.50 | 0.62 | 0.69 | 0.65 |
| C12 | evet | — | 0.42 | 0.26 | 0.39 | 0.26 | 0.44 | 0.68 | 0.71 |
| C13 | hayır | var | 0.76 | 0.51 | 0.78 | 0.48 | 0.61 | 0.76 | 0.78 |
| C14 | hayır | — | 0.65 | 0.63 | 0.71 | 0.65 | 0.65 | 0.75 | 0.75 |
| C15 | hayır | — | 0.18 | 0.30 | 0.20 | 0.26 | 0.20 | 0.66 | 0.66 |
| C16 | evet | — | 0.38 | 0.44 | 0.45 | 0.53 | 0.39 | 0.68 | 0.66 |
