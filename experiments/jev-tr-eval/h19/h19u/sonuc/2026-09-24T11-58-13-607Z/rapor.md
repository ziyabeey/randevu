# H19u sonuçları (2026-09-24T11-58-13-607Z)

Protokol: H19U-PROTOKOL v0.1 (d39e388). Analiz kodu V1 çalışmadan önce yazıldı.
Router: P(D5) ≥ 0.64 ön filtresi · P(D1) ≥ 0.64 ise R1 ayrıştırıcı. Baseline: P(D5) ≥ 0.64. Başka eşik, skor veya soru hesaplanmaz.
Düşen vakalar (kör okuyucu uyuşmazlığı): A16, C20. Analizdeki vaka: 78 (A 19, B 20, C 19, D 20).

**Sonuç kuralı (§12):** U1 geçti · U2 geçti · U3 geçti · U4 geçti · U5 geçti → U1–U5 geçti → H19u başarılı. Desteklenen iddia yalnız §12'deki dar cümledir; sonraki adım ayrı bir H19s (yalnız gölge) ön kaydı olabilir.

## U1: ayrıştırıcı D1-only ile D5-involved'ı ayırıyor mu (R1, bütün vakalar)

| Ölçüt | Değer | Eşik | |
|---|---|---|---|
| B+C (D5 involved) recall | 39/39 = %100.0 (Wilson %95: %91.0–%100.0) | ≥ %90 | **geçti** |
| A (D1 only) FPR | 1/19 = %5.3 (Wilson %95: %0.9–%24.6) | ≤ %30 | **geçti** |
| D (neither) FPR | 3/20 = %15.0 (Wilson %95: %5.2–%36.0) | ≤ %25 | **geçti** |
| C (both) recall | 19/19 = %100.0 (Wilson %95: %83.2–%100.0) | ≥ %85 | **geçti** |
| Dört sınıflı tam doğruluk | 59/78 = %75.6 (Wilson %95: %65.1–%83.8) | ≥ %70 | **geçti** |

U1: **geçti**

## U2: bileşik router (V1 + R1)

| Ölçüt | Aday | Eşik | |
|---|---|---|---|
| D5 recall (B+C) | 39/39 = %100.0 (Wilson %95: %91.0–%100.0) | ≥ %90 | **geçti** |
| B recall | 20/20 = %100.0 (Wilson %95: %83.9–%100.0) | ≥ %90 | **geçti** |
| C recall | 19/19 = %100.0 (Wilson %95: %83.2–%100.0) | ≥ %85 | **geçti** |
| Non-D5 FPR (A+D) | 2/39 = %5.1 (Wilson %95: %1.4–%16.9) | ≤ %30 | **geçti** |
| A (D1-only) FPR | 0/19 = %0.0 (Wilson %95: %0.0–%16.8) | ≤ %30 | **geçti** |

| Baseline P(D5) ≥ 0.64 ile karşılaştırma | Baseline | Aday | Fark | Eşik | |
|---|---|---|---|---|---|
| D5 recall | 39/39 = %100.0 (Wilson %95: %91.0–%100.0) | 39/39 = %100.0 (Wilson %95: %91.0–%100.0) | kayıp 0.0 puan | kayıp ≤ 5 puan | **geçti** |
| C recall | 19/19 = %100.0 (Wilson %95: %83.2–%100.0) | 19/19 = %100.0 (Wilson %95: %83.2–%100.0) | kayıp 0.0 puan | kayıp ≤ 10 puan | **geçti** |
| Genel FPR (A+D) | 11/39 = %28.2 (Wilson %95: %16.5–%43.8) | 2/39 = %5.1 (Wilson %95: %1.4–%16.9) | düşüş 23.1 puan | düşüş ≥ 10 puan | **geçti** |
| Toplam System Two route oranı | 50/78 = %64.1 (Wilson %95: %53.0–%73.9) | 41/78 = %52.6 (Wilson %95: %41.6–%63.3) | düşüş 11.5 puan | düşüş ≥ 10 puan | **geçti** |

