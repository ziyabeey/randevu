# H19 deney defteri ve araç aktarım kaydı

**Tarih:** 24 Eylül 2026  
**Amaç:** H19 araştırma hattında denenmiş yolları, kanıt düzeylerini ve yeni H19 aracına aktarılacak kuralları tek yerde tutmak.

Bu dosya yeni kanıt üretmez. Her satır ilgili protokol/sonuç dosyasına işaret eden bir **araştırma günlüğüdür**.
Post-hoc keşif ile prospective kanıt birbirine karıştırılmaz.

## 1. H19 nedir, deney adları nedir?

**H19 tek yöntem/araştırma hattıdır.** R0, a, b, b′, d, t, u, s gibi ekler ayrı H19'lar değil,
aynı hattın deneyleridir. İsimler tarihsel provenance için korunur; yeni araçta kullanıcı yüzüne taşınmak zorunda değildir.

## 2. Deney kronolojisi

| Deney | Soru | Sonuç | Taşınabilir ders | Durum |
|---|---|---|---|---|
| **R0** | Altı semantik eksen Jev tarafından rastgele üstü algılanıyor mu? | 16 vakada top-1 %25, top-3 %62.5–68.8; iki tur benzer. D3/D4 güçlü, D5 şüpheli. | Eksen vektörü gerçek sinyal taşıyabilir; tek eksenin mutlak skoruna güvenme. | tamamlandı |
| **H19a** | D5 sinyali gerçek davranış mı, lexical/context cue mu? | Tek sentetik `for update;` D5'i yaklaşık +0.20 itti; D1 de birlikte hareket etti. | Prompt bağlamı nedensel cue olabilir. Hard-negative ve ablation zorunlu. | tamamlandı |
| **H19b** | Deterministik facts + directional Choice D5'i iyileştiriyor mu? | J kolu güçlüydü, fakat kontrol V de tavandaydı; prereg kuralına göre **karşılaştırılamaz**. | Kolay set başarıyı sahte gösterebilir. Kontrol kolunun başarısızlık modunu gerçekten yeniden üret. | tamamlandı / incomparable |
| **H19b′** | Zor negatiflerde facts ve Choice gerçekten V'yi geçiyor mu? | V AUC 0.92, J0 0.86, JF 0.82. Facts yanlış yönde prior oldu; direction %71.9. | Çıkarılabilir facts varsayılan olarak prompt premise'i yapılmaz. Detection ve direction ayrılır. | tamamlandı / failed |
| **H19d** | Göreli eksen matematiği `D5-max(other)` ham D5'i geçiyor mu? | Ham D5 AUC 0.934, S0 0.890. P-pair recall %60. | Başka eksenle gerçek D5 birlikte değişebilir; "baskın eksen" varsayımı yanlış. Post-hoc geometri promosyon edilmez. | tamamlandı / failed |
| **H19t** | Ham D5 için geçmiş veriden sabitlenen `τ=.64` gerçek router olur mu? | Recall 39/40; fakat D1 negatif FPR %66.7 ve yük azalması 8.8 puan. T2 kaldı. | Sorun threshold değil, D1/D5 semantik karışması. Ham D5 iyi ranker, tek eşikli router değil. | tamamlandı / failed |
| **H19u** | D1/D5 belirsizliğini ikinci ucuz Choice ayırabilir mi? | 80 vaka donduruldu (`ba531c86…`); kör kontrol 15/16, A16 protokol gereği düştü; canlı ölçüm henüz yok. | V skorlarını ikinci modele premise olarak verme; resolver yalnız aynı diff'i görsün. | measurement-ready |
| **H19s** | Gerçek PR akışında shadow router ekonomik ve güvenli mi? | Henüz açılmadı. | Yalnız önceki gate'ler geçerse gerçek prevalans ve çağrı maliyeti ölçülür. | locked |

## 3. Şu anda gerçekten desteklenenler

