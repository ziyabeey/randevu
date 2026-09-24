# H19b′ sonucu (24 Eylül 2026)

| Bilgi | Değer |
|---|---|
| Protokol | H19B-PRIME-PROTOKOL v0.1 (5bc1aed) |
| Vakalar | `vakalar.v0.1.json`, SHA-256 `2ca2e3fc…`, 0e959d3 |
| Kör kontrol | 16/16 uyum (55e0e4c, 85dc13f); düşen vaka yok |
| Ölçüm kapısı | a721828 |
| Model ve çağrı | `jev-1.13.0`, 256 çağrı (JF1, JF2, J0, V × 64) |
| Ham çıktılar | [`sonuc/2026-09-24T08-41-42-192Z/`](sonuc/2026-09-24T08-41-42-192Z/) |
| Ölçümden önce yazılmış analizin tam çıktısı | [`rapor.md`](sonuc/2026-09-24T08-41-42-192Z/rapor.md) |

## Önceden yazılmış kurala göre sonuç

**P1 kaldı. JF mevcut V yöntemini geçmedi; H19c açılmaz. J0, JF'den iyi çıktı; K11 bu kullanımda negatif katkı
olarak raporlanır.**

| Kol | AUC(B′, C′): birincil çapraz |
|---|---|
| **V** (eski 6 eksen, P(D5)) | **0.92** |
| J0 (Choice, facts yok) | 0.86 |
| JF (facts + Choice) | 0.82 |

| Kapı | Değer | Eşik | |
|---|---|---|---|
| P1: JF − V | −0.100 (bootstrap %95: −0.264 … +0.041) | ≥ +0.10, alt sınır > 0 | kaldı |
| P1: JF | 0.82 | ≥ 0.80 | geçti |
| P2: JF − J0 | −0.035 (%95: −0.139 … +0.049) | ≥ +0.05, alt sınır ≥ 0 | kaldı |
| P2: C′'de facts şişirmesi | +0.058 | ≤ +0.05 | kaldı |
| P3: genel / A′–C′ / B′–D′ | 0.89 / 0.98 / 0.78 | ≥ 0.80 / 0.75 / 0.75 | geçti |
| P4: no_effect doğruluğu C′ / D′ | %56.3 / %37.5 | ≥ %75 | kaldı |
| P4: \|C′ − D′\| | 0.067 | ≤ 0.10 | geçti |
| P5: yön genel / weakens / strengthens | %71.9 / %87.5 / %56.3 | ≥ %80 / %75 / %75 | kaldı |
| P5: undetermined | %0 | ≤ %15 | geçti |
| P6: JF1–JF2 ort. \|Δ\| | 0.020 | ≤ 0.05 | geçti |
| P6: yön argmax uyumu (A′+B′) | %87.5 | ≥ %90 | kaldı |
| P6: JF1 − JF2 AUC | 0.006 | ≤ 0.10 | geçti |

## Ne öğrendik

**1. Facts, öncül gibi davranıp kararı ipucu yönüne itiyor.** Aynı Choice sorusunda facts eklemenin (JF − J0)
hücre bazında ortalama etkisi:

| A′ | B′ (kilit yok) | C′ (kilit var) | D′ (kilit yok) |
|---|---|---|---|
| 0.000 | −0.012 | **+0.058** | **−0.136** |

- `lock_context=true` skoru yukarı, `false` aşağı itiyor.
- Bu tam olarak SENTEZ K11'in sonuç kuralının uyardığı "verilen olgu da bir ipucudur" etkisi; artık ileriye
  dönük ve önceden yazılmış eşikle ölçüldü.
- Tasarım gereği ipucu B′–C′ çaprazında yanlış yöne işaret ediyor. Bu yüzden facts birincil çaprazda zarar
  veriyor (0.86 → 0.82) ve D′'deki yanlış pozitifleri azaltarak ancak kısmen telafi ediyor.

**2. Eski V sorusu zor sette de en iyi dedektör.**
- B′–C′ çaprazında 0.92; kilitli C′ negatiflerinde ortalama P(D5) yalnız 0.33.
- H19a'daki kilit kelimesi etkisi gerçek bir nedensel etkiydi (+0.20). Ama dengeli ve zor bir sette V'nin
  ayrıştırmasını bozmaya yetmiyor.