U2: **geçti**

## U3: ayrıştırıcı çağrı bütçesi

| Ölçüt | Değer | Eşik | |
|---|---|---|---|
| Ayrıştırıcı çağrılan vaka oranı (belirsiz mahalle) | 46/78 = %59.0 (Wilson %95: %47.9–%69.2) | ≤ %60 | **geçti** |
| System Two route sayısı: aday / baseline | 41 / 50 | aday < baseline | **geçti** |
| Aday: System Two route + ayrıştırıcı çağrısı (rapor) | 41 + 46 | | |
| Ayrıştırıcı input token ort. (belirsiz mahalle, R1) | 674.67 | | |
| Ayrıştırıcı gecikme medyanı ms (belirsiz mahalle, R1) | 262 | | |

Ayrıştırıcı çağrısı System Two ile aynı maliyet sayılmaz; bu satırlar parasal maliyet iddiası değildir.

U3: **geçti**

## U4: bağlam dayanıklılığı

| Grup | Değer | Eşik | |
|---|---|---|---|
| Aday: ipucu olan D5 recall | 36/36 = %100.0 (Wilson %95: %90.4–%100.0) | ≥ %85 | **geçti** |
| Aday: ipucusuz D5 recall | 3/3 = %100.0 (Wilson %95: %43.8–%100.0) | ≥ %85 | **geçti** |
| Aday: lock_context=true D5 recall | 34/34 = %100.0 (Wilson %95: %89.8–%100.0) | ≥ %85 | **geçti** |
| Aday: lock_context=false D5 recall | 5/5 = %100.0 (Wilson %95: %56.6–%100.0) | ≥ %85 | **geçti** |
| Aday: A, ipucu olan FPR | 0/15 = %0.0 (Wilson %95: %0.0–%20.4) | ≤ %40 | **geçti** |
| Aday: A, ipucusuz FPR | 0/4 = %0.0 (Wilson %95: %0.0–%49.0) | ≤ %40 | **geçti** |
| Ayrıştırıcı (R1) tam doğruluk, ipucu olan | 52/68 = %76.5 (Wilson %95: %65.1–%85.0) | ≥ %65 | **geçti** |
| Ayrıştırıcı (R1) tam doğruluk, ipucusuz | 7/10 = %70.0 (Wilson %95: %39.7–%89.2) | ≥ %65 | **geçti** |

U4: **geçti**

## U5: ayrıştırıcı kararlılığı (R1 ile R2)

| Ölçüt | Değer | Eşik | |
|---|---|---|---|
| Choice argmax uyumu | 75/78 = %96.2 (Wilson %95: %89.3–%98.7) | ≥ %90 | **geçti** |
| resolver_routes_D5 uyumu | 76/78 = %97.4 (Wilson %95: %91.1–%99.3) | ≥ %95 | **geçti** |
| B+C recall R1 → R2 | %100.0 → %100.0 | kötüleşme ≤ 10 puan | **geçti** |
| C recall R1 → R2 | %100.0 → %100.0 | kötüleşme ≤ 10 puan | **geçti** |
| A FPR R1 → R2 | %5.3 → %5.3 | kötüleşme ≤ 10 puan | **geçti** |
| D FPR R1 → R2 | %15.0 → %25.0 | kötüleşme ≤ 10 puan | **geçti** |
| (rapor) R2 tam doğruluk | 59/78 = %75.6 (Wilson %95: %65.1–%83.8) | | |

U5: **geçti**

## İkincil raporlar (§11; eşik, skor veya yeni soru üretmez)

### V1 P(D1) ve P(D5) dağılımı

