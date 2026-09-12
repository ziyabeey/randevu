# YZT Randevu — Katkı rehberi

Bu rehber, insan ve ajan katkılarının aynı `main` üzerinde görev sınırlarını ve kanıtı koruyarak ilerlemesi içindir. Üç ürün yüzeyi üç kalıcı geliştirme branch'i değildir.

## Başlamadan önce

Sırayla [AGENTS.md](AGENTS.md), [PROJECT_STATE.md](PROJECT_STATE.md), [PRODUCT_SPEC.md](PRODUCT_SPEC.md), [ROADMAP.md](ROADMAP.md), [TASKS.md](TASKS.md) ve [ajan çalışma akışını](docs/plan/agent-workflow.md) oku. Ardından yalnız seçilen görevin faz/kontrat belgesini, kodunu, testlerini ve gerekiyorsa UI referansını aç.

Görev durumunun kaynağı TASKS, sahipliğin canlı ek kaynağı açık PR'lardır. Branch adı veya sohbet mesajı tek başına sahiplik ya da tamamlanma kanıtı değildir. Tarihsel kanıt ve aktif PR sahipliği PROJECT_STATE/TASKS'tan doğrulanır; aynı kapsam yeniden sahiplenilmez. `S01…S08` teknik onarımları [stabilizasyon planında](docs/plan/stabilization.md), görev olmayan `K01…K03` [mimari sözleşmelerde](docs/plan/architecture-contracts.md) tanımlıdır. Planlama PR'ı uygulamayı başlatmaz.

## Görev paketi ve roller

Koordinatör her görev için kimliği, bağımlılıkları, base SHA'yı, branch/dosya sahipliğini, korunacak veya üretilecek kontratları, kapsam dışını ve kabul ölçütünü yazar. Auth, para ve migration değişikliklerini teslim kanıtından sonra bağımsız inceler.

Uygulayıcı bu paketi doğrular, ilgili beceriyi okur, yalnız atanmış dosya alanında çalışır ve davranış kanıtı teslim eder. Kapsam veya dosya çakışmasını, eksik önkoşulu ve gerçek izin sınırını hemen kaydeder. Uygulayıcı planlanan API'yi mevcut saymaz, başka görevin kabulünü daraltmaz ve etkili olmayan UI ile işi bitmiş göstermez.

Görev paketi şunları taşımalıdır:

```text
Görev / ürün yüzeyi:
Bağımlılıklar ve mevcut durum:
Base main SHA / branch / sahip:
Yazılabilir dosyalar:
Korunacak veya üretilecek kontratlar:
Kapsam dışı:
Kabul ve gerekli kanıt:
Bağımsız inceleme gereği:
```

## Branch, PR ve ortak alanlar

Güncel `main` üzerinden görev kimliğini taşıyan kısa ömürlü branch aç. Başka oturumun kaydedilmemiş işini temizleme, resetleme veya üzerine yazma. Tek PR tek görev ya da önceden tanımlanmış dar alt iştir.

TASKS'ta yalnız kendi görev satırını sahip, UTC güncelleme, branch/PR ve kanıtla değiştir. Aynı kimlik açık PR'da varsa ikinci branch açma. Ortak router, oturum yardımcıları, ortak stiller, lockfile, CI ve migration zincirinde tek yazıcı veya açık bir merge sırası kullan. Frontend/backend ayrılacaksa alan adları, örnek yanıt, hata kodu, idempotency, tenant, zaman ve tutar anlamları önce kalıcı kontratta sabitlenir.

PR açıklaması şu bilgileri içerir:

```text
Görev / ürün yüzeyi:
Base main SHA / branch / head commit:
Sorun ve beklenen davranış:
Değişen dosyalar:
Korunan/değişen kontratlar:
Kapsam dışı:
Yapılanlar:
Kabul ve test kanıtı:
Eksik, engel veya bilinen sınır:
Migration/geriye uyumluluk notu:
Sonraki tek somut adım:
```

