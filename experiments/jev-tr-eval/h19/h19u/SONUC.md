# H19u sonucu (24 Eylül 2026)

| Bilgi | Değer |
|---|---|
| Protokol | H19U-PROTOKOL v0.1 (d39e388) |
| Vakalar | `vakalar.v0.1.json`, SHA-256 `ba531c86…` (2273d5c); ölçümde değişmedi |
| Kör kontrol | H19 sahibi, 16 vaka (1afdf35). **14/16 uyum**; düşen: A16 (bfc19f9), C20 (be11fff). Ayrıntı aşağıda |
| Ölçüm kapısı | 00a8470 |
| Model ve çağrı | `jev-1.13.0`, 240 çağrı (V1 + R1 + R2, her biri 80 vaka) |
| Analiz | 78 vaka: A 19, B 20, C 19, D 20 |
| Ham çıktılar | [`sonuc/2026-09-24T11-58-13-607Z/`](sonuc/2026-09-24T11-58-13-607Z/) |
| Ölçümden önce yazılmış analizin tam çıktısı | [`rapor.md`](sonuc/2026-09-24T11-58-13-607Z/rapor.md) |

## Önceden yazılmış kurala göre sonuç

**U1 geçti · U2 geçti · U3 geçti · U4 geçti · U5 geçti → H19u başarılı (§12).**

Desteklenen iddia yalnız §12'deki dar cümledir:

> Sabit `P(D5)>=.64` ön filtresindeki D1/D5 belirsizliği, V skorları modele premise olarak verilmeden,
> aynı diff üzerinde ikinci küçük Choice ile prospective olarak ayrıştırıldı; bileşik router D5 recall'ını
> korurken D1 kaynaklı yanlış alarmları ve System Two çağrı yükünü azalttı.

§12'ye göre sonraki adım H19s olabilir. H19s kendiliğinden açılmaz; ayrı bir ön kayıt ister.

## Baseline ile bileşik router

| | Baseline `P(D5) ≥ .64` | Bileşik router (V1 + R1) | Kural |
|---|---|---|---|
| D5 recall (B+C) | 39/39 | 39/39 | kayıp ≤ 5 puan ✓ |
| C recall | 19/19 | 19/19 | kayıp ≤ 10 puan ✓ |
| A (yalnız D1) FPR | 9/19 = %47.4 | **0/19** | ≤ %30 ✓ |
| A+D FPR | 11/39 = %28.2 | **2/39 = %5.1** | düşüş ≥ 10 puan ✓ (23.1) |
| System Two route oranı | 50/78 = %64.1 | 41/78 = %52.6 | düşüş ≥ 10 puan ✓ (11.5) |
| Precision (yalnız bu dengeli sette) | %78.0 | %95.1 | rapor |

H19t'de kalan madde tam buydu: D1 içeren negatiflerde FPR %66.7 idi ve System Two yükü yalnız 8.8 puan
düşmüştü. Bu sette yük 11.5 puan düştü ve D1 yanlış alarmları sıfırlandı.

## Kazanç nereden geliyor

| Katman | V1'de belirsiz mahalle (iki eksen de ≥ .64) | Ayrıştırıcının route ettiği |
|---|---|---|
| A: D1_ONLY | 9/19 | 0/9 |
| B: D5_ONLY | 18/20 | 18/18 |
| C: BOTH | 19/19 | 19/19 |
| D: NEITHER | 0/20 | — |

- **Kazancın tamamı A katmanından geliyor.** Makbuz/tekrar değişiklikleri V1'de yine yüksek P(D5) aldı
  (belirsiz mahalledeki 9 A vakası). Ayrıştırıcı dokuzunu da `D1_ONLY` okudu.
- **V1'in P(D1) ekseni kendi başına ayırmıyor.** B'de ortalama P(D1) 0.742; B'nin 18/20'si belirsiz
  mahallede. Yani ayrımı ikinci aşama yapıyor.
  - Belirsiz mahallede B ve C için R1'in `D5_ONLY + BOTH` olasılığı 0.94–1.00 arasında.