| Katman | n | P(D1) ort. | P(D1) medyan | P(D5) ort. | P(D5) medyan | high_D5 | belirsiz mahalle |
|---|---|---|---|---|---|---|---|
| A (D1 only) | 19 | 0.656 | 0.650 | 0.532 | 0.580 | 9/19 | 9/19 |
| B (D5 only) | 20 | 0.742 | 0.785 | 0.945 | 0.950 | 20/20 | 18/20 |
| C (both) | 19 | 0.828 | 0.840 | 0.941 | 0.940 | 19/19 | 19/19 |
| D (neither) | 20 | 0.272 | 0.260 | 0.308 | 0.290 | 2/20 | 0/20 |

### Belirsiz mahallede gerçek sınıf ve aday kararı

| Gerçek sınıf | belirsiz mahallede | R1 route | route etmeyen |
|---|---|---|---|
| D1_ONLY | 9 | 0 | 9 |
| D5_ONLY | 18 | 18 | 0 |
| BOTH | 19 | 19 | 0 |
| NEITHER_OR_OTHER | 0 | 0 | 0 |

### Ayrıştırıcı karışıklık matrisi (R1, bütün vakalar)

| Gerçek \ R | D1_ONLY | D5_ONLY | BOTH | NEITHER_OR_OTHER |
|---|---|---|---|---|
| D1_ONLY | 17 | 1 | 0 | 1 |
| D5_ONLY | 0 | 20 | 0 | 0 |
| BOTH | 0 | 6 | 13 | 0 |
| NEITHER_OR_OTHER | 8 | 3 | 0 | 9 |

### Ayrıştırıcı karışıklık matrisi (R2, bütün vakalar)

| Gerçek \ R | D1_ONLY | D5_ONLY | BOTH | NEITHER_OR_OTHER |
|---|---|---|---|---|
| D1_ONLY | 17 | 1 | 0 | 1 |
| D5_ONLY | 0 | 20 | 0 | 0 |
| BOTH | 0 | 6 | 13 | 0 |
| NEITHER_OR_OTHER | 6 | 5 | 0 | 9 |

### Mekanizma ailesine göre (bileşik aday ve R1)

| Katman | Aile | n | aday route | R1 tam doğru | baseline route |
|---|---|---|---|---|---|
| A | claim_atomicity | 1 | 0 | 0 | 0 |
| A | command_identity | 4 | 0 | 4 | 0 |
| A | hash_conflict_relaxed | 1 | 0 | 1 | 1 |
| A | provider_idempotency_key | 1 | 0 | 1 | 0 |
| A | receipt_not_finished | 3 | 0 | 3 | 3 |
| A | relink_replay | 1 | 0 | 1 | 0 |
| A | replay_skipped | 1 | 0 | 1 | 1 |
| A | request_hash_field | 4 | 0 | 3 | 1 |
| A | result_binding | 1 | 0 | 1 | 1 |
| A | retry_conflict | 1 | 0 | 1 | 1 |
| A | stale_receipt_result | 1 | 0 | 1 | 1 |
| B | lock_added | 5 | 5 | 5 | 5 |
| B | lock_downgrade | 2 | 2 | 2 | 2 |
| B | lock_mode_order | 2 | 2 | 2 | 2 |
| B | lock_order_removed | 1 | 1 | 1 | 1 |
| B | lock_removal | 5 | 5 | 5 | 5 |
| B | share_fence | 3 | 3 | 3 | 3 |
| B | stale_check_relaxed | 1 | 1 | 1 | 1 |
| B | version_check_removed | 1 | 1 | 1 | 1 |
| C | command_key_lock | 2 | 2 | 0 | 2 |
| C | compound | 14 | 14 | 13 | 14 |
| C | probe_lock_removed | 1 | 1 | 0 | 1 |
| C | replay_probe_unlocked | 2 | 2 | 0 | 2 |
| D | authority_scope | 5 | 0 | 2 | 0 |
| D | availability | 2 | 2 | 0 | 2 |
| D | history | 3 | 0 | 1 | 0 |
| D | local_day | 2 | 0 | 1 | 0 |
| D | resource_limit | 3 | 0 | 2 | 0 |
| D | snapshot | 2 | 0 | 1 | 0 |
| D | time_window | 3 | 0 | 2 | 0 |

