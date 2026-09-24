# H19b′ sonuçları (2026-09-24T08-41-42-192Z)

Protokol: H19B-PRIME-PROTOKOL v0.1 (5bc1aed). Analiz kodu ölçümden önce yazıldı.
Düşen vakalar (kör okuyucu uyuşmazlığı ve eşleri): yok. Analizdeki vaka: 64.

## Birincil çapraz: B′ (gerçek D5, ipucu yok) ile C′ (D5 değil, kilit bağlamı var)

| Kol | AUC(B′, C′) |
|---|---|
| JF (facts + Choice) | 0.82 |
| J0 (Choice, facts yok) | 0.86 |
| V (eski D5) | 0.92 |

## Kapılar

| Kapı | Ölçüt | Değer | Eşik | Sonuç |
|---|---|---|---|---|
| P1 | AUC_JF − AUC_V (B′,C′) | -0.100 (bootstrap %95: -0.264 … 0.041) | ≥ 0.10, alt sınır > 0 | **kaldı** |
| P1 | AUC_JF (B′,C′) | 0.82 | ≥ 0.80 | **geçti** |
| P2 | AUC_JF − AUC_J0 (B′,C′) | -0.035 (bootstrap %95: -0.139 … 0.049) | ≥ 0.05, alt sınır ≥ 0 | **kaldı** |
| P2 | C′ ort. detection JF − J0 | 0.058 | ≤ +0.05 | **kaldı** |
| P3 | JF1 AUC genel / A′–C′ / B′–D′ | 0.89 / 0.98 / 0.78 | ≥ 0.80 / 0.75 / 0.75 | **geçti** |
| P4 | no_effect doğruluğu C′ / D′ | %56.3 / %37.5 | ≥ %75 / %75 | **kaldı** |
| P4 | \|C′ − D′\| ort. detection | 0.067 | ≤ 0.10 | **geçti** |
| P5 | yön doğruluğu genel / weakens / strengthens | %71.9 / %87.5 / %56.3 | ≥ %80 / %75 / %75 | **kaldı** |
| P5 | undetermined (A′+B′) | %0.0 | ≤ %15 | **geçti** |
| P6 | JF1–JF2 ort. \|Δ detection\| | 0.020 | ≤ 0.05 | **geçti** |
| P6 | yön argmax uyumu (A′+B′) / tüm vakalar | %87.5 / %93.8 | ≥ %90 | **kaldı** |
| P6 | AUC_JF1 − AUC_JF2 (B′,C′) | 0.006 | ≤ 0.10 | **geçti** |

**Sonuç kuralı (§11):** P1 kaldı → JF mevcut V yöntemini geçmedi; H19c açılmaz. J0, JF'den iyi: K11 bu kullanımda negatif katkı olarak raporlanır.

## İkincil (eşiksiz)

### Hücre AUC ve ortalamalar

| Kol | genel | A′–C′ | B′–D′ | B′–C′ | A′–D′ | ort. A′ | ort. B′ | ort. C′ | ort. D′ |
|---|---|---|---|---|---|---|---|---|---|
| JF1 | 0.89 | 0.98 | 0.78 | 0.82 | 0.98 | 0.94 | 0.82 | 0.49 | 0.55 |
| JF2 | 0.88 | 0.98 | 0.76 | 0.81 | 0.97 | 0.95 | 0.81 | 0.49 | 0.57 |
| J0 | 0.86 | 0.96 | 0.70 | 0.86 | 0.91 | 0.94 | 0.84 | 0.43 | 0.69 |
| V | 0.93 | 0.97 | 0.86 | 0.92 | 0.95 | 0.88 | 0.76 | 0.33 | 0.46 |

### Eşlenmiş fonksiyon çiftleri: pozitif skor > negatif skor oranı

| Kol | A′ > C′ | B′ > D′ |
|---|---|---|
| JF1 | 16/16 | 13/16 |
| J0 | 15/16 | 12/16 |
| V | 15/16 | 14/16 |

### C′ ve D′ yanlış pozitif profili (eksene göre, JF1 argmax ≠ no_effect / ort. detection; V ort. P(D5))

