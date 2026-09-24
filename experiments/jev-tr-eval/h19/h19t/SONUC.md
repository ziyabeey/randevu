# H19t sonucu (24 Eylül 2026)

| Bilgi | Değer |
|---|---|
| Protokol | H19T-PROTOKOL v0.1 (58cf9ea) |
| Vakalar | `vakalar.v0.1.json`, SHA-256 `60877b5f…` (cf34d39) |
| Kör kontrol | H19 sahibinin bağımsız örneklemi; ilk seed-1924 örneklemi dışarıda. 16/16 uyum, diğer eksenler dahil (39c8bb5); düşen vaka yok |
| Ölçüm kapısı | 27dfaa6 |
| Model ve çağrı | `jev-1.13.0`, 160 çağrı (V1 + V2), iki tur da aynı vaka özeti |
| Ham çıktılar | [`sonuc/2026-09-24T10-50-04-591Z/`](sonuc/2026-09-24T10-50-04-591Z/) |
| Ölçümden önce yazılmış analizin tam çıktısı | [`rapor.md`](sonuc/2026-09-24T10-50-04-591Z/rapor.md) |

## Önceden yazılmış kurala göre sonuç

**T1 geçti · T2 kaldı · T3 geçti · T4 geçti · T5 geçti.**

§10'a göre:
- `τ = 0.64` terfi etmez;
- bu sette yeni eşik aranmaz;
- ham P(D5) yalnız sıralayıcı olarak kalır;
- H19s açılmaz.

T2'de kalan iki madde:

| T2 maddesi | Değer | Eşik |
|---|---|---|
| D1 içeren negatiflerde FPR | 8/12 = **%66.7** | ≤ %60 |
| System Two yükündeki azalma (route_B − route_T) | **8.8 puan** (%75.0 → %66.3) | ≥ 10 puan |

## İki çalışma noktası yan yana (V1)

| | P(D5) ≥ 0.50 | **P(D5) ≥ 0.64** |
|---|---|---|
| Genel D5 yakalama | 40/40 = %100 | 39/40 = %97.5 |
| PS / PP yakalama | 20/20 · 20/20 | 20/20 · 19/20 |
| Genel FPR | 20/40 = %50.0 | 14/40 = %35.0 |
| NP FPR | 11/20 | 7/20 = %35.0 |
| Toplam route (System Two yükü) | 60/80 = %75.0 | 53/80 = %66.3 |
| Precision (yalnız bu setin %50 prevalansında) | %66.7 | %73.6 |

- Ham P(D5) AUC: V1 0.930 (Hanley–McNeil %95: 0.871–0.989) · V2 0.932.
- Kararlılık: V1–V2 ortalama |Δ| 0.012; route_T karar uyumu %96.3.

## Ne öğrendik

**1. Yakalama tarafı tuttu.**
- `0.64`, yeni 80 vakada kritik D5'lerin 39/40'ını yakaladı: PS 20/20, PP 19/20. Her eş-eksen grubu ≥ %75.
- Tek kaçan PP12: kilit sırası kaldırma, P(D5) 0.63.
- Bağlam dayanıklılığı (T4) geçti:
  - ipucusuz pozitifler 10/10;
  - kilit bağlamı olmayan pozitifler 11/11.
- Kalibrasyon kuralı (geçmiş üç sette her birinde ≥ %90 recall) yeni sette de recall'ı korudu.

**2. Kalan taraf yanlış alarm, ve sorun eşik değil D1.**

| Negatif grubu | ≥ 0.50 | ≥ 0.64 |
|---|---|---|
| D1 içeren | 10/12 | **8/12** |
| NS D1 (tek eksen) | 4/4 | 4/4 |
| D0 içeren | 2/12 | 0/12 |
| D4 içeren | 4/12 | 2/12 |

- NS D1'in dört vakası şunlar: komut makbuzu çakışması (NS08), tekrar özetinden alan çıkarma (NS05–NS07). P(D5) 0.77–0.86.
- Route edilen D1'li NP'ler: NP09, NP10, NP11, NP13. P(D5) 0.80–0.90.
- Bu değerler pozitiflerin tipik aralığında: PS medyanı 0.94, PP medyanı 0.90.
- Aynı örüntü H19d'de de vardı: 0.50'de D1 içeren negatiflerin 9/12'si route edildi, S1 D1 negatiflerini içeri aldı.
  H19a'daki "transaction komşuluğu" bulgusu böylece üçüncü kez görüldü: Jev, tekrar/makbuz/idempotency
  değişikliklerini eşzamanlılık değişikliği gibi okuyor.