### Önceden işaretli aileler

| Grup | n | aday route | baseline route | R1 tam doğru |
|---|---|---|---|---|
| A: receipt/request-hash/replay | 16 | 0 | 9 | 15 |
| A: diğer D1 aileleri | 3 | 0 | 0 | 2 |
| request_hash alanı (A) | 4 | 0 | 1 | 3 |
| makbuz kapatılmıyor / tekrar atlanıyor (A) | 5 | 0 | 5 | 5 |
| stale token / sürüm (B+C) | 9 | 9 | 9 | 8 |
| removed-predicate (B+C) | 7 | 7 | 7 | 7 |
| removed-predicate (A+D) | 5 | 2 | 3 | 2 |

### Precision (yalnız bu dengeli setin %50 D5 prevalansında; üretim prevalansı olarak yorumlanmaz)

- Aday: 39/41 = %95.1
- Baseline: 39/50 = %78.0

### Token ve gecikme

| Tur | input token ort. | medyan | gecikme ort. (ms) | medyan (ms) |
|---|---|---|---|---|
| V1 | 866.70 | 848 | 465.57 | 590.5 |
| R1 | 665.70 | 647 | 398.74 | 280.5 |
| R2 | 665.70 | 647 | 417.01 | 270.5 |

## Vaka bazında