Ortak dosya ya da migration değiştiyse merge öncesi hedef `main` ile birleşik sonuç doğrulanır. Çakışma bir tarafın dosyasını toptan seçerek çözülmez. Başka görevde kullanılan kontrat değişirse bağımlı görev ve devir kaydı aynı PR'da güncellenir.

## Beceriler ve doğrulama

Göreve uygun beceri yönlendirmesi ve bulunamayan beceri davranışı [ajan çalışma akışında](docs/plan/agent-workflow.md#beceri-yönlendirmesi) tanımlıdır. Kullanılan sabit beceri adını devir kaydına yaz. Beceri talimatını okumak görev kapsamını, kullanıcı yetkisini veya kabul ölçütünü değiştirmez.

Kod katkıları için AGENTS'taki mevcut CI kapısı korunur; olası maliyet/merge kapısı iyileştirmesi S06'nın uygulama kapsamıdır. Buna ek olarak testleri değişikliğin riskine göre seç: yetki sınırı için negatif tenant/rol testi; para için invariant ve tekrar güvenliği; migration için temiz kurulum, upgrade ve gerileme; UI için gereken gerçek tarayıcı davranışı. Mock ve snapshot tek başına gerçek API veya UI kabulü değildir.

Aynı hipotezle 2–3 başarısız denemeden sonra durumu ve kanıtı koordinatöre ver. Somut yeni risk veya değişiklik olmadan tam paketi tekrar çalıştırma. Doküman katkısında link, bağımlılık, durum ve diff kontrolü yeterlidir; repo kuralı ayrıca CI istiyorsa onu da çalıştır.

## Durumlar

| Durum | Anlam |
| --- | --- |
| Planlandı | Kapsam kayıtlı; uygulama başlamadı. |
| Üstlenildi | Sahip, branch ve dosya alanı belli. |
| Çalışılıyor | Uygulama sürüyor; kabul edilmedi. |
| Engelli | Somut eksik ve devam koşulu kayıtlı. |
| İncelemede | PR ve mevcut kanıt bağımsız incelemeye hazır. |
| Main'de / kabul açık | Kod birleşti; kartın bir kabul kanıtı eksik. |
| Tamamlandı | Main'e birleşti ve kartın tüm kabul kanıtı tamamlandı. |

Bağımlılık hücreleri yalnız `TEMEL`, `Sxx`, `Fxx-yy`, `GS` ve `Gxx` kullanır; `K01…K03` sözleşmelerine metin içinde atıf verilir. Bir görev bağımlılığı varsayılan olarak `Tamamlandı` ister. Daha dar bir kontrat yeterliyse bağımlı görev hangi sürüm ve kanıtın yeterli olduğunu açıkça söyler. `GS`, S01…S08'in tümünün kabulünü ister ve yeni özellik uygulamasından önce kapanır. F12-01 tasarım çalışması ayrıca planlanabilir. Kod merge'i tek başına faz kapısını kapatmaz.

## Oturum sonu devri

PR açıklamasını ve TASKS'taki kendi satırını güncelle. PR yoksa ve çalışma sonraki oturuma bırakılacaksa `docs/handoffs/<görev>.md` içinde aynı kayıt tutulur. Devri yalnız sohbette bırakma.

```text
Görev / sorumlu / UTC tarih:
Durum:
Base main SHA:
Branch / head commit / PR:
Değişen dosyalar:
Korunan/değişen kontratlar:
Okunan beceri (sabit ad) veya bulunamama kaydı:
Tamamlanan kabul ve test kanıtı:
Başarısız ya da çalıştırılmayan kontrol:
Kaydedilmemiş iş ve çalışma dizini:
Engel ve devam koşulu:
Sonraki tek somut adım:
Etkilenen bağımlı görevler:
```

Secret, düz yönetim token'ı, parola ve gerçek müşteri verisi devre yazılmaz. Kaydedilmemiş çalışma “GitHub'da” diye raporlanmaz. Mevcut kullanıcı uygulama veya merge yetkisi bu rehber yüzünden yeniden istenmez; gerçek erişim veya onay sınırı varsa adı ve devam koşulu yazılır.