**3. Yük azalması küçük kaldı, çünkü karışan negatifler eşiğin çok üstünde.**
- 0.50'den 0.64'e çıkmak 6 negatifi ve 1 pozitifi dışarıda bıraktı: 60 → 53 route.
- Bu 6 negatifin P(D5)'i 0.51–0.60 arasındaydı (NP05, NP14, NP19, NP02, NS15, NS13).
- D1 bloğu ise 0.77–0.90'da; çalışma noktası yalnız kenarı kesiyor.
- Bu gözlem betimleyicidir. Protokol gereği bu sette başka eşik hesaplanmadı.

**4. Geçen maddelerin bir kısmı sınırda.** Bu satırlar T2/T4 içinde geçti ama pay yok:

| Madde | Değer | Eşik |
|---|---|---|
| Genel FPR | %35.0 | ≤ %35 |
| NP FPR | %35.0 | ≤ %35 |
| D2 içeren negatiflerde FPR | %58.3 | ≤ %60 |
| İpucu olan negatiflerde FPR | %44.4 | ≤ %45 |

- Önceden işaretlenen zor negatiflerden sürüm kelimeli anlık görüntü değişiklikleri kısmen route edildi:
  - NS12: 0.75;
  - NS10: 0.66;
  - NS09 route edilmedi.
- Kilit sırası dosyasındaki grup doğrulaması negatiflerinin çoğu dışarıda kaldı. NS14 tam 0.64'te; V2'de 0.63.

**5. Sıralama gücü dört ileriye dönük sette tutarlı.**

| Set | Ham P(D5) AUC |
|---|---|
| H19b | 1.00 |
| H19b′ birincil çapraz | 0.92 |
| H19d | 0.934 |
| **H19t** | **0.930** |

- Sorun sıralama değil: D1 değişiklikleri pozitiflerle aynı bölgeye düşüyor.
- Tek boyutlu bir eşik bu karışıklığı ayıramıyor. H19d'de göreli eksen skoru da ayıramamıştı.

## Bundan çıkan sınır

- `P(D5) ≥ 0.64` System One filtresi olarak terfi etmez; H19s açılmaz.
- Bu H19t seti yeni eşik ya da skor türetmek için kullanılmaz (§10, §11, SENTEZ K9).
- Desteklenen tek şey önceki sonuçla aynı: **ham P(D5) iyi bir sıralayıcı.**
- Yüksek recall'ı koruyan her çalışma noktası, D1 (tekrar/makbuz/idempotency) değişikliklerini yanlış alarm
  olarak System Two'ya taşıyor.
- Buradan sonraki adım, yeni bir ön kayıt ve tamamen yeni vakalar gerektirir. Sıradaki deneyi seçmek H19
  sahibinin kararıdır.

## English handoff

H19t (pre-registered, 80 new balanced cases, independent owner blind check 16/16, pinned `jev-1.13.0`,
V1 + V2 = 160 calls):
- **Result: T1, T3, T4 and T5 passed; T2 failed.** `P(D5) >= 0.64` is not promoted and H19s does not open.
- **Recall held.** 39/40 overall, PS 20/20, PP 19/20, every pair group ≥ 75%. Cue-free and lock-free positives
  were all caught. Runs were stable (mean |Δ| 0.012, 96.3% route agreement).
- **T2 failed on two items.**
  - D1-containing negatives had 66.7% FPR against a 60% limit: 8/12 routed.
  - System Two load fell by only 8.8 points against the 10 required (75.0% → 66.3%).
- **The false alarms are the D1/D5 conflation seen in H19a and H19d.** Receipt, request-hash and idempotency
  changes score P(D5) 0.77–0.90, inside the positives' range. The threshold only trims the 0.50–0.64 edge.
- **Several passed items sit exactly at their limits:** FPR 35.0%, NP FPR 35.0%, D2 FPR 58.3%, cue-negative
  FPR 44.4%.
- **Ranking is consistent across four prospective sets:** raw P(D5) AUC 1.00 / 0.92 / 0.934 / 0.930.
- Per the protocol, no other threshold was computed on this set.
