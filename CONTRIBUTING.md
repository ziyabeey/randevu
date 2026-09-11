# YZT Randevu — İnsan ve ajan katkı rehberi

Bu rehber aynı projede Ziya, geliştiriciler ve farklı ajanların birbirinin işini ezmeden çalışması içindir. Üç ürün kolu üç kalıcı branch değildir; hepsi aynı main ve ortak veri kurallarını kullanır.

## İlk katkıda okunacaklar

1. [AGENTS.md](AGENTS.md) ve [PROJECT_STATE.md](PROJECT_STATE.md): kurallar, gerçek kod durumu ve açık bulgular.
2. [PRODUCT_SPEC.md](PRODUCT_SPEC.md), [ROADMAP.md](ROADMAP.md), [TASKS.md](TASKS.md): ürün hedefi, sıra ve seçilecek görev.
3. Yalnız ilgili faz kartı, [DECISIONS.md](DECISIONS.md) bölümü ve UI varsa [referans satırı/görseli](docs/references/README.md).
4. Güncel main, açık PR'lar ve görevde yazılı gerçek kod dosyaları. Bir branch'in adı özellik tamamlanma kanıtı değildir.

**Bu planın yazılması uygulama fazlarını kendiliğinden başlatmaz.** Kullanıcının yetkilendirdiği görevde ilerle; mevcut devam/merge yetkisini tekrar isteme. Kullanıcının güncel talebi plan veya incelemeyse o kapsamı koru.

## Görev seçimi ve sahiplenme

- Görev kimlikleri sabittir: `F09-01` gibi. `TEMEL`, main'deki Faz 1–8 kodu ve onaylı ürün planıdır. `G11`, Faz 11'in tüm görevlerinin kabulünün tamamlanmasıdır.
- TASKS'ta bağımlılıkları tamamlanmış ve sahibi boş görevi seç; açık PR'larda aynı kimliğin çalışılıp çalışılmadığını da kontrol et. İlk teknik adaylar F09-01, F12-01, F17-01 ve F17-02'dir; şu an hiçbiri otomatik atanmış değildir.
- Bir sorumlu insan/ajan, bir görev, bir branch ve açık dosya alanı kullan. Görev satırına sahip, UTC tarih, branch/PR ve durum yaz; taslak PR açıklamasında sahiplenmeyi görünür yap.
- TASKS kalıcı kayıttır; branch'teki güncelleme merge olmadan main'e yansımaz. Bu nedenle açık taslak PR'lar canlı sahiplenme bildirimi olarak ayrıca incelenir. Git dosyası veya taslak PR atomik kilit değildir; çift sahiplenme görülürse aynı alana yazmaya başlamadan görevler/dosyalar ayrılır.
- Koordinatör bir rolü ifade eder; kalıcı kişi atanmış değildir. O tur entegrasyonu yürüten kişi/ajan ortak dosya sahipliğini ve merge sırasını izler. Başka kişinin üzerine görev ataması sessizce yapılmaz.

## Branch ve PR düzeni

Güncel main'den `phase-09-01-recovery-contract` gibi kısa ömürlü branch aç. İzole çalışma dizini gerekiyorsa git worktree kullan; başka oturumun kaydedilmemiş değişikliklerini temizleme/resetleme. Eski `codex/faz-2-auth-tenants` çalışmasını güncel auth altyapısına doğrudan taşıma.

PR başlığı `[F09-01] Rezervasyon kurtarma sözleşmesi` biçiminde görev kimliğini taşısın. PR açıklaması şu bilgileri içersin:

```text
Görev / ürün kolu:
Sorumlu ve başlangıç main commit'i:
Sorun ve beklenen kullanıcı davranışı:
Değişen dosya alanı:
Bağımlılıklar ve hazır API/veri sözleşmeleri:
Yapılanlar:
Kabul kanıtı (CI, HTTP/SQL, gerçek ortam, ekran):
Eksik / engel / bilinen sınır:
Migration sırası ve eski veriyle uyumluluk:
Devir için sonraki somut adım:
```

