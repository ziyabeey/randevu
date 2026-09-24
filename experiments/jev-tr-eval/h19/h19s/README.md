# H19s: gerçek PR trafiğinde gölge ölçümü, çalıştırma düzeni

- **Geçerli protokol:** [`../H19S-PROTOKOL-v0.2.md`](../H19S-PROTOKOL-v0.2.md) (87a8ff5) + ölçüm öncesi [`CLARIFICATIONS-v0.2.1.md`](CLARIFICATIONS-v0.2.1.md) (`abcdbfe`). v0.1'in OpenAI okuyucu, fiyat ve secret kolu kullanılmaz.
- **Kohort başlangıcı:** [`START-v0.2.md`](START-v0.2.md) kaydından (159e74c) sonraki ilk `main` merge'i.
- **Bu yazılırken kohortun durumu:** 3 PR merge edilmişti (#526, #527, #525). Hiçbiri migration değiştirmiyordu,
  yani **0 birim** vardı. Analiz ve paket kodu ilk birimden önce yazıldı.

| Dosya | İş |
|---|---|
| `cikar.mjs` | Deterministik birim çıkarıcı (§2–§3). H19 skoru, etiket ya da review sonucu okumaz |
| `golge.mjs` | Kohortu çıkarır, her yeni birim için V ve gerekirse ayrıştırıcıyı çalıştırır (§1, §4). Artımlıdır. `kohort.json` (H19 çıktısı yok) ve `golge.jsonl` (**kapalı**) yazar |
| `paket.mjs` | Stop rule sağlanınca okuyucu partilerini ve `manifest.json`'u üretir. Yalnız `kohort.json` okur |
| `analiz.mjs` | S1–S5 ve §12 ikincil raporlar. Route kararını donmuş kuraldan yeniden hesaplayıp kayıtla karşılaştırır. Yalnız sahte veriyle sınandı |

## Sıra

1. **Kohortu izle, Jev çalıştırma.**
   `node h19/h19s/golge.mjs --out <kohort-dizini> --dry-run`
   - Bu yalnız `kohort.json` üretir/günceller; Jev çağrısı yapmaz.
   - Stop rule sağlanana kadar aynı komut güvenle tekrar çalıştırılır.
2. **Kör paketleri üret.** Stop rule sağlanınca:
   `node h19/h19s/paket.mjs --kohort <kohort-dizini>/kohort.json --out <paket-dizini>`
   - Reader A (fresh ChatGPT) ve Reader B (fresh Claude) aynı partileri ayrı ayrı alır.
   - H19 shadow sonucu bu aşamada henüz **yoktur**.
3. **Referansları mühürle.**
   - `etiket-A.json` ve `etiket-B.json` commitlenir.
   - D5/actionable_d5 uyuşmazlıklarında yalnız SHA-bound mevcut evidence ile `tiebreak.json` hazırlanır.
   - `gozlenen.json` commitlenir.
4. **Shadow'u ancak şimdi çalıştır.**
   `NODE_USE_ENV_PROXY=1 node h19/h19s/golge.mjs --out <gölge-dizini>`
   - `jev-1.13.0` dışında modele geçiş yoktur.
   - Kohort, kör paketlerde kullanılan frozen kohortla aynı olmalıdır.
5. **Analiz.**
   `node h19/h19s/analiz.mjs --kohort … --golge … --a etiket-A.json --b etiket-B.json [--tiebreak …] --gozlenen … --out <dizin>`

Bu sıra `CLARIFICATIONS-v0.2.1` ile sabittir ve raw H19 sonucunu ayrı dalda gizleme ihtiyacını kaldırır.

## Analizde önceden sabitlenen okumalar

Bunlar veri görülmeden yazıldı; protokol bu noktalarda sessiz.

- **Birincil etiket.**
  - A ve B aynı değeri verdiyse o değer kullanılır.
  - Uyuşmazsa d5 ve actionable_d5 için kanıt kaydı varsa o, yoksa `undetermined`.
  - d1 için tie-break yok; uyuşmazlık `undetermined` kalır.
- **Primary n=0:** zorunlu bir oran gate'inin paydası 0 ise `insufficient-n`; tam H19s PASS üretmez. Yalnız protokolde açıkça istisna verilen belirsiz-D1 resolver alt metriği n<5 iken non-gating kalır.
- **S5 yarıları:** kohort sırasındaki ilk ⌊n/2⌋ birim ve kalanı.
- **Bootstrap:** PR düzeyinde, 2000 örnekleme, tohum 19; yalnız rapor.
- **Paket istemi:** yalnız `referans-etiket.v0.2.json`'daki tanımlardan kurulur. Tek ek, yeni rutinler için
  şu cümledir: "yeni rutinde, rutinin getirdiği davranışı değerlendir". İstem özeti `manifest.json`'a yazılır.