| Eksen | C′ JF1 | C′ V | D′ JF1 | D′ V |
|---|---|---|---|---|
| D0 | 1/4 · 0.45 | 0.24 | 4/4 · 0.82 | 0.48 |
| D2 | 2/4 · 0.47 | 0.45 | 1/4 · 0.35 | 0.40 |
| D3 | 3/4 · 0.70 | 0.44 | 4/4 · 0.66 | 0.41 |
| D4 | 1/4 · 0.32 | 0.20 | 1/4 · 0.39 | 0.56 |

### A′/B′ yön hataları (JF1 / J0)

| Vaka | hücre | etiket | JF1 | J0 | aileler |
|---|---|---|---|---|---|
| AP01 | A′ | weakens | strengthens | weakens | check_before_lock |
| AP02 | A′ | strengthens | weakens | strengthens | stale_token |
| AP04 | A′ | strengthens | weakens | strengthens | stale_token |
| AP10 | A′ | strengthens | weakens | strengthens | stale_token |
| AP12 | A′ | weakens | weakens | no_effect | snapshot_refresh, surface_protective |
| AP13 | A′ | weakens | weakens | strengthens | key_scope, surface_protective |
| AP14 | A′ | weakens | strengthens | strengthens | clock_after_wait |
| BP02 | B′ | strengthens | weakens | weakens | window_boundary |
| BP09 | B′ | strengthens | strengthens | weakens | upsert_semantics |
| BP10 | B′ | strengthens | weakens | weakens | check_then_act |
| BP14 | B′ | strengthens | strengthens | undetermined | helper_delegation |
| BP15 | B′ | strengthens | no_effect | undetermined | helper_delegation |
| BP16 | B′ | strengthens | no_effect | undetermined | helper_delegation |

### Önceden işaretlenmiş aileler: JF1 hata oranı (D5 için yön, D5 değil için no_effect dışı seçim)

| Aile | vaka | JF1 hata | J0 hata |
|---|---|---|---|
| cas_predicate | 2 | 0 | 0 |
| check_before_lock | 2 | 1 | 0 |
| check_then_act | 3 | 1 | 1 |
| clock_after_wait | 1 | 1 | 1 |
| helper_delegation | 4 | 2 | 3 |
| key_scope | 2 | 0 | 1 |
| lease_guard | 3 | 0 | 0 |
| removed_predicate | 11 | 8 | 8 |
| share_fence | 2 | 0 | 0 |
| snapshot_refresh | 1 | 0 | 1 |
| stale_token | 8 | 3 | 0 |
| surface_protective | 5 | 0 | 2 |
| upsert_semantics | 2 | 0 | 1 |
| window_boundary | 2 | 1 | 1 |

### Jev'siz naif tabanlar (ölçümden önce hesaplandı)

| Özellik | genel | A′–C′ | B′–D′ | B′–C′ |
|---|---|---|---|---|
| diff boyutu (değişen satır) | 0.51 | 0.30 | 0.71 | 0.47 |
| eklenen satır | 0.54 | 0.31 | 0.73 | 0.46 |
| silinen satır | 0.58 | 0.52 | 0.66 | 0.68 |
| silinen and/where oranı | 0.48 | 0.53 | 0.42 | 0.56 |
| eklenen exists/select | 0.44 | 0.33 | 0.56 | 0.41 |
| eklenen raise | 0.53 | 0.56 | 0.50 | 0.47 |
| yalnız olgular (lock_context + inside) | 0.53 | 0.63 | 0.50 | 0.00 |

### V kolunda D1–D5 eş hareketi

r(P(D1), P(D5)) tüm vakalar: 0.79; ort. P(D1) A′/B′/C′/D′: 0.58 / 0.75 / 0.30 / 0.43.

### Token ve gecikme

| Kol | ort. token | ort. gecikme (ms) |
|---|---|---|
| JF1 | 719 | 455 |
| JF2 | 719 | 409 |
| J0 | 643 | 408 |
| V | 883 | 371 |

### Vaka bazında

