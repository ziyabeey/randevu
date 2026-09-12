# YZT Randevu — MVP yol haritası

**Plan v3 · 12 Eylül 2026.** İncelenen başlangıç: `main@3b73bf827346542cd36f5bc6ed32d4d8a0b30cea`. V2'nin üç kol kapsamı ve F09–F17 görev kimlikleri korunur. Bu revizyon **doküman teslimidir**; yeni kod, migration, deployment veya MVP sonrası PDF değişikliği yapmaz.

## Başlangıç ve kaynaklar

| Soru | Kaynak |
| --- | --- |
| Ürün ve referans sınırı nedir? | [PRODUCT_SPEC](PRODUCT_SPEC.md), [11 referans](docs/references/README.md) |
| Main'de ne var, hangi bulgu açık? | [PROJECT_STATE](PROJECT_STATE.md) |
| Hangi işi kim devralabilir? | [TASKS](TASKS.md), açık PR'lar, [CONTRIBUTING](CONTRIBUTING.md) |
| Ortak mimari neye göre uygulanacak? | [K01/K02/K03 sözleşmeleri](docs/plan/architecture-contracts.md), [DECISIONS](DECISIONS.md) |
| Önce hangi düzeltmeler gerekir? | [S01–S08 / GS](docs/plan/stabilization.md) |
| Sol hangi beceri ve kanıtla çalışacak? | [Ajan çalışma düzeni](docs/plan/agent-workflow.md) |
| MVP ne zaman kabul edilir? | [MVP_ACCEPTANCE](MVP_ACCEPTANCE.md), F17-04/05 |

TASKS durum/sahip kaynağı, faz kartları iş/kabul sözleşmesidir. ROADMAP sıra ve kapsamı tutar. Devir notu görev/branch/commit/kanıt/ilk adımı taşır; konuşma geçmişi tek bilgi kaynağı olamaz.

## Korunan MVP hedefi

| Kol | Çalışan sonuç | Tasarım sınırı |
| --- | --- | --- |
| Müşteri paneli | Salon profili, çoklu hizmet/personel, uygun saat, özet/kampanya, rezervasyon, güvenli taşıma/iptal, bildirim, yorum | Daha estetik ve özgün müşteri deneyimi; işlev eşdeğerliği |
| Randevu paneli | Gün/hafta/liste, ekip/müşteri/katalog, mesai/kapanış, çok hizmetli/tekrarlı randevu, detay ve mali/fotoğraf bağlantıları | Takvim ana yüzey; referansın alan ve işlem düzeni |
| SalonApp | Randevular / Adisyonlar / Yeni / Müşteriler / Diğer; adisyon, manuel tahsilat, ürün/stok, masraf/kasa, paket/prim, hesap | Referansa yakın mobil menü ve adisyon akışı |

Tek repo/backend ve ortak veriler korunur. İlk mobil teslim responsive/PWA'dır. **MVP Faz 17 sonunda**, Faz 9–16'nın onaylı işlevleri ve gerçek pilotla kabul edilir. Faz 13/14 ara teslimattır. Ürün kapsamı sessizce küçültülmez.

Çevrimiçi kart çekimi, otomatik abonelik tahsilatı, native mağaza dağıtımı, tam muhasebe/e-fatura/bordro/ERP, marketplace, AI ve gelişmiş şube hiyerarşisi kapsam dışındadır. Manuel tahsilat, temel stok, paket/promosyon ve prim kapsam içindedir. MVP sonrası gelecek planı PDF'si ayrı kalır; bu revizyona bağlanmaz ve repoya konulmaz. Yeni kullanıcı dostu özellik fikirleri/görsel kararlar ayrı çalışmada ele alınır; mevcut kabul ölçütleri korunur.

## Mevcut durum ve revizyonun nedeni

Faz 1–8'in React/Worker, Auth/tenant, katalog, müsaitlik, tek hizmetli booking, public/manage ve takvim temeli main'dedir. F09-01…05, F10-01, F17-01 ve F17-02'nin **sekiz tarihsel teslimi** kanıtlarıyla korunur. Yeni inceleme bu testlerin kapsamadığı recovery, ortak guard, bildirim, quota ve kısmi dağıtım senaryolarını açtı; geçmişteki yeşil kontrol yeni bulgunun kapandığı anlamına gelmez.