1. **Altı eksenli V çıktısı semantik sinyal taşıyor.**
   Ham `P(D5)` dört prospective sette güçlü bir sıralayıcı oldu: yaklaşık 1.00 / 0.92 / 0.934 / 0.930 AUC.
2. **Jev'in rolü karar vermek değil, sinyal/seçim üretmek.**
   Yön ve neden System Two veya deterministik kodun işi olmalı.
3. **D1 ve D5 Jev algısında komşu.**
   Idempotency, receipt, replay ve command-identity değişiklikleri sık sık yüksek D5 alıyor.
4. **Facts model girdisinde tarafsız değildir.**
   Kodun çıkardığı doğru olgu bile model için güçlü bir prior/cue olabilir.
5. **Prospective kontrol mekanizması işe yarıyor.**
   Post-hoc umut verici görünen S0, yeni sette tersine döndü; protokol yanlış promosyona engel oldu.

Bunlar "H19 genel olarak kanıtlandı" anlamına gelmez. Bunlar Kepenk/Randevu üzerinde, mevcut model ve soru
sürümleriyle desteklenen dar bulgulardır.

## 4. Yeni araca aktarılacak zorunlu araştırma kuralları

### E1 — Ön kayıt
Soru, skor, eşik, vaka seçimi ve kabul gate'i **ilk model çağrısından önce** commitlenir.

### E2 — Yeni vaka
Prompt, skor veya router değiştiyse doğrulama tamamen yeni vakalarda yapılır. Aynı set üzerinde tuning yapılmaz.

### E3 — Kör ikinci okuyucu
Freeze sonrası örneklem bağımsız okunur. Uyuşmazlıkta vaka yeniden etiketlenmez; düşer. Örneklem kimlikleri
üretici tarafından önceden görülmüşse yeni bağımsız örneklem oluşturulur.

### E4 — Mutasyon tekrar yasağı
Önceki setlerdeki aynı semantik mutasyon yeni doğrulama setine taşınmaz. Aynı fonksiyon ancak farklı bir
mutasyonla yeniden kullanılabilir ve işaretlenir.

### E5 — Naif özellik kapısı
Diff boyutu, eklenen/silinen satır, cue kelimeleri, lock context, removed-predicate gibi tek özelliklerden biri
hedef etiketi AUC > 0.70 ile taşıyorsa set freeze edilmez.

### E6 — Hard-negative ve hard-positive dengeleme
Negatifler "kolay mesaj değişikliği" olamaz. Pozitiflerde de yalnız tek eksenli kolay örnekler kullanılamaz.
Birlikte değişen eksenler ayrıca temsil edilir.

### E7 — Detection / direction / routing ayrı deneylerdir
"Dokunuyor mu?", "hangi yönde?" ve "System Two'ya gönderelim mi?" tek metrikte birleştirilmez.

### E8 — Facts varsayılan olarak prompt dışında
Regex/AST/CFG/git/DB ile çıkarılabilen facts kod tarafından tutulur. Prompt'a verilecekse factsiz kontrol
koluna karşı prospective ek katkı önceden ölçülür.

### E9 — Post-hoc keşif sadece hipotez üretir
Aynı veride denenen çoklu formüllerden en iyisi sonuç değildir. Yeni ön kayıt ve yeni set gerekir.

### E10 — Ekonomik başarı ayrı gate
Yüksek AUC tek başına ürün başarısı değildir. Router için recall, FPR, System Two çağrı yükü ve gerçek prevalans
ayrıca ölçülür.

## 5. Tekrar edilmemesi gereken yollar