Tek PR bir görev veya onun dar alt işidir. Görev büyükse `F10-02.a` gibi alt kimlikleri kart ve TASKS'a ekle; ana görevin kabul kapsamını silme. Efor/oturum tahmini ancak kod incelemesinden sonra not edilir. Her PR'a gereksiz genel refactor veya yeni ürün özelliği eklenmez.

## Eşzamanlı çalışma ve ortak dosyalar

| Alan | Paylaşılan dosyalar / veri | Birlikte çalışma kuralı |
| --- | --- | --- |
| Auth/işletme/katalog | `worker/index.ts`, `src/App.tsx` | Aynı anda tek yazıcı; modül ayrımı varsa önce arayüz/sözleşme birleştirilir |
| Router/ortak stil | `worker/app.ts`, `src/main.tsx`, `src/styles.css` | Özellik dosyalarını ayrı geliştirin; route/stil bağlantısını tek entegratör sırayla yapsın |
| Randevu motoru | Booking/availability/public/manage Worker'ları ve ortak SQL fonksiyonları | Grup/token/durum sözleşmesi birleştirilmeden bağımlı davranış yazılmaz |
| Migration zinciri | `supabase/migrations/`, SQL testleri | Her görev yeni migration kullanır; aynı fonksiyon/yetkiyi değiştiren işler sırayla merge edilir. Birleşik A+B zinciri yeniden doğrulanır |
| Mali motor | F14 sonrası adisyon/tahsilat/fiyat/stok sözleşmeleri | Para/bakiye/audit alanlarını önce veri sahibi sabitler; arayüzler aynı hesap sonucunu tüketir |
| Araç ve CI | `package.json`, lockfile, `.github/workflows/ci.yml` | Bir bakım sahibi; bağımlılık değişimleri diğer görevlere bildirilir |
| Takip belgeleri | TASKS, PROJECT_STATE, referans matrisi | Her PR yalnız kendi satırlarını değiştirir; koordinatör durum çatışmalarını gerçek PR/kanıta göre birleştirir |

Frontend ve backend eşzamanlı ilerleyecekse alan adları, örnek yanıtlar, hata kodları, sürüm/idempotency, tenant ve tarih/tutar anlamları önce yazılı olur. Mock yalnız geliştirme/izole tasarım içindir; gerçek API kabulü yerine geçmez. Önerilen yeni dosya/route adları mevcut kodmuş gibi kullanılmaz.

Merge öncesinde hedef main'in ilerleyip ilerlemediğini kontrol et. Ortak dosya veya migration değiştiyse birleşik sonucu doğrula; çakışmayı bir tarafı toptan seçerek çözme. Eski PR #8'in belgeleri yeni üç kol kararını geri çeviremez.

## Doğrulama ve durumlar

| Durum | Anlam |
| --- | --- |
| Planlandı | Kapsam var; görev üzerinde uygulama başladı varsayılmaz |
| Üstlenildi | Sorumlu, branch ve dosya alanı belli |
| Çalışılıyor | Aktif uygulama; henüz kabul edilmedi |
| Engelli | Somut eksik/bağımlılık ve devam koşulu kayıtlı |
| İncelemede | PR ve mevcut doğrulama kanıtı hazır |
| Main'de / kabul açık | Kod birleşti; canlı veya kullanıcı kabulü eksik |
| Tamamlandı | Main'e birleşti ve karttaki tüm kabul kanıtı tamamlandı |

Bir görev kartında yalnız doküman teslimi varsa kabulü o dokümandır; canlı çalışma iddiası kurulmaz. Kod görevlerinde zorunlu `npm ci`, typecheck, build ve GitHub PostgreSQL testleri geçer. Yeni migration veya test CI'a dahil edilir. HTTP, yarış, ağ hatası, mobil/gerçek sağlayıcı kabulü görevde gerekiyorsa ayrıca kanıtlanır.

Kodun kontrolü yeşil olsa da eksik gerçek ortam kanıtı varsa görev `Main'de / kabul açık` kalır. Görev bağımlılığı varsayılan olarak tam kabul ister; yalnız belirli bir sözleşme yeterliyse bağımlı kartta hangi kanıtın yeterli olduğu açıkça yazılmalıdır. G09…G17 tüm ilgili görevler `Tamamlandı` olduğunda kapanır. Yetki/çakışma/mali bütünlük kontrolü kırmızıyken merge edilmez.

