# DEV-ENGINE-08 devir

## Kimlik ve kapsam

- Görev: [DEV-ENGINE-08 / Issue #264](https://github.com/ziyabeey1-ai/randevu/issues/264)
- Branch: `dev-engine/qwen-janitor-v0`
- Bağımlılık: DEV-ENGINE-07 kabul edilmiş yerel Qwen koordinatörü.
- Amaç: aynı daemon içinde düşük-yük, advisory-only repo hijyeni / Janitor katmanı.

## V0 kontratı

Janitor mevcut authenticated GitHub snapshot'ını kullanır. Ek olarak yalnız son
20 merged PR'ın numara, başlık, zaman ve en fazla 20 dosyalık metadata yüzeyini
okur. Diff veya tam repo geçmişi Qwen'e taşınmaz.

Deterministik katman şu adayları üretir:

- `SUPERSEDED_CANDIDATE`: daha sonra merge olmuş aynı task anahtarındaki PR aynı
  docs yüzeyine dokunmuş;
- `DUPLICATE_CANDIDATE`: daha yeni açık docs PR aynı task + aynı dosya setini
  taşıyor;
- `STALE_BASE`: docs-only PR current main'e bağlı değil ve daha güçlü kanıt yok;
- `REVIEW_CAPACITY_DEGRADED`: Codex/code-review quota mesajı var; bu bir kod/CI
  failure değildir.

Remote snapshot eksik/ulaşılamazsa veya merged file listesi truncated ise cleanup
kanıtı fail-closed kalır.

## Qwen yük bütçesi

- Candidate yoksa Janitor completion çağrısı yok.
- Candidate fingerprint değişmedikçe sonuç yeniden kullanılabilir.
- Varsayılan retry alt sınırı 300 saniye, timeout 30 saniye.
- Prompt yalnız küçük normalize JSON satırlarını taşır.
- Ana A/B/C/D coordinator inference kontratı değiştirilmez.

## Güvenlik sınırı

V0 Janitor'ın GitHub write authority'si **yoktur**. `CLOSE_CANDIDATE`,
`REBASE_CANDIDATE` ve `REVIEW_CAPACITY` yalnız yerel rapor tavsiyesidir.
Action queue, merge, ready, close, comment veya branch mutation üretmez.

## Kabul durumu

Bekleyen kanıt:

1. exact-head repository CI;
2. Mac installer refresh ile `janitor.mjs` kopyası;
3. bir canlı shadow turunda bounded GitHub snapshot;
4. #248-benzeri superseded aday ve #259-benzeri review quota sinyalinin doğru
   raporlanması;
5. fingerprint değişmeden tekrarlanan LaunchAgent tiklerinde ekstra Janitor
   completion oluşmadığının log doğrulaması.

Bu kanıtlar gelmeden DEV-ENGINE-08 tamamlandı sayılmaz ve write capability
eklenmez.
