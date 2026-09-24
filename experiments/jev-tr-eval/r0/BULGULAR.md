# Bulgular — R0 inceleme yorumlarını okumak: regex ve Jev (24 Eylül 2026)

Soru: geliştirme motorunun R0 inceleme yorumunu "temiz mi" diye okuyan kodu
(`scripts/prepare-development-review-observation.mjs` → `r0Receipt()`, satır 328-331) gerçek
yorumlarda ne kadar doğru, Jev buna ne katar?

## Veri

- `ziyabeey/randevu`'daki 404 PR'ın tamamı tarandı; üretimdeki aday tanımıyla 133 PR'da **230 R0 adayı**:
  175 Copilot incelemesi, 55 ekip R0/R2 yorumu (`r0/collect.mjs` → `candidates.jsonl`).
- **Referans etiket** yazarın kendi kararı: Copilot'ta başlık (🟢 Approval recommended / 🟡 Changes
  recommended / 🔵 Needs a closer look), ekipte `VERDICT:` satırı (`r0/label.mjs`).
- 50 🔵 incelemesi ayrıca elle "somut sorun mu / genel insan incelemesi önerisi mi" diye etiketlendi
  (`r0/blue-labels.json`: 30 somut, 17 genel, 3 belirsiz).

## 1. Üretimdeki regex (Jev'den bağımsız)

| Kaynak | Etiket | n | Regex "temiz" | Regex "temiz değil" |
|---|---|---|---|---|
| Copilot | 🟢 temiz | 33 | 15 | **18** (sahte bloklayıcı) |
| Copilot | 🟡 değişiklik gerekli | 92 | 0 | 92 |
| Copilot | 🔵 insan bakmalı | 50 | **26** | 24 |
| Ekip | temiz | 51 | 44 | **7** (sahte bloklayıcı) |
| Ekip | değişiklik gerekli | 4 | 0 | 4 |

- Regex Copilot'un kendi kararını taşıyan başlığa hiç bakmıyor; yalnız `**Findings:** None` satırını arıyor.
  Bu yüzden 🔵 incelemelerin kararı, o satırın bulunup bulunmamasına göre rastgele değişiyor.
- Regex'in "temiz" okuduğu 26 🔵 incelemenin **14'ü somut bir sorun anlatıyor**; örnek: #202 "`ci.yml`
  … fetches only the first page … can miss the needed `main` push baseline".
- Ekip tarafındaki 7 sahte bloklayıcının nedeni biçim: `VERDICT: **ACCEPTABLE**`, `**NO FINDINGS**`,
  `PASS / ACCEPTABLE`.

**Zaman bağlamı:** `**Findings:** None` kontrolü 2026-09-23'te (#342) eklendi; Copilot incelemeleri
#300'den beri yok. Yani bu hataların çoğu, bugünkü kodu geçmiş yorumlara uygulayarak bulundu; o yorumlar
üretimde bu koddan geçmedi. #3xx'te 3 sahte bloklayıcı var, hepsi #333'teki kalın `VERDICT: **…**`
biçimi; #4xx'te 0. **Bugün aktif bir arıza değil**, biçim değişikliğine karşı
kırılganlık: Copilot incelemeleri geri gelirse ya da bir R0 ajanı biçimi değiştirirse sessizce yanlış okur.

## 2. Jev (`jev-1.13.0`, 510 çağrı, 0 hata, ≈ $0.02)

| Kaynak | Yöntem | İkili doğruluk |
|---|---|---|
| Copilot (175) | üretim regex'i | %74.9 |
| | Jev, tam metin | **%97.7** |
| | Jev, başlık çıkarılmış | %92.6 |
| Ekip (55) | üretim regex'i | **%87.3** |
| | Jev, tam metin | %80.0 |
| | Jev, VERDICT satırı çıkarılmış | %41.8 |

- Copilot'ta Jev başlık olmadan da %92.6: biçim değişse bile kararı içerikten çıkarabiliyor.
- Ekip yorumlarında Jev regex'ten kötü: "VERDICT: NO FINDINGS … NEXT ACTION: R1 incelemesini başlat"
  gibi yorumlarda **sonraki süreç adımını açık sorun sandı**. Copilot'ta da "🟢 yalnız küçük bir nit"
  yorumlarını "değişiklik gerekli" saydı. Bu yanlışların **hepsi düşük güvenli** (0.08–0.78).
- **Çelişki dedektörü** (Jev regex'le çelişip güveni ≥ 0.9 ise işaret): 51 regex hatasının **27'sini**
  yakaladı, **0 yanlış alarm**.
- **🔵 somut sorun sorusu:** elle etiketli 47 yorumda **%93.6** doğru. Regex'in "temiz" okuduğu 14 somut
  sorunlu yorumun 6'sını ≥ 0.9, 9'unu ≥ 0.8 güvenle yakaladı; aynı gruptaki 10 genel yorumun hiçbirinde
  0.08'i geçmedi (yanlış alarm yok).

## Öneriler

1. **Önce kurallı düzeltme, AI gerekmez.** Copilot başlığındaki 🟢/🟡/🔵 durumunu oku; `VERDICT:`
   satırında `**`/`` ` `` işaretlerini temizle ve `PASS`'ı tanı. (Referans etiketler bu sinyallerden
   geldiği için böyle bir parser burada tanım gereği doğru çıkar; asıl nokta bugünkü kodun bu sinyalleri
   okumaması.)
2. **Koordinatör kararı gereken politika sorusu:** 🔵 "Needs a closer look" bloklamalı mı? Bugün sonuç,
   `Findings: None` satırının olup olmamasına bağlı; tutarsız.
3. **Jev yalnız ikinci sinyal:** parser ile Jev ≥ 0.9 güvenle çelişirse mevcut contradiction/escalation
   yolu tetiklenir; karar her zaman kurallı kalır. Özellikle 🔵 incelemelerde "somut sorun var mı"
   sorusu parser'ın cevaplayamadığı anlamsal bir soru.
4. **Ekip yorumları için hazırlık denenmedi:** "sonraki süreç adımları ve CI'ın sürmesi açık sorun
   değildir", "küçük nit'ler bloklamaz" gibi açıklamalar muhtemelen düzeltir; ama bu setin hatalarına
   bakılarak yazılacağı için yeni yorumlarla ölçülmeli.

## Yan bulgu: R1/R2 gerekliliği ayrıştırıcısı

`reviewRequirementsFromTaskRow()` 7 doğal ifadenin 4'ünü yanlış okuyor: "R1 ve R2 gerekmez" → R1
gerekli; "R2'ye gerek yok" → R2 gerekli; "R1 istenmiyor" → R1 gerekli; "R1 not needed" → R1 gerekli.
Bugün ekip `R2 not required` kalıbını yazdığı için sorun çıkmıyor. Metni biz yazdığımız için çözüm AI
değil: sabit bir alan (`R1: required | not_required`) ve kalıba uymayan her R1/R2 ifadesini reddeden
bir kontrol.

## Tekrar üretmek

```sh
cd experiments/jev-tr-eval
NODE_USE_ENV_PROXY=1 node r0/collect.mjs     # candidates.jsonl (GitHub API)
node r0/label.mjs                            # labeled.jsonl + regex karşılaştırması
NODE_USE_ENV_PROXY=1 node r0/run-jev.mjs     # Jev ölçümü → r0/results/<zaman>/report.md
```

Bu çalıştırmanın raporu: [`rapor-2026-09-24.md`](rapor-2026-09-24.md).
