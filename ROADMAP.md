# YZT Randevu — MVP yol haritası

Plan sürümü: 2 · 11 Eylül 2026. Başlangıç: `main` / `ec024a7015408e07a41199ecee14583cb34e1b72` ([üç kol kararı, PR #9](https://github.com/ziyabeey1-ai/randevu/pull/9)). Bu teslimat planlamadır; yeni uygulama fazı başlatılmış değildir.

## Başlangıç noktası

| İhtiyaç | Okunacak dosya |
| --- | --- |
| Ürün nasıl olmalı? | [PRODUCT_SPEC.md](PRODUCT_SPEC.md) |
| Main'de gerçekte ne var? | [PROJECT_STATE.md](PROJECT_STATE.md) |
| Hangi küçük işi alabilirim? | [TASKS.md](TASKS.md) |
| İnsan/ajan katkısı nasıl yürür? | [CONTRIBUTING.md](CONTRIBUTING.md) |
| MVP ne zaman bitmiş sayılır? | [MVP_ACCEPTANCE.md](MVP_ACCEPTANCE.md) |
| Hangi görsel/işlev korunmalı? | [11 referansın eşleştirmesi](docs/references/README.md) |

Bu yol haritası kapsam ve sırayı, faz dosyaları görev sözleşmelerini, TASKS görev durumunu tutar. Yeni katkıcı tüm geçmiş konuşmayı okumak zorunda değildir: mevcut durum → ürün kuralları → görev satırı → ilgili faz kartı → ilgili kod/görsel yeterlidir.

## MVP'nin kesin hedefi

| Kol | MVP'de çalışan sonuç | Tasarım sınırı |
| --- | --- | --- |
| Müşteri paneli | Salon profili, çoklu hizmet/personel, uygun saat, özet/kampanya, rezervasyon, güvenli taşıma/iptal, bildirim, yorum | İşlevler korunur; daha estetik ve özgün müşteri deneyimi |
| Randevu paneli | Gün/hafta/liste, ekip/müşteri/katalog, mesai/kapanış, çok hizmetli/tekrarlı randevu, detay ve mali/fotoğraf bağlantıları | Takvim ana yüzeydir; referansın alan ve işlem düzeni, küçük görsel farklar |
| SalonApp | Randevular / Adisyonlar / Yeni / Müşteriler / Diğer; adisyon, manuel tahsilat, ürün/stok, masraf/kasa, paket/prim ve hesap işlemleri | Referansa yakın mobil menü ve adisyon düzeni |

Üç kol aynı işletme, personel, müşteri, randevu ve mali kayıtları kullanır. İlk teslimat ortak web altyapısında responsive/PWA'dır. MVP kabulü **Faz 17 sonunda**, Faz 9–16 kapsamı ve gerçek pilot kanıtıyla yapılır. Faz 13 ve 14 yararlı ara teslimatlardır; MVP hedefi sessizce bu noktalara küçültülmez.

Çevrimiçi kart çekimi, otomatik abonelik tahsilatı, native mağaza dağıtımı, tam muhasebe/e-fatura/bordro/ERP, marketplace, AI ve gelişmiş şube hiyerarşisi bu planın dışında kalır. Manuel tahsilat, temel stok, paket/promosyon ve prim onaylı kapsamın içindedir. İşletmeler arasında yetkili geçiş bir şirket/şube üst veri modeli kurulmasını gerektirmez.

## Korunan Faz 1–8

| Faz | Mevcut temel | Uygulama durumu / kalan kapsam |
| --- | --- | --- |
| 1 | React/Vite + Worker/Hono | Main'de |
| 2 | Supabase Auth, Business/Membership, RLS | Main'de; hesap/ekip eksikleri Faz 10 |
| 3 | Hizmet, personel, yetkinlik eşleştirme | Main'de; düzenleme arayüzleri Faz 10 |
| 4 | Mesai, kapanış, timezone/müsaitlik | Main'de; çok hizmet uyarlaması Faz 11 |
| 5 | Müşteri/tek hizmetli randevu, idempotency, audit, çakışma engeli | Main'de; çoklu grup modeli Faz 11 |
| 6 | Public rezervasyon | Main'de; kurtarma Faz 9, yeni müşteri yüzeyi Faz 12 |
| 7 | Güvenli yönetim bağlantısı | Main'de; grup uyumu Faz 11 |
| 8 | Gün/hafta işletme takvimi | Main'de; liste/güncellik/referans düzeni Faz 13 |

Bu geçmiş tekrar yazılmaz; açık eksikler ilgili yeni göreve bağlanır. Faz 9'un [PR #8](https://github.com/ziyabeey1-ai/randevu/pull/8) çalışması taslak/kısmidir ve eski main'den ayrılmıştır. Yeni sözleşmeye göre F09-01'de incelenip tüketilir; planın yazılması PR #8'i birleştirmez.

## MVP'ye kadar tüm uygulama fazları

| Faz | İş paketleri | Çıktı ve fazın kapanışı |
| --- | --- | --- |
| [9 — Güvenilir rezervasyon/bildirim](docs/plan/phase-09.md) | F09-01…05 · 5 görev | Sonuç kurtarma, kalıcı gönderim, dar sağlayıcı yetkisi, public kötüye kullanım kontrolü; gerçek hata/teslim doğrulaması → G09 |
| [10 — Hesap ve işletme](docs/plan/phase-10.md) | F10-01…06 · 6 görev | Parola/oturum, davet/rol, işletme geçişi/onboarding, katalog/mesai, müşteri yönetimi; gerçek hesap kabulü → G10 |
| [11 — Çok hizmetli çekirdek](docs/plan/phase-11.md) | F11-01…04 · 4 görev | Grup/satır modeli, atomik slot/oluşturma/taşıma/iptal, eski kayıt uyumu ve concurrency → G11 |
| [12 — Müşteri paneli](docs/plan/phase-12.md) | F12-01…05 · 5 görev | Görsel yön, salon profili/fotoğraf, kategori/fiyat aralığı, seçim ve sonuç/yönetim akışı → G12 |
| [13 — Randevu paneli](docs/plan/phase-13.md) | F13-01…04 · 4 görev | Güncellik/yarış koruması, gün/hafta/liste, randevu editörü/detay ve ortak işletme kabuğu → G13 |
| [14 — SalonApp ve mali çekirdek](docs/plan/phase-14.md) | F14-01…05 · 5 görev | Mobil kabuk, adisyon, manuel/kısmi tahsilat, mali ekranlar ve üç kol/PWA kabulü → G14 |
| [15 — Ürün ve kasa](docs/plan/phase-15.md) | F15-01…04 · 4 görev | Ürün/stok, satış/iade, masraf, kasa/gün sonu ve mutabakat → G15 |
| [16 — Referans eşdeğerliği](docs/plan/phase-16.md) | F16-01…08 · 8 görev | Tekrar/SMS, fotoğraf/yorum/destek, paket/promosyon, prim, hesap/dil/plan menüsü → G16 |
| [17 — MVP ve pilot](docs/plan/phase-17.md) | F17-01…05 · 5 görev | Erken ortam/test hazırlığı; izleme/yedek/yayın; birleşik kabul ve 1–3 işletme pilotu → G17 |

**Toplam: 9 kalan faz, 46 görev paketi.** Bu sayı süre, PR veya oturum garantisi değildir. Her paket bir başlangıç çalışma sınırıdır; çok büyükse kimliği ve kabul kapsamı korunarak alt göreve bölünür. Tahmin ancak görevin gerçek kod incelemesinden sonra eklenir; eski %75–80 tahmini yeni kapsam için kullanılmaz.

## Sıra ve eşzamanlı çalışma

Faz numarası ürün teslim sırasını gösterir; tüm işleri katı bir tek sıra halinde bekletmez. **Görevin gerçek önkoşulu TASKS satırındaki bağımlılıktır.** G09…G17, o fazın tüm görevlerinin kanıtlı kabul kapısıdır; yalnız kodun merge edilmesi canlı kabulün yerine geçmez.

| Dalga | Başlanabilecek çalışma | Beklenen birleşik sonuç |
| --- | --- | --- |
| A — İlk hazırlık | F09-01 kurtarma sözleşmesi; F12-01 tasarım; F17-01 ortam; F17-02 test/bağımlılık temeli | Ortak beklentiler, test edilebilir ortam ve güvenilir rezervasyon temeli |
| B — Ortak veri/erişim | F09 tamamlanınca F10; rol temeliyle F11; kendi önkoşulları geçen F12 profil/katalog işleri | Çok kullanıcılı kurulum ve çok hizmetli API |
| C — İki ana yüzey | F12 müşteri ve F13 panel işleri, sözleşmeleri birleştikten sonra farklı dosyalarda eşzamanlı | G12 + G13; müşteri/panel kullanım denemesi |
| D — Salon işlemleri | F14 mali veri işi önkoşullarıyla erken; kabuk G13 işlerinden sonra. F15 ürün ve masraf ayrı alanlarda | G14 temel üç kol; ardından G15 satış/kasa |
| E — Eşdeğerlik | F16 alt işleri ilgili veri/arayüz/bildirim önkoşullarıyla; F17-03 işletim hazırlığı | G09–G16 tamam, yayın adayı |
| F — MVP | F17-04 tüm kabul; F17-05 pilot | G17, kanıtlı MVP teslimi |

Örnek: F14-01 mobil kabuk ile F14-02 adisyon verisi farklı sahiplerde ilerleyebilir; F14-04 ekran entegrasyonu ikisini bekler. F09-03 bildirim ile F09-04 public koruma ortak dosya/SQL fonksiyonu değiştirecekse önce yazım alanları ayrılır. Aynı dosyaya iki ajan atanması eşzamanlılık avantajı sayılmaz.

## İş devri ve kontrol

- Her katkı tek görev kimliğine, ürün koluna, açık dosya alanına ve kabul ölçütüne bağlanır. [Katkı rehberi](CONTRIBUTING.md) sahiplenme, branch/PR, çakışma ve devir düzenini tanımlar.
- İş/model sözleşmesi değişecekse bağımlı ajana yeni alan/hata/sürüm bildirimi yapılır; varsayımsal API üzerine işlev tamamlandı denmez.
- Kullanıcı arayüzleri Türkçedir; müşteri estetiği ve işletme düzeninin korunması hem ekran hem gerçek işlemle doğrulanır.
- Zorunlu kapı `npm ci`, `npm run typecheck`, `npm run build` ve tüm PostgreSQL migration/gerileme testleridir. HTTP/tarayıcı/gerçek sağlayıcı testleri görev kartındaki riske göre eklenir.
- Engelli işin eksiği, gereken kişi/erişim/karar ve tekrar başlayabilme koşulu kaydedilir. Bağımsız yetkilendirilmiş işe geçilebilir; eksik iş tamamlandı gösterilmez.
- Görev devrinde branch/commit/PR, yapılanlar, test kanıtı ve sıradaki somut adım bırakılır. Ziya veya başka bir ajan yalnız bu kayıtla devam edebilmelidir.