- **Kalan iki yanlış alarm (D11, D12) ayrıştırıcıdan gelmiyor.** İkisi de `ab.active` kaldırması, yani
  uygunluk (D3) değişikliği. P(D1) düşük olduğu için doğrudan 1. aşamada route edildiler.
- **Belirsiz mahallede gerçek sınıfı D1_ONLY olmayan hiçbir vaka route dışı kalmadı.**

## Sınırda veya ince kalan maddeler

- **U3 belirsiz mahalle oranı 46/78 = %59.0, sınır %60.** Bir vaka daha belirsiz mahalleye düşseydi
  (47/78 = %60.3) U3 kalırdı.
- **U5'te D FPR R1 → R2 %15 → %25.** Kötüleşme tam 10 puan, yani tam sınırda. Nedeni D07 ve D19'un R2'de
  `D5_ONLY` okunması. İkisi de 1. aşamada route edilmeyen vakalar.
- **U2 yük düşüşü 11.5 puan, sınır 10.**
- **U4'te küçük gruplar:**
  - ipucusuz D5: n = 3;
  - `lock_context=false` D5: n = 5;
  - ipucusuz ayrıştırıcı doğruluğu 7/10.

  Hepsi geçti ama güven aralıkları geniş.
- **A'daki kazanımların üçü argmax ile ince farkla geldi.** A02, A12 ve A15'te R1'in argmax'ı `D1_ONLY`,
  ama `D5_ONLY + BOTH` toplam olasılığı 0.41–0.52. R2'de de sonuç aynı. Donmuş kural argmax olduğu için bu
  vakalar doğru sayılır. Bu bir eşik önerisi değil, kırılganlık notudur.

## Kör kontrol ve düşürme duyarlılığı

- Kör kontrol ilk mesajda 15/16 olarak bildirilmişti. İlk çağrıdan önce kör etiket commit'i (1afdf35)
  anahtarla karşılaştırılınca ikinci bir uyuşmazlık çıktı:

  | Vaka | Kör okuma | Anahtar |
  |---|---|---|
  | A16 | `BOTH` | `D1_ONLY` |
  | C20 | `D5_ONLY` | `BOTH` |

- Protokol §4 gereği C20 de düşürüldü. Yeniden etiketlenmedi ve yerine vaka konmadı. Düşürme be11fff'te,
  ölçümden önce kaydedildi.
- Sonuç bu karara duyarlı değil. Aynı ham çıktılarla analiz iki kez daha çalıştırıldı:

  | Düşen | Vaka | Sonuç | U3 belirsiz oranı | Yük düşüşü | A+D FPR |
  |---|---|---|---|---|---|
  | A16, C20 (resmî) | 78 | U1–U5 geçti | %59.0 | 11.5 puan | %5.1 |
  | yalnız A16 | 79 | U1–U5 geçti | %59.5 | 11.4 puan | %5.1 |
  | hiçbiri | 80 | U1–U5 geçti | %60.0 (tam sınır) | 12.5 puan | %5.0 |

- Resmî sonuç 78 vakalık olandır.
- Ayrıştırıcı iki tartışmalı vakada kör okuyucuyla değil anahtarla uyuştu:
  - A16'yı `D1_ONLY` okudu;
  - C20'yi kör okuyucu gibi `D5_ONLY` okudu.

## Ayrıştırıcının yapmadığı

Ayrıştırıcı dört sınıflı bir sınıflandırıcı olarak değil, "D5 işin içinde mi" ikili kararı olarak işe yaradı.
Dört sınıflı tam doğruluk 59/78 = %75.6 (sınır %70; Wilson alt ucu %65.1).

| Gerçek \ R1 | D1_ONLY | D5_ONLY | BOTH | NEITHER |
|---|---|---|---|---|
| D1_ONLY | 17 | 1 | 0 | 1 |
| D5_ONLY | 0 | 20 | 0 | 0 |
| BOTH | 0 | 6 | 13 | 0 |
| NEITHER | 8 | 3 | 0 | 9 |

