# Jev Türkçe randevu değerlendirmesi

TypeSafe Jev'in (System-One karar modeli) Türkçe salon mesajlarında doğru seçimi yapıp yapmadığını ve
seçenek açıklamalarını randevu diline göre "hazırlamanın" doğruluğu ne kadar artırdığını ölçer.

**Kapsam:** Bu bir deneydir. AI şu an MVP dışıdır (`PRODUCT_SPEC.md`, `ROADMAP.md`); bu klasör
`TASKS.md`'ye girmez ve main'e merge edilmez. Tüm mesajlar sentetiktir, gerçek müşteri verisi yoktur.

## Gerekenler

- Ortam secret'i: `TYPESAFE_API_KEY`
- Ağ izni: `api.typesafe.ai` (dokümanlar için ayrıca `docs.typesafe.ai`)
- Node 20+

Ortam ayarları yeni oturumda geçerli olur.

## Çalıştırma

```sh
cd experiments/jev-tr-eval
npm install
npm run eval:mock            # ağsız kuru çalışma: betiğin uçtan uca çalıştığını doğrular
npm run eval                 # gerçek ölçüm, 3 görev × 2 varyant ≈ 490 çağrı, maliyeti bir sentin altında
npm run eval -- --task=niyet --variant=hazirlanmis --limit=20
npm run eval -- --threshold=0.7
```

Rapor `results/<zaman>/report.md`'ye, her çağrının ham sonucu `raw.jsonl`'e yazılır (`results/` Git'e girmez).

## Görevler

| Görev | Dosya | n | Soru |
|---|---|---|---|
| niyet | `data/intent.jsonl` | 183 | 12 niyetten hangisi: randevu al/taşı/iptal, gecikme, fiyat, bilgi, onay, ret, şikayet, memnuniyet, insan istiyor, diğer |
| hizmet | `data/service.jsonl` + `data/service-catalog.json` | 30 | Örnek salon katalogundaki hangi hizmet, ya da katalogda yok |
| saat | `data/slot.jsonl` | 31 | Sunulan boş saatlerden hangisi, ya da hiçbiri |

Her satırda `gold` (beklenen), `accept` (kabul edilebilir seçenekler), `tags` (zorluk: `olumsuzluk`, `yazim`,
`baglam`, `ironi`, `coklu`, `belirsiz`, `listede_yok`, `tuzak`...) ve `ambiguous` alanları vardır.
Belirsiz mesajlarda doğru davranış, düşük güvenle soruya/insana düşmektir; bu yüzden doğruluk yalnız net
mesajlarda ölçülür, belirsizlerde "belirsizde durma" oranı raporlanır.

Varyantlar (`tasks.mjs`):

- **duz:** kısa etiket açıklamaları
- **hazirlanmis:** açıklamalara tipik Türkçe ifadeler, eş anlamlı hizmet adları ve Türkçe saat kuralları
  ("çeyrek kala", "buçuk", "7de" = 19:00) eklenmiş hâli
- **kural:** niyet görevi için anahtar kelime kuralları (`baseline-rules.mjs`), API çağrısı yok

Talimatlar state alanlarına `musteri_mesaji` gibi adıyla atıf yapar; soru adı modele gitmez
(Jev-Mem'in `memory/jev_questions.py` yazım kuralı).

## Metrikler

- **Doğruluk:** net mesajlarda seçimin `accept` içinde olma oranı
- **Otomatik:** güveni eşiğin (varsayılan 0.8) üstünde olup insana sorulmadan uygulanacak kararların oranı
- **Emin ama yanlış:** eşiğin üstünde olup yanlış olan kararlar; botun asıl riski
- **Belirsizde durma:** belirsiz mesajlarda güvenin eşiğin altında kalma oranı
- Gecikme (p50/p95), girdi token'ı ve maliyet (`--price`, varsayılan $0.042/1M girdi token)

Raporda ayrıca eşik tablosu (0.5–0.9), etiket ve zorluk etiketine göre doğruluk ve en emin olunan
yanlışlar listelenir.

## Sınırlılıklar

- Test seti, hazırlanmış açıklamalar ve kurallar aynı kişi tarafından yazıldı. Hazırlık örnekleri test
  mesajlarının birebir kopyası değil, ama kurallar test setini görerek yazıldı. Bu yüzden `hazirlanmis`
  ve özellikle `kural` sonuçları iyimserdir.
- Hazırlamanın gerçek kazancı, açıklamalar güncellendikten **sonra** yazılan yeni bir mesaj setiyle
  (ideali anonimleştirilmiş gerçek mesajlar) doğrulanmalıdır.
- Mesajlar sentetik; gerçek WhatsApp trafiğinin dağılımını temsil etmez.