| Anti-pattern | Neden |
|---|---|
| Facts'i "doğru bağlam" diye prompt'a eklemek | H19b′'de facts kendi başına cue/prior oldu ve AUC düştü. |
| Tek directional Choice ile D5 çözmek | Genel "koruma" kavramını concurrency sanıyor; direction zayıf kaldı. |
| `D5 - max(other)` ile baskın eksen router'ı | Gerçek D5×D1 / D5×D4 vakalarını cezalandırdı. |
| Aynı sette threshold sweep | H19t sonrası yasak; çalışma noktası yeni veride doğrulanmalı. |
| Kolay negatif seti | H19b'de legacy V tavana vurdu, hedeflenen başarısızlık modu ölçülemedi. |
| Sadece D5-only pozitif | Gerçek sistemde eksenler birlikte değişiyor; H19d bunu gösterdi. |
| Rank/AUC'yi doğrudan production router sanmak | H19t: AUC ~0.93 iken operasyonel yük gate'i yine kalabildi. |

## 6. Genel araç mimarisine aktarım

H19 aracının **genel çekirdeği** ile **domain adapter'ı** ayrılmalıdır.

```text
Repo
 │
 ├─ Domain Adapter
 │    ├─ semantik eksen tanımları
 │    ├─ invariant sözlüğü
 │    ├─ mutation family katalogları
 │    └─ repo/dil/framework extractor'ları
 │
 └─ H19 Experiment Core
      ├─ preregistration
      ├─ case freeze + hash
      ├─ naive-feature gate
      ├─ blind-reader workflow
      ├─ model/question version pin
      ├─ prospective gate engine
      ├─ evidence ledger
      └─ anti-pattern memory
```

Kepenk/Randevu'daki D0–D5 **domain adapter verisidir**, evrensel yasa değildir. Yeni repo için eksenler
yeniden adaylaştırılır, pilot veride ölçülür ve ancak sonra dondurulur.

## 7. Yeni araç için önerilen deney kaydı şeması

Her deney en az şu alanları taşımalıdır:

```json
{
  "experiment_id": "H19t",
  "parent": "H19d",
  "hypothesis": "...",
  "status": "completed|failed|incomparable|pending|locked",
  "protocol_commit": "...",
  "cases_sha256": "...",
  "model": "jev-1.13.0",
  "question_version": "...",
  "blind_check": {"n": 16, "agreement": 16, "drops": 0},
  "calls": 160,
  "primary_gates": [],
  "result": "...",
  "reusable_lessons": [],
  "anti_patterns": [],
  "next_gate": "H19u"
}
```

Amaç yalnız raporlama değildir. Gelecekte H19 aracı yeni deney tasarlarken bu ledger'ı okuyup:
- daha önce başarısız olmuş bir yöntemi tekrar önermemeli;
- hangi failure mode'un tekrarlandığını bilmeli;
- yeni hipotezi eski veriden ayırmalı;
- bir sonraki gate'i otomatik olarak açıklayabilmelidir.

## 8. İsimlendirme

Mevcut R0/a/b/b′/d/t/u isimleri provenance için korunur. Yeni araçta yeni deneyler için daha okunur kimlik önerisi:

- `AXIS-R0` — eksen algılama
- `ABL-01` — ablation
- `FACT-01` — fact conditioning
- `ROUTE-01` — router
- `THR-01` — threshold
- `RESOLVE-01` — semantic resolver
- `SHADOW-01` — gerçek akış shadow testi

Tarihsel H19 kimliği her kayıtta `legacy_id` olarak tutulabilir.

## 9. Açık araştırma kuyruğu

1. **H19u / RESOLVE-01:** D1_ONLY / D5_ONLY / BOTH / NEITHER ayrımı.
2. Geçerse **H19s / SHADOW-01:** gerçek PR prevalansı ve ekonomik yük.
3. H19u kalırsa yeni prompt/threshold aynı sette aranmaz. Ham V vektörü yalnız ranker/sinyal olarak ürünleştirme
   dışı araştırma çıktısı olarak kalır.
4. Genel araç ürünü, Kepenk D0–D5'i hard-code etmeden önce ikinci bir bağımsız repo/domain üzerinde domain-adapter
   kurulumu test etmelidir.