- **BOTH → D5_ONLY (6).** Bunların beşi, kurulumda önceden işaretlenen tek mekanizmalı C vakaları:
  C02, C04, C05, C13, C14. Bunlarda D1 etkisi yalnız yarış altında görünüyor. Altıncısı C19: istek özetinden
  e-posta çıkarma ile kilit indirmesinin bileşimi.
  - İkili karar için zararsız, çünkü `D5_ONLY` de route ediyor.
  - Ama ayrıştırıcı "kilit kaldırılınca tekrar semantiği de bozulur" ilişkisini görmüyor.
  - Kör okuyucunun C20'de verdiği cevapla aynı.
- **NEITHER → D1_ONLY (8).** Aktör değişiklikleri, olay/anlık görüntü ve zaman penceresi vakaları.
  Hepsi 1. aşamada P(D5) < .64 kaldığı için ayrıştırıcıya hiç gelmedi.
- **D'de yalnız 1. aşamada durdurulan vakalar var.** Belirsiz mahalleye düşen D vakası olmadığı için
  ayrıştırıcının D0/D2/D3/D4 vakalarını belirsiz mahallede ayırma gücü bu sette ölçülmedi.

## Bu sonucun sınırı

- **Prevalans.** Set dengeli: katman başına 20 vaka. Gerçek PR akışında yalnız D1 olan ve yüksek P(D5) alan
  değişikliklerin oranı bilinmiyor. Bu sette 9 System Two çağrısından kurtulmak için 46 ayrıştırıcı çağrısı
  gerekti.
  - Ayrıştırıcının girdisi belirsiz mahallede ortalama 675 token, gecikme medyanı 262 ms (R1).
  - Parasal karşılaştırma yapılmadı. Bu sorunun cevabı H19s'in işi.
- **Tek model sürümü** (`jev-1.13.0`) ve **tek kurucu.** Vakaları H19t sonucunu bilerek aynı kişi kurdu.
  - A katmanı bilerek kilit bağlamıyla dolduruldu: `lock_context` %80.
  - Naif özellik kapısı geçti, ama kurulum yanlılığı tamamen dışlanamaz.
- **Fonksiyon düzeyi etiket.** Çağıranın kilitleri sayılmadı. Gerçek PR'da bağlam farklı olabilir.

## English handoff

H19u (pre-registered, 80 new cases in four layers of 20: D1_ONLY / D5_ONLY / BOTH / NEITHER; owner blind
check 14/16; A16 and C20 dropped before measurement; analysis on 78; pinned `jev-1.13.0`; V1 + R1 + R2 =
240 calls):

- **Result: U1–U5 all passed.** H19u succeeds under §12. Only the narrow §12 claim is supported. H19s may be
  pre-registered next; it does not open automatically.
- **The composite router fixed the H19t T2 failure.**
  - D5 recall stayed at 39/39 (C 19/19).
  - D1-only FPR fell from 9/19 to 0/19.
  - A+D FPR fell from 28.2% to 5.1%.
  - System Two route rate fell from 64.1% to 52.6% (−11.5 pts).
- **All of the gain comes from the second stage.**
  - V1's P(D1) does not separate the layers: 18/20 D5_ONLY cases were also high on D1.
  - The resolver sent all 9 ambiguous D1-only cases to no-route.
  - It routed all 37 ambiguous B/C cases, with P(D5_ONLY+BOTH) of 0.94–1.00.
- **Items near their limits:**
  - ambiguous rate 59.0% (limit 60%);
  - R2 D FPR worsened by exactly 10 pts;
  - load drop 11.5 pts (limit 10);
  - small U4 subgroups (n = 3, 5, 10);
  - 3 of the 9 D1-only saves won the argmax narrowly (P(D5_ONLY+BOTH) 0.41–0.52).
- **The outcome is not sensitive to the second drop.** Re-running the same analysis with only A16 dropped, or
  with nothing dropped, also passes U1–U5. The official result is the 78-case one.
- **It works as a binary "is D5 involved" gate, not a 4-class classifier.**
  - Exact 4-class accuracy is 75.6%.
  - 6/19 BOTH cases were read as D5_ONLY. Five of them are the pre-flagged single-mechanism C cases.
  - 8/20 NEITHER cases were read as D1_ONLY. None of them reached the resolver in the router.
- **Limits.**
  - Balanced set: production prevalence and cost are unmeasured. Here 46 resolver calls saved 9 System Two
    routes.
  - Single model version; single case builder.
  - Function-level labels.