[PR #32](https://github.com/ziyabeey1-ai/randevu/pull/32) F10-02 için açık taslaktır; incelenen head `5099ea307ac806e958a7a29a674462558570b0d5` yalnız devir dosyası içerir. Görev sahibi korunur, GS tamamlanmadan yeni üyelik uygulaması ilerletilmez. PR #8 kapalı ve superseded'dır; synchronous e-posta/anon receipt yaklaşımı geri alınmaz. Eski yerel Faz 2 ve eski branch'ler main yerine kullanılmaz.

## Yeni önkoşul: GS

| Görev | Amaç | Beklenen kanıt |
| --- | --- | --- |
| S01 | Recovery oturumunun hata/expiry/refresh sonrası sınırını koruma | Negatif session testleri + gerçek public e-posta/PKCE yolculuğu |
| S02 | Ortak auth/HTTP ve cookie mutation guard kapsamı | Route matrisi; 401/403/503, CSRF ve üyelik testleri |
| S03 | Değişmeyen bildirim içeriği ve sürüm/iptal tutarlılığı | Kayıp cevap, değişen randevu, lease ve provider retry testleri |
| S04 | Safe retry/manage/RPC kaynak sınırı | Meşru recovery korunurken kota ve atlama testleri |
| S05 | Dağıtımda secret sürekliliği ve güvenli rotasyon | Kısmi hata/eşzamanlı run/geri dönüş staging kanıtı |
| S06 | CI tekrar maliyeti ve zorunlu merge kapısı | Docs/code ayrımı, negatif test, required-check/protection kanıtı |
| S07 | Timeout, sınırlı sorgu/bakım ve PII ömrü | Replay'i bozmayan temizlik, örnek yük ölçümü |
| S08 | Yeni DB nesneleri için grant/RLS kapısı | Table/sequence/function/view negatif ve pozitif erişim testleri |

GS bu sekiz düzeltmenin kabulüdür; yeni bir ürün fazı veya mevcut G09 geçmişinin yeniden numaralandırılması değildir. [Kartlar](docs/plan/stabilization.md) bulgu, gerçek dosya alanı, sınır ve devir kanıtını içerir. Yeni özellik kodu GS'yi bekler; teknik düzeltme ve plan/tasarım çalışması bu kapıyı tamamlamak için yürür.

## Fazlar ve doğru sıra

| Faz | Görevler | Çıktı / kapanış |
| --- | --- | --- |
| [9 — Güvenilir rezervasyon/bildirim](docs/plan/phase-09.md) | F09-01…05 | Tarihsel G09 kabulü tamam; yeni açıklar S03/S04/S07'de |
| [10 — Hesap ve işletme](docs/plan/phase-10.md) | F10-01…06 | F10-01 tarihsel tamam; GS sonrası mevcut F10-02 → kurulum/katalog/müşteri → G10 |
| [12 — Fiyat veri desteği](docs/plan/phase-12.md#f12-03) | F12-03 | F10-04 sonrası sabit/aralık fiyat ve kategori; **F11-01'den önce**, görsel tasarım beklemez |
| [11 — Çok hizmetli çekirdek](docs/plan/phase-11.md) | F11-01…04 | K01/K02'ye göre grup/satır, eski kayıt uyumu, atomik işlemler ve concurrency → G11 |
| [12 — Müşteri yüzeyi](docs/plan/phase-12.md) | F12-01/02/04/05 | Ayrı görsel karar, salon profili, gerçek çoklu booking ve yönetim → G12 |
| [13 — Randevu paneli](docs/plan/phase-13.md) | F13-01…04 | Güncellik, gün/hafta/liste, editör/detay ve ortak işletme kabuğu → G13 |
| [14 — SalonApp ve mali çekirdek](docs/plan/phase-14.md) | F14-01…05 | Mobil kabuk, adisyon, manuel/kısmi tahsilat ve PWA kabulü → G14 |
| [15 — Ürün ve kasa](docs/plan/phase-15.md) | F15-01…04 | Ürün/stok, satış/iade, masraf ve mutabakat → G15 |
| [16 — Referans eşdeğerliği](docs/plan/phase-16.md) | F16-01…08 | Tekrar, bildirim/SMS, fotoğraf/yorum/destek, paket/promosyon/prim ve hesap/dil → G16 |
| [17 — Yayın adayı ve pilot](docs/plan/phase-17.md) | F17-01…05 | Ortam/CI temeli tarihsel tamam; tüm veri türleriyle restore/yayın, birleşik kabul ve pilot → G17 |

**54 görev paketi = korunan 46 görev + 8 teknik düzeltme.** Revizyon başlangıcında 8'i tarihsel tamam, 45'i planlandı, F10-02 önkoşul nedeniyle engelli. Bu sayı ürün yüzdesi, süre, oturum veya PR taahhüdü değildir. K01/K02/K03 bu revizyonda yazılan sözleşmelerdir; ilave kod görevi sayılmaz.

## Dalga ve paralellik

1. **Teknik temel:** S01/S03/S04/S05/S06/S08 uygun dosya sahipliğiyle başlayabilir; S02 S01'i, S07 S02/S03/S04'ü bekler. S05'in güvenli staging düzeni canlı kabul çalıştırmalarında önce tercih edilir. Tüm işleri tek oturuma sığdırma şartı yoktur.
2. **Erişim ve veri:** GS → F10-02/03 → F10-04 + F10-05. F12-03 fiyat veri desteği → F11-01; K01 uyum ve K02 para anlamları önceden bellidir. F10-06 ortak hesap kabulünü tamamlar.
3. **İki ana yüzey:** F11 sonrası F12/F13 kendi önkoşullarıyla farklı dosyalarda ilerler. Görsel F12-01 kullanıcıyla ayrı çalışmadır; teknik plan teslimi bunu tamamlandı göstermez.
4. **Salon işlemleri:** F14-02 mali veri ve F14-01 kabuk uygun önkoşullarla ayrılabilir; F14-04 ikisini birleştirir. F15 rapor hesapları PWA kabulünü beklemez; birleşik ürün kabulü daha sonra yapılır.
5. **Eşdeğerlik:** F16-02 bildirimleri seri özelliğini beklemeden normal grup olayları üzerinden yapılabilir. F16-01 aynı olayları üretir; G16 birleşik seri/bildirim kabulünü içerir. F16-04 yorum işi özel fotoğraf işini beklemez. Paket/promosyon/prim aynı mali kaynak sözleşmesini kullanır.
6. **Yayın ve pilot:** S07/S08 erken işletim temelini sağlar. F17-03, G14/G15/G16 sonrası bütün nihai veri türleriyle restore/retention/yayın doğrulamasını yapar. F17-04 teknik kabul, F17-05 gerçek pilot; M23 pilot senaryosu F17-05'te kapanır.

Bu sıralama görev tablosundaki bağımlılıkların özetidir. Aynı router/SQL fonksiyonu/CI dosyasına iki yazıcı verilmez; bağımsız işlerin entegrasyon sırası belirlenir. Kontrat çelişkisi bulunursa Sol kanıtla koordinatöre döner; kendi başına iş kapsamını büyütmez.

## Bitti sayılma kuralı

Görev sonucu, davranış kanıtı ve main'e birleşme birlikte değerlendirilir. Mevcut zorunlu CI S06 kabul edilene kadar korunur; doküman revizyonu CI kodunu değiştirmez. Güvenlik, mali bütünlük ve migration değişiklikleri bağımsız inceleme ister. Geçici test/sağlayıcı hatasını çözmeden yeni benzer denemelerle oturum tüketilmez; 2–3 başarısız yaklaşımda varsayım ve kanıt yeniden incelenir.

Her oturum görev/base SHA/branch/son commit/PR, okunan beceriler, yapılanlar, açık kabul ve **tek somut sonraki adım** ile biter. Tamamlanmış davranış somut gerileme riski olmadan tekrar tekrar test edilmez. MVP kabulünde birleşik sürümün açık güvenlik/veri/para kusuru kalamaz; doğrulanan kapsam ve bilinen sınır raporlanır.
