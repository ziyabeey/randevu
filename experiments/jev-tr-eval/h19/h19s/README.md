# H19s: gerçek PR trafiğinde gölge ölçümü, çalıştırma düzeni

- **Geçerli protokol:** [`../H19S-PROTOKOL-v0.2.md`](../H19S-PROTOKOL-v0.2.md) (87a8ff5). v0.1'in OpenAI okuyucu,
  fiyat ve secret kolu kullanılmaz.
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

1. **Gölge.** `NODE_USE_ENV_PROXY=1 node h19/h19s/golge.mjs --out <gölge-dizini>` komutu merge'ler geldikçe
   çalıştırılır.
   - Yeniden çalıştırmak güvenlidir: kayıtlı birim yeniden çağrılmaz ve girdisi değişmişse betik durur.
   - Stop rule, sonuçlara bakılmadan `cikar.mjs` içinde uygulanır.
2. **Paketler.** Stop rule sağlanınca `node h19/h19s/paket.mjs --kohort <gölge-dizini>/kohort.json --out <paket-dizini>`.
   - Reader A (yeni bir ChatGPT oturumu) ve Reader B (yeni bir Claude oturumu) aynı partileri ayrı ayrı alır.
   - Cevaplar `etiket-A.json` ve `etiket-B.json` dosyalarına yazılır; biçim `manifest.json` içinde.
   - Her okuyucu için ürün, görünen model ve tarih kaydedilir.
3. **Tie-break ve gözlenen D5.**
   - D5 ya da actionable_d5 uyuşmazlığında yalnız SHA'ya bağlı mevcut kanıt `tiebreak.json`'a yazılır:
     `{unit_id, field, value, evidence}`. Kanıt yoksa kayıt yazılmaz ve etiket `undetermined` kalır.
   - Gözlenen actionable D5 `gozlenen.json`'a yazılır: birim ya da PR kaydı, `yes | no | unknown`.
   - İkisi de gölge sonucu kapalıyken yapılır.
4. **Analiz.** Etiketler, tie-break ve gözlenen kayıtları commit'lendikten sonra:
   `node h19/h19s/analiz.mjs --kohort … --golge … --a etiket-A.json --b etiket-B.json [--tiebreak …] --gozlenen … --out <dizin>`.

## Analizde önceden sabitlenen okumalar

Bunlar veri görülmeden yazıldı; protokol bu noktalarda sessiz.

- **Birincil etiket.**
  - A ve B aynı değeri verdiyse o değer kullanılır.
  - Uyuşmazsa d5 ve actionable_d5 için kanıt kaydı varsa o, yoksa `undetermined`.
  - d1 için tie-break yok; uyuşmazlık `undetermined` kalır.
- **Kapılar sayıma dayanır.** n = 0 olan bir kapı boş geçer ve raporda "n=0" diye işaretlenir. Örnek:
  actionable D5 hiç yoksa "kaçan 0" olur.
- **S5 yarıları:** kohort sırasındaki ilk ⌊n/2⌋ birim ve kalanı.
- **Bootstrap:** PR düzeyinde, 2000 örnekleme, tohum 19; yalnız rapor.
- **Paket istemi:** yalnız `referans-etiket.v0.2.json`'daki tanımlardan kurulur. Tek ek, yeni rutinler için
  şu cümledir: "yeni rutinde, rutinin getirdiği davranışı değerlendir". İstem özeti `manifest.json`'a yazılır.