- Olası açıklama: V başka eksenlere (D0/D2/D3/D4) de soru sorduğu için model değişikliği doğru eksene
  "yükleyebiliyor". Tek Choice ise "eşzamanlılığı etkiliyor mu, etkilemiyor mu" arasında seçim yapmaya
  zorluyor.

**3. Tek Choice, "koruma" kelimesini genel koruma olarak okuyor.** D′'nin yanlış pozitifleri (JF1 argmax ≠
no_effect):

| Eksen | D′ |
|---|---|
| D0 | 4/4 |
| D3 | 4/4 |
| D2 | 1/4 |
| D4 | 1/4 |

- Kiracı kapsamı veya personel uygunluğu koşulunun silinmesi `weakens` sayılıyor.
- `removed_predicate` ailesinde hata 8/11 (JF ve J0 aynı). H19b'deki D09 tuzağı ölçekli olarak doğrulandı.
- Aynı vakalarda V'nin ortalama P(D5) değeri D0'da 0.48, D3'te 0.41.

**4. Yön zayıf ve facts yönü düzeltmiyor.**
- JF ile J0'ın yön doğruluğu aynı (%71.9); ama hataları farklı vakalarda.
- JF'nin yeni hatası: `stale_token` ailesinde 3/8 (AP02, AP04, AP10). "Belirteç zorunlu oldu" değişikliğini
  `weakens` okuyor. J0 bu ailede 0/8 hata yaptı.
- Facts'in yararı: `surface_protective` ailesinde JF 0/5, J0 2/5.
- Seri hale getiren yardımcıya devretme (`helper_delegation`) iki kolda da çoğunlukla görülmüyor. Yardımcının
  gövdesi görünmüyor.

**5. Kararlılık ve maliyet.**
- Detection kararlı (ort. |Δ| 0.020).
- Yön argmax'ı A′+B′'de %87.5 tutarlı; 4 vaka turlar arasında seçim değiştirdi.
- Çağrı başına 640–880 giriş tokenı.

## Sonuç

H19 serisinin bu basamağında sonuç net:
- **Eski V sorusu en iyi dedektör.**
- **Facts'i Jev'e öncül olarak vermek (K11'in bu kullanımı) zarar veriyor.**
- **Yönsel Choice, yön bilgisini güvenilir biçimde (≥ %80) veremiyor.**

K11'in ilk yarısı ("çıkarılabilir olgu Jev'e sorulmaz, kod hesaplar") geçerliliğini koruyor. Değişen, olgunun
nerede kullanılacağı: bu veride olguyu Jev'in girdisine koymak ipucu gibi çalıştı. SENTEZ K11 buna göre
güncellendi.

Bu sonuç bir "D5 çözülemez" iddiası değildir. İddia yalnız şudur: **bu protokoldeki olgu-koşullu yönsel Choice,
V'yi geçmedi ve facts ek değer katmadı.**

## English handoff

H19b′ (pre-registered, 64 new cue-balanced cases, blind check 16/16, pinned `jev-1.13.0`, 256 calls): **P1
failed**.
- On the primary cross (real D5 without cue vs. non-D5 with real lock context), the legacy 6-axis V question
  scores AUC 0.92. J0 (Choice without facts) scores 0.86 and JF (facts + Choice) 0.82, so JF − V = −0.10.
- **Facts act as a prior:** they shift detection toward the cue (C′ +0.058, D′ −0.136, B′ −0.012). P2 fails
  and the pre-registered reading is "K11 negative contribution in this use".
- The single-Choice framing reads any guard change as concurrency protection. D0 and D3 predicate removals in
  D′ are false positives 4/4; the removed-predicate family has 8/11 errors.
- Direction accuracy is 71.9% in both J arms. Facts add stale-token direction errors (3/8) and fix
  surface-protective ones (0/5 vs 2/5).
- Detection is stable (|Δ| 0.020).

H19c stays closed. Keep code-extracted facts in code; do not feed them to Jev as premises without measurement.