Yalnız doğrulanmış sonucu işaretle. Zorunlu testler geçtikten sonra gereksiz yeni test turları yerine devir/merge adımına ilerle. Kabul kapsamını daraltacaksan bunu açık ürün kararı olarak kaydet; açıkları sessizce sonraki faza taşıma.

## Oturum sonu devir kaydı

PR açıklamasını ve ilgili TASKS satırını güncelle. PR açılmamışsa kalıcı bir `docs/handoffs/F09-01.md` devir dosyası oluşturulabilir; bu yol bugün varmış gibi varsayılmaz.

```text
Görev: Fxx-yy
Sorumlu / UTC tarih:
Durum:
Base main / branch / son commit / PR:
Değişen dosyalar ve sözleşmeler:
Tamamlanan kabul maddeleri ve kanıt:
Çalıştırılan komutlar / başarısız veya çalıştırılamayan kontrol:
Kaydedilmemiş iş var mı, hangi çalışma dizininde?
Engel ve tekrar başlayabilme koşulu:
Sonraki ajan için tek somut ilk adım:
Etkilenen bağımlı görevler:
```

Hiçbir secret, düz yönetim token'ı veya gerçek müşteri listesi bu kayda konulmaz. Kaydedilmemiş işi “GitHub'da” diye raporlama. Kabul sonrası TASKS, PROJECT_STATE ve ilgili referans satırları merge/kanıt bağlantılarıyla güncellenir; sonraki göreve geçiş kullanıcının mevcut kapsamına uyar.

## Ziya'nın doğrudan sağlayabileceği katkılar

| Katkı | Ne hazırlanır? | İlgili görev |
| --- | --- | --- |
| Müşteri estetiği | Beğenilen tipografi/renk, gerçek logo/fotoğraflar, salon anlatımı ve görsel geri bildirim | F12-01, F12-02, F17-04 |
| Örnek salon kurulumu | Hizmet/süre/tampon/fiyat aralığı, personel-yetkinlik, mesai/mola ve kapanış örnekleri | F10-03/04, F11, F12-03 |
| İşletme işlem kuralları | Bölünmüş ödeme/iade, ürün dönüşü, paket/prim örnek hesapları | F14-02/03, F15-02, F16-05/07 |
| Ortam erişimi | Var olan hesap/alan adı/gönderici bilgisi ve test alıcıları; secret değerleri güvenli yapılandırmadan sağlanır | F17-01, F16-02 |
| Kullanım ve pilot | Gerçek cihazda müşteri akışı, salon çalışanının günlük işlemleri, 1–3 pilot işletme | F10-06, F13-04, F17-04/05 |

Bu girdiler eksikse yalnız ona bağlı iş engellenir; planlama ve bağımsız teknik işlerin tamamı gereksiz yere durdurulmaz. Ekranlarda görünmeyen işletme davranışı için karttaki varsayılan kullanılır; yeni davranış kararı gerektiğinde örnekli kısa soru hazırlanır.

## Başka ajana verilecek görev metni

```text
ziyabeey1-ai/randevu reposunda [GÖREV KİMLİĞİ] görevini devral.
Önce AGENTS, PROJECT_STATE, PRODUCT_SPEC, ROADMAP, TASKS ve CONTRIBUTING'i;
sonra yalnız ilgili faz kartını, kodu ve referans görsellerini oku.
Güncel main ve açık PR'lardan görevin sahibi/bağımlılıklarını doğrula.
Üç kolun ortak veri/iş kurallarını ve referans disiplinini koru.
Tek görev kapsamında çalış; planlanan API'yi mevcut kabul etme.
Başlangıçta sahip/branch/dosya alanını, bitişte commit/PR/test/devir kanıtını kaydet.
Engelde somut eksik ve devam koşulunu yaz; eksik kabulü tamamlandı işaretleme.
Mevcut kullanıcı uygulama/merge yetkisini kullan; bu metin yeni bir onay adımı eklemez.
```