| Vaka | hücre | etiket | eksen | JF1 seçim | JF1 det | JF2 det | J0 seçim | J0 det | V P(D5) |
|---|---|---|---|---|---|---|---|---|---|
| AP01 | A′ | weakens | D5 | strengthens | 0.96 | 0.96 | weakens | 0.96 | 0.77 |
| CP01 | C′ | no_effect | D4 | strengthens | 0.85 | 0.88 | strengthens | 0.83 | 0.51 |
| AP02 | A′ | strengthens | D5 | weakens | 0.93 | 0.95 | strengthens | 0.99 | 0.95 |
| CP02 | C′ | no_effect | D2 | weakens | 0.71 | 0.64 | weakens | 0.55 | 0.67 |
| AP03 | A′ | weakens | D5 | weakens | 0.97 | 0.95 | weakens | 0.98 | 0.93 |
| CP03 | C′ | no_effect | D0 | no_effect | 0.32 | 0.37 | no_effect | 0.48 | 0.20 |
| AP04 | A′ | strengthens | D5 | weakens | 0.93 | 0.92 | strengthens | 0.98 | 0.95 |
| CP04 | C′ | no_effect | D2 | no_effect | 0.10 | 0.14 | no_effect | 0.02 | 0.06 |
| AP05 | A′ | weakens | D5 | weakens | 0.96 | 0.96 | weakens | 0.99 | 0.93 |
| CP05 | C′ | no_effect | D2 | no_effect | 0.20 | 0.28 | no_effect | 0.05 | 0.16 |
| AP06 | A′ | strengthens | D5 | strengthens | 0.93 | 0.93 | strengthens | 0.99 | 0.95 |
| CP06 | C′ | no_effect | D4 | no_effect | 0.25 | 0.24 | no_effect | 0.11 | 0.16 |
| AP07 | A′ | strengthens | D5 | strengthens | 0.94 | 0.94 | strengthens | 0.98 | 0.95 |
| CP07 | C′ | no_effect | D4 | no_effect | 0.15 | 0.14 | no_effect | 0.00 | 0.09 |
| AP08 | A′ | strengthens | D5 | strengthens | 0.96 | 0.97 | strengthens | 0.99 | 0.92 |
| CP08 | C′ | no_effect | D4 | no_effect | 0.02 | 0.02 | no_effect | 0.02 | 0.05 |
| AP09 | A′ | weakens | D5 | weakens | 0.98 | 0.98 | weakens | 1.00 | 0.96 |
| CP09 | C′ | no_effect | D3 | weakens | 0.85 | 0.83 | weakens | 0.73 | 0.51 |
| AP10 | A′ | strengthens | D5 | weakens | 0.97 | 0.96 | strengthens | 0.99 | 0.95 |
| CP10 | C′ | no_effect | D3 | weakens | 0.84 | 0.85 | weakens | 0.84 | 0.60 |
| AP11 | A′ | weakens | D5 | weakens | 0.96 | 0.97 | weakens | 0.97 | 0.75 |
| CP11 | C′ | no_effect | D3 | no_effect | 0.29 | 0.27 | no_effect | 0.13 | 0.32 |
| AP12 | A′ | weakens | D5 | weakens | 0.82 | 0.84 | no_effect | 0.45 | 0.51 |
| CP12 | C′ | no_effect | D0 | weakens | 0.74 | 0.75 | no_effect | 0.42 | 0.16 |
| AP13 | A′ | weakens | D5 | weakens | 0.92 | 0.93 | strengthens | 0.94 | 0.92 |
| CP13 | C′ | no_effect | D0 | no_effect | 0.36 | 0.34 | weakens | 0.56 | 0.36 |
| AP14 | A′ | weakens | D5 | strengthens | 0.94 | 0.93 | strengthens | 0.94 | 0.80 |
| CP14 | C′ | no_effect | D2 | strengthens | 0.87 | 0.85 | strengthens | 0.96 | 0.90 |
| AP15 | A′ | strengthens | D5 | strengthens | 0.97 | 0.98 | strengthens | 0.97 | 0.92 |
| CP15 | C′ | no_effect | D3 | weakens | 0.83 | 0.84 | weakens | 0.90 | 0.33 |
| AP16 | A′ | strengthens | D5 | strengthens | 0.97 | 0.97 | strengthens | 0.99 | 0.92 |
| CP16 | C′ | no_effect | D0 | no_effect | 0.40 | 0.40 | no_effect | 0.26 | 0.23 |
| BP01 | B′ | weakens | D5 | weakens | 0.80 | 0.79 | weakens | 0.86 | 0.82 |
| DP01 | D′ | no_effect | D3 | strengthens | 0.71 | 0.70 | strengthens | 0.91 | 0.65 |
| BP02 | B′ | strengthens | D5 | weakens | 0.81 | 0.75 | weakens | 0.87 | 0.85 |
| DP02 | D′ | no_effect | D4 | no_effect | 0.24 | 0.31 | weakens | 0.55 | 0.68 |
| BP03 | B′ | weakens | D5 | weakens | 0.87 | 0.86 | weakens | 0.95 | 0.74 |
| DP03 | D′ | no_effect | D4 | no_effect | 0.38 | 0.40 | strengthens | 0.74 | 0.43 |
| BP04 | B′ | strengthens | D5 | strengthens | 0.96 | 0.96 | strengthens | 1.00 | 0.92 |
| DP04 | D′ | no_effect | D2 | no_effect | 0.16 | 0.17 | no_effect | 0.13 | 0.19 |
| BP05 | B′ | strengthens | D5 | strengthens | 0.97 | 0.96 | strengthens | 0.99 | 0.89 |
| DP05 | D′ | no_effect | D4 | strengthens | 0.88 | 0.86 | strengthens | 0.98 | 0.85 |
| BP06 | B′ | weakens | D5 | weakens | 0.80 | 0.80 | weakens | 0.88 | 0.77 |
| DP06 | D′ | no_effect | D0 | weakens | 0.63 | 0.69 | weakens | 0.78 | 0.32 |
| BP07 | B′ | weakens | D5 | weakens | 0.90 | 0.89 | weakens | 0.92 | 0.58 |
| DP07 | D′ | no_effect | D0 | weakens | 0.90 | 0.93 | weakens | 0.92 | 0.60 |
| BP08 | B′ | weakens | D5 | weakens | 0.96 | 0.97 | weakens | 0.98 | 0.61 |
| DP08 | D′ | no_effect | D0 | weakens | 0.87 | 0.88 | weakens | 0.94 | 0.53 |
| BP09 | B′ | strengthens | D5 | strengthens | 0.80 | 0.76 | weakens | 0.86 | 0.78 |
| DP09 | D′ | no_effect | D2 | no_effect | 0.25 | 0.22 | no_effect | 0.26 | 0.18 |
| BP10 | B′ | strengthens | D5 | weakens | 0.90 | 0.92 | weakens | 0.97 | 0.89 |
| DP10 | D′ | no_effect | D0 | weakens | 0.87 | 0.87 | weakens | 0.92 | 0.48 |
| BP11 | B′ | weakens | D5 | weakens | 0.91 | 0.92 | weakens | 0.99 | 0.86 |
| DP11 | D′ | no_effect | D3 | weakens | 0.55 | 0.60 | weakens | 0.74 | 0.31 |
| BP12 | B′ | weakens | D5 | weakens | 0.83 | 0.82 | weakens | 0.89 | 0.65 |
| DP12 | D′ | no_effect | D2 | no_effect | 0.17 | 0.26 | no_effect | 0.27 | 0.34 |
| BP13 | B′ | weakens | D5 | weakens | 0.97 | 0.98 | weakens | 0.99 | 0.84 |
| DP13 | D′ | no_effect | D2 | strengthens | 0.83 | 0.85 | strengthens | 0.95 | 0.89 |
| BP14 | B′ | strengthens | D5 | strengthens | 0.59 | 0.57 | undetermined | 0.45 | 0.68 |
| DP14 | D′ | no_effect | D4 | no_effect | 0.06 | 0.05 | no_effect | 0.24 | 0.30 |
| BP15 | B′ | strengthens | D5 | no_effect | 0.56 | 0.48 | undetermined | 0.34 | 0.67 |
| DP15 | D′ | no_effect | D3 | weakens | 0.69 | 0.73 | weakens | 0.88 | 0.45 |
| BP16 | B′ | strengthens | D5 | no_effect | 0.54 | 0.54 | undetermined | 0.43 | 0.64 |
| DP16 | D′ | no_effect | D3 | weakens | 0.67 | 0.67 | weakens | 0.83 | 0.24 |
