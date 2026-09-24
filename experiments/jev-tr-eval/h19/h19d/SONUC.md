# H19d sonucu (24 Eylül 2026)

| Bilgi | Değer |
|---|---|
| Protokol | H19D-PROTOKOL v0.1 (6992921) |
| Vakalar | `vakalar.v0.1.json`, SHA-256 `90139d3f…` (467c8a6) |
| Kör kontrol | 16/16 uyum (dda21c0); düşen vaka yok |
| Ölçüm kapısı | daf6f1c |
| Model ve çağrı | `jev-1.13.0`, 160 çağrı (V1 + V2) |
| Ham çıktılar | [`sonuc/2026-09-24T09-26-08-682Z/`](sonuc/2026-09-24T09-26-08-682Z/) |
| Ölçümden önce yazılmış analizin tam çıktısı | [`rapor.md`](sonuc/2026-09-24T09-26-08-682Z/rapor.md) |

## Önceden yazılmış kurala göre sonuç

**S0: D1 kaldı · D2 kaldı · D3 kaldı · D4 geçti.** Üretim veya gölge promosyonu yok; H19e açılmaz.
"Ranker olarak destekli" dalı da oluşmadı, çünkü o dal D1'in geçmesini ister. S1 de kapıları geçmedi.

| | Ham P(D5) | S0 (birincil) | S1 (ikincil) |
|---|---|---|---|
| AUC (80 vaka) | **0.934** | 0.890 | 0.901 |
| Fark (skor − ham) | | −0.043 (bootstrap %95: −0.126 … +0.025) | −0.033 (−0.107 … +0.032) |
| Router genel TPR | %100 (P(D5) ≥ 0.50) | %77.5 | %87.5 |
| P-single TPR | %100 | %95.0 | %100 |
| **P-pair TPR** | %100 | **%60.0** | %75.0 |
| Genel FPR | %52.5 | %17.5 | %37.5 |
| N-pair FPR | %50.0 | %5.0 | %25.0 |
| V1–V2 ort. \|Δ\| / karar uyumu | | 0.017 / %96.3 | 0.023 / %97.5 |

## Ne öğrendik

**1. Göreli eksen matematiği ileriye dönük olarak tutmadı.**
- H19b′ ve R0 üzerindeki post-hoc kazanç (+0.04 / +0.10) yeni ve dengeli sette **tersine döndü** (−0.043).
- Keşif tablosunun (`H19D-KESIF.md`) neden kanıt sayılmadığını bu sonuç tam olarak gösteriyor: aynı veride
  beş varyant denenmişti.

**2. Mekanizma, ön kayıttan önce işaretlenen risk: çift eksenli gerçek D5.**
- D5 başka bir eksenle birlikte değişince Jev o ekseni D5 kadar ya da daha yüksek görüyor. S0 gerçek pozitifi
  cezalandırıyor.

| PP katmanı | S0 ile route | Neden |
|---|---|---|
| D5×D4 | **0/4** | D4 ≈ 0.96, D5 ≈ 0.83 |
| D5×D1 | 1/4 | D1 ≥ D5 (transaction komşuluğu) |
| D5×D3 | 3/4 | |
| D5×D0 | 4/4 | |
| D5×D2 | 4/4 | |

- Bu tam olarak R0'daki C16 örneği (D4 .92, D5 .42). H19d onu sistematik olarak test etti ve protokolün
  P-pair kapısı (≥ %85) S0'ın bu zayıflığını yakaladı.

**3. S0'ın gerçek katkısı yanlış alarmı kesmek; ama yakalamayı fazla düşürüyor.**
- τ = 0'da ham P(D5) ≥ 0.50 negatiflerin 21/40'ını route ediyor, S0 yalnız 7/40'ını.
- Farkın çoğu D1 ve D4 negatiflerinde:

  | Negatif grubu | Ham | S0 |
  |---|---|---|
  | D1 içeren | 9/12 | 0/12 |
  | D4 içeren | 7/12 | 0/12 |

- Aynı mekanizma pozitiflerde yakalamayı %77.5'e indiriyor. Önceden yazılmış eşikle sonuç: sıralayıcı olarak
  hamdan kötü, router olarak yetersiz.

**4. S1 (D1 hariç) D1/D5 karışıklığını iki yönden gösteriyor.**
- D5×D1 pozitiflerini kurtarıyor: 4/4.
- Ama D1 negatiflerini içeri alıyor: FPR 8/12.
- Jev'in algısında D1 ve D5 ayrışmıyor. Bu, H19a'daki "transaction komşuluğu" bulgusunun ileriye dönük
  tekrarı.

**5. Ham P(D5), üç ileriye dönük sette tutarlı biçimde en güçlü sinyal.** Sorunu sıralama değil, çalışma
noktası.

| Set | Ham P(D5) AUC |
|---|---|
| H19b | 1.00 |
| H19b′ birincil çapraz | 0.92 |
| H19d (dengeli, çift eksenli) | 0.934 |

- 0.50 eşiğinde her gerçek D5'i yakaladı (40/40), ama D5 olmayan diff'lerin yarısını da işaretledi.
- Protokol bu sette eşik taramasını yasaklıyor. Burada daha iyi görünen bir eşik "seçilmez".

**6. Kararlılık sorun değil.** İki tur arasında skor farkı 0.017; route kararları %96 aynı.

## Bundan çıkan sınır

- H19d, "eksen geometrisini kodda yorumlama" fikrini bu biçimiyle (en güçlü rakip ekseni çıkarma) desteklemedi.
- Desteklenen tek şey, önceki sonuçla aynı: **Jev'in altı eksenli V vektöründeki ham P(D5) iyi bir sıralayıcı;
  eşik ise ayrı ve ileriye dönük olarak belirlenmeli.**

## English handoff

H19d (pre-registered, 80 new balanced cases including 20 two-axis D5 positives, blind check 16/16, pinned
`jev-1.13.0`, V1 + V2 = 160 calls):
- **The relative-axis router failed D1, D2 and D3.** S0 = P(D5) − max(D0..D4) scored AUC 0.890 against 0.934
  for raw P(D5): Δ −0.043, 95% CI −0.126 … +0.025.
- **As a router, S0 > 0 fell short.** Recall was 77.5% overall and 60% on two-axis positives (0/4 for D5×D4,
  1/4 for D5×D1), with FPR 17.5%.
- **The post-hoc gain seen on earlier sets did not replicate.** The mechanism is the pre-flagged risk: when D5
  co-occurs with another axis, Jev scores that axis as high or higher.
- **S1 (D1 excluded) failed as well.** It recovers D1×D5 positives but admits D1-only negatives, which confirms
  the D1/D5 conflation.
- **Stability passed** (mean |Δ| 0.017, 96% route agreement).
- **Raw P(D5) remains the strongest signal across three prospective sets** (AUC 1.00 / 0.92 / 0.93). At 0.50 it
  has 100% recall and 52.5% FPR; any operating point must be pre-registered and tested on new data.
- **H19e stays closed.**