| Vaka | katman | etiket | P(D1) | P(D5) | belirsiz | R1 | R2 | baseline | aday |
|---|---|---|---|---|---|---|---|---|---|
| A01 | A | D1_ONLY | 0.32 | 0.13 | · | D1_ONLY | D1_ONLY | · | · |
| A02 | A | D1_ONLY | 0.80 | 0.66 | evet | D1_ONLY | D1_ONLY | R | · |
| A03 | A | D1_ONLY | 0.82 | 0.70 | evet | D1_ONLY | D1_ONLY | R | · |
| A04 | A | D1_ONLY | 0.91 | 0.82 | evet | D1_ONLY | D1_ONLY | R | · |
| A05 | A | D1_ONLY | 0.38 | 0.17 | · | D1_ONLY | D1_ONLY | · | · |
| A06 | A | D1_ONLY | 0.88 | 0.64 | evet | D1_ONLY | D1_ONLY | R | · |
| A07 | A | D1_ONLY | 0.61 | 0.26 | · | D1_ONLY | D1_ONLY | · | · |
| A08 | A | D1_ONLY | 0.61 | 0.36 | · | D1_ONLY | D1_ONLY | · | · |
| A09 | A | D1_ONLY | 0.90 | 0.78 | evet | D1_ONLY | D1_ONLY | R | · |
| A10 | A | D1_ONLY | 0.90 | 0.75 | evet | D1_ONLY | D1_ONLY | R | · |
| A11 | A | D1_ONLY | 0.61 | 0.50 | · | D1_ONLY | D1_ONLY | · | · |
| A12 | A | D1_ONLY | 0.65 | 0.80 | evet | D1_ONLY | D1_ONLY | R | · |
| A13 | A | D1_ONLY | 0.63 | 0.58 | · | D1_ONLY | D1_ONLY | · | · |
| A14 | A | D1_ONLY | 0.25 | 0.09 | · | NEITHER_OR_OTHER | NEITHER_OR_OTHER | · | · |
| A15 | A | D1_ONLY | 0.84 | 0.85 | evet | D1_ONLY | D1_ONLY | R | · |
| A17 | A | D1_ONLY | 0.18 | 0.07 | · | D1_ONLY | D1_ONLY | · | · |
| A18 | A | D1_ONLY | 0.68 | 0.58 | · | D1_ONLY | D1_ONLY | · | · |
| A19 | A | D1_ONLY | 0.60 | 0.58 | · | D5_ONLY | D5_ONLY | · | · |
| A20 | A | D1_ONLY | 0.89 | 0.78 | evet | D1_ONLY | D1_ONLY | R | · |
| B01 | B | D5_ONLY | 0.82 | 0.94 | evet | D5_ONLY | D5_ONLY | R | R |
| B02 | B | D5_ONLY | 0.71 | 0.95 | evet | D5_ONLY | D5_ONLY | R | R |
| B03 | B | D5_ONLY | 0.80 | 0.97 | evet | D5_ONLY | D5_ONLY | R | R |
| B04 | B | D5_ONLY | 0.72 | 0.96 | evet | D5_ONLY | D5_ONLY | R | R |
| B05 | B | D5_ONLY | 0.79 | 0.94 | evet | D5_ONLY | D5_ONLY | R | R |
| B06 | B | D5_ONLY | 0.84 | 0.96 | evet | D5_ONLY | D5_ONLY | R | R |
| B07 | B | D5_ONLY | 0.80 | 0.94 | evet | D5_ONLY | D5_ONLY | R | R |
| B08 | B | D5_ONLY | 0.79 | 0.92 | evet | D5_ONLY | D5_ONLY | R | R |
| B09 | B | D5_ONLY | 0.77 | 0.90 | evet | D5_ONLY | D5_ONLY | R | R |
| B10 | B | D5_ONLY | 0.80 | 0.90 | evet | D5_ONLY | D5_ONLY | R | R |
| B11 | B | D5_ONLY | 0.81 | 0.97 | evet | D5_ONLY | D5_ONLY | R | R |
| B12 | B | D5_ONLY | 0.80 | 0.97 | evet | D5_ONLY | D5_ONLY | R | R |
| B13 | B | D5_ONLY | 0.70 | 0.95 | evet | D5_ONLY | D5_ONLY | R | R |
| B14 | B | D5_ONLY | 0.57 | 0.94 | · | D5_ONLY | D5_ONLY | R | R |
| B15 | B | D5_ONLY | 0.83 | 0.96 | evet | D5_ONLY | D5_ONLY | R | R |
| B16 | B | D5_ONLY | 0.65 | 0.96 | evet | D5_ONLY | D5_ONLY | R | R |
| B17 | B | D5_ONLY | 0.66 | 0.95 | evet | D5_ONLY | D5_ONLY | R | R |
| B18 | B | D5_ONLY | 0.50 | 0.88 | · | D5_ONLY | D5_ONLY | R | R |
| B19 | B | D5_ONLY | 0.78 | 0.96 | evet | D5_ONLY | D5_ONLY | R | R |
| B20 | B | D5_ONLY | 0.71 | 0.97 | evet | D5_ONLY | D5_ONLY | R | R |
| C01 | C | BOTH | 0.82 | 0.94 | evet | BOTH | BOTH | R | R |
| C02 | C | BOTH | 0.83 | 0.93 | evet | D5_ONLY | D5_ONLY | R | R |
| C03 | C | BOTH | 0.85 | 0.94 | evet | BOTH | BOTH | R | R |
| C04 | C | BOTH | 0.86 | 0.94 | evet | D5_ONLY | D5_ONLY | R | R |
| C05 | C | BOTH | 0.84 | 0.96 | evet | D5_ONLY | D5_ONLY | R | R |
| C06 | C | BOTH | 0.85 | 0.93 | evet | BOTH | BOTH | R | R |
| C07 | C | BOTH | 0.82 | 0.93 | evet | BOTH | BOTH | R | R |
| C08 | C | BOTH | 0.71 | 0.93 | evet | BOTH | BOTH | R | R |
| C09 | C | BOTH | 0.81 | 0.93 | evet | BOTH | BOTH | R | R |
| C10 | C | BOTH | 0.85 | 0.95 | evet | BOTH | BOTH | R | R |
| C11 | C | BOTH | 0.87 | 0.94 | evet | BOTH | BOTH | R | R |
| C12 | C | BOTH | 0.77 | 0.94 | evet | BOTH | BOTH | R | R |
| C13 | C | BOTH | 0.85 | 0.92 | evet | D5_ONLY | D5_ONLY | R | R |
| C14 | C | BOTH | 0.85 | 0.94 | evet | D5_ONLY | D5_ONLY | R | R |
| C15 | C | BOTH | 0.84 | 0.95 | evet | BOTH | BOTH | R | R |
| C16 | C | BOTH | 0.87 | 0.95 | evet | BOTH | BOTH | R | R |
| C17 | C | BOTH | 0.81 | 0.94 | evet | BOTH | BOTH | R | R |
| C18 | C | BOTH | 0.81 | 0.96 | evet | BOTH | BOTH | R | R |
| C19 | C | BOTH | 0.82 | 0.95 | evet | D5_ONLY | D5_ONLY | R | R |
| D01 | D | NEITHER_OR_OTHER | 0.19 | 0.07 | · | NEITHER_OR_OTHER | NEITHER_OR_OTHER | · | · |
| D02 | D | NEITHER_OR_OTHER | 0.45 | 0.41 | · | D1_ONLY | D1_ONLY | · | · |
| D03 | D | NEITHER_OR_OTHER | 0.42 | 0.22 | · | D1_ONLY | D1_ONLY | · | · |
| D04 | D | NEITHER_OR_OTHER | 0.10 | 0.09 | · | NEITHER_OR_OTHER | NEITHER_OR_OTHER | · | · |
| D05 | D | NEITHER_OR_OTHER | 0.50 | 0.60 | · | D1_ONLY | D1_ONLY | · | · |
| D06 | D | NEITHER_OR_OTHER | 0.14 | 0.07 | · | D1_ONLY | D1_ONLY | · | · |
| D07 | D | NEITHER_OR_OTHER | 0.29 | 0.45 | · | D1_ONLY | D5_ONLY | · | · |
| D08 | D | NEITHER_OR_OTHER | 0.23 | 0.08 | · | NEITHER_OR_OTHER | NEITHER_OR_OTHER | · | · |
| D09 | D | NEITHER_OR_OTHER | 0.32 | 0.10 | · | NEITHER_OR_OTHER | NEITHER_OR_OTHER | · | · |
| D10 | D | NEITHER_OR_OTHER | 0.49 | 0.30 | · | D1_ONLY | D1_ONLY | · | · |
| D11 | D | NEITHER_OR_OTHER | 0.25 | 0.79 | · | D5_ONLY | D5_ONLY | R | R |
| D12 | D | NEITHER_OR_OTHER | 0.27 | 0.71 | · | D5_ONLY | D5_ONLY | R | R |
| D13 | D | NEITHER_OR_OTHER | 0.14 | 0.07 | · | NEITHER_OR_OTHER | NEITHER_OR_OTHER | · | · |
| D14 | D | NEITHER_OR_OTHER | 0.18 | 0.06 | · | NEITHER_OR_OTHER | NEITHER_OR_OTHER | · | · |
| D15 | D | NEITHER_OR_OTHER | 0.27 | 0.59 | · | D5_ONLY | D5_ONLY | · | · |
| D16 | D | NEITHER_OR_OTHER | 0.32 | 0.45 | · | D1_ONLY | D1_ONLY | · | · |
| D17 | D | NEITHER_OR_OTHER | 0.15 | 0.28 | · | NEITHER_OR_OTHER | NEITHER_OR_OTHER | · | · |
| D18 | D | NEITHER_OR_OTHER | 0.23 | 0.39 | · | NEITHER_OR_OTHER | NEITHER_OR_OTHER | · | · |
| D19 | D | NEITHER_OR_OTHER | 0.16 | 0.36 | · | NEITHER_OR_OTHER | D5_ONLY | · | · |
| D20 | D | NEITHER_OR_OTHER | 0.33 | 0.07 | · | D1_ONLY | NEITHER_OR_OTHER | · | · |
