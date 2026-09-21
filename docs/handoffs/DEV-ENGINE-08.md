# DEV-ENGINE-08 devir

## Kimlik ve kapsam

- Görev: [DEV-ENGINE-08 / Issue #264](https://github.com/ziyabeey1-ai/randevu/issues/264)
- PR: [#265](https://github.com/ziyabeey1-ai/randevu/pull/265)
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
- Varsayılan retry alt sınırı 300 saniye, timeout 60 saniye (yerel 3B modelde 7 adaylık
  sınıflandırma sıcak önbellekle ~15 sn, soğuk önbellekle 34–40 sn sürdü; 30 sn yetmedi).
- Prompt yalnız küçük normalize JSON satırlarını taşır.
- Ana A/B/C/D coordinator inference kontratı (girdi satırları, çıktı şeması, policy üst sınırı)
  değiştirilmez. Yalnız prompt'taki somut örnek (`{"208":"D"}`) beklenen anahtar listesiyle
  değiştirildi: yerel model örneği aynen kopyalayıp yalnız o PR'ı yanıtlıyordu.

## Güvenlik sınırı

V0 Janitor'ın GitHub write authority'si **yoktur**. `CLOSE_CANDIDATE`,
`REBASE_CANDIDATE` ve `REVIEW_CAPACITY` yalnız yerel rapor tavsiyesidir.
Action queue, merge, ready, close, comment veya branch mutation üretmez.

## Kabul durumu

Semantic code head `6760bec98619b63f5dc737b6d4a0878e4668cd69` için
[CI #1946](https://github.com/ziyabeey1-ai/randevu/actions/runs/35586259231)
**SUCCESS**: full-code 11/11 aşama ve CI gate geçti.

### Canlı Mac shadow smoke (2026-09-21)

Janitor modülü Mac'teki `~/.local/share/qwen-coordinator` kurulumuna yerleştirildi ve
LaunchAgent tikleri (15 sn) izlendi. Model: `qwen2.5-coder-3b-instruct-q4_k_m`.

1. İlk tur (10:19 UTC, eski prompt): bounded snapshot 7 aday üretti; Qwen yalnız prompt
   örneğini kopyaladı (`{"248":"CLOSE_CANDIDATE"}`, 1/7) ve validator fail-closed reddetti.
2. Aynı 7 adayla prompt varyantı ölçüldü: somut örnek yerine beklenen anahtar listesiyle
   3/3 denemede 7/7 kapsama, hepsi `allowedChoices` içinde; süre sıcak ~15 sn, soğuk 34–40 sn.
   Bu yüzden `janitorTimeoutSeconds` varsayılanı 60 sn yapıldı.
3. Düzeltilmiş prompt ile canlı tur (10:29 UTC): `status=complete`, 7/7 —
   #236/#240/#255/#261/#263 `REBASE_CANDIDATE` (stale base), #248 `CLOSE_CANDIDATE`
   (superseded), #267 `REVIEW_CAPACITY` (review kota sinyali).
4. Fingerprint değişmeden izleyen 4 LaunchAgent tikinde `lastJanitorQwenAttemptAt`
   değişmedi ve yeni `janitor-qwen-*` log satırı oluşmadı; önceki sonuç yeniden kullanıldı.
5. `coordinator.err.log` boş; LaunchAgent son çıkış kodu 0.

Bekleyen kanıt: prompt/timeout düzeltmesini içeren yeni head için exact-head CI.

Bu kanıtlar gelmeden DEV-ENGINE-08 tamamlandı sayılmaz ve write capability
eklenmez.
