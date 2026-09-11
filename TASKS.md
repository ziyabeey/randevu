# YZT Randevu — Görev takip tablosu

Başlangıç kaydı: 11 Eylül 2026. İlk kayıtta 46 görevin tümü **Planlandı** durumundaydı ve sahibi yoktu; güncel durum her görev satırında tutulur. Faz 1–8'in gerçek durumu [PROJECT_STATE.md](PROJECT_STATE.md) içindedir; eski Faz 9 [PR #8](https://github.com/ziyabeey1-ai/randevu/pull/8), F09-01 için taslak girdidir.

## Kullanım

Görev kimliğine tıklayarak kapsam, okuma başlangıcı, çıktı, kabul ve devir maddelerini aç. [CONTRIBUTING.md](CONTRIBUTING.md) sahiplenme ve PR düzenini tanımlar. Görevi alırken yalnız kendi satırında durum/sahip/UTC tarih/branch/kanıt alanlarını güncelle; başka açık PR'da aynı görevin üstlenilip üstlenilmediğini ayrıca kontrol et.

- `TEMEL`: güncel main'deki Faz 1–8 kodu ve kabul edilmiş ürün planıdır; erişim/ortam hazır olduğu varsayımı değildir.
- `Fxx-yy`: doğrudan görev önkoşulu. Varsayılan olarak kartın kabulü tamamlanmış olmalıdır.
- `Gxx`: o fazın bütün görevlerinin kabul kapısı. G17, tüm ürünün MVP/pilot kabulüdür.
- Durumlar: Planlandı → Üstlenildi → Çalışılıyor → İncelemede → Tamamlandı. Gerektiğinde Engelli veya Main'de / kabul açık kullanılır.
- İlk teknik adaylar: **F09-01, F12-01, F17-01, F17-02**. Uygulama yetkisi verildiğinde farklı dosya alanlarında ilerleyebilirler.
- Bir görev büyükse ana kabulü koruyarak `.a`, `.b` alt görevleri ekle; ana kimliği yeniden numaralandırma. Görev sayısı oturum/PR/süre garantisi değildir.

## İşler

| Kimlik | İş | Önkoşullar | Durum | Sahip / UTC güncelleme | Branch / PR / kanıt veya engel |
| --- | --- | --- | --- | --- | --- |
| [F09-01](docs/plan/phase-09.md#f09-01) | Taslak incelemesi ve kurtarma sözleşmesi | TEMEL | Tamamlandı | ChatGPT / 2026-09-11T17:52Z | `f09-01-recovery-contract` · [PR #11](https://github.com/ziyabeey1-ai/randevu/pull/11) · [Sözleşme](docs/plan/f09-01-recovery-contract.md) |
| [F09-02](docs/plan/phase-09.md#f09-02) | Rezervasyon sonucunu ve yönetim erişimini kurtarma | F09-01 | Tamamlandı | ChatGPT / 2026-09-11T21:58Z | `f09-02-booking-recovery` · [PR #12](https://github.com/ziyabeey1-ai/randevu/pull/12) · [Devir](docs/handoffs/F09-02.md) · CI `34651571690` |
| [F09-03](docs/plan/phase-09.md#f09-03) | Kalıcı gönderim ve güvenilir sağlayıcı kaydı | F09-02 | İncelemede | ChatGPT / 2026-09-11T22:22Z | `f09-03-durable-notifications` · [PR #13](https://github.com/ziyabeey1-ai/randevu/pull/13) · [Devir](docs/handoffs/F09-03.md) · CI `34653561431` |
| [F09-04](docs/plan/phase-09.md#f09-04) | Public rezervasyonda kötüye kullanım kontrolü | F09-02 | Planlandı | — | — |
| [F09-05](docs/plan/phase-09.md#f09-05) | Rezervasyon/bildirim entegrasyon kapısı | F09-03, F09-04, F17-01, F17-02 | Planlandı | — | — |
| [F10-01](docs/plan/phase-10.md#f10-01) | Ortak oturum ve parola akışları | F09-05 | Planlandı | — | — |
| [F10-02](docs/plan/phase-10.md#f10-02) | Davet, üyelik ve rol yönetimi | F10-01 | Planlandı | — | — |
| [F10-03](docs/plan/phase-10.md#f10-03) | İşletme geçişi ve kurulum akışı | F10-02 | Planlandı | — | — |
| [F10-04](docs/plan/phase-10.md#f10-04) | Hizmet, personel ve çalışma ayarları | F10-03 | Planlandı | — | — |
| [F10-05](docs/plan/phase-10.md#f10-05) | İşletmenin müşteri kayıtları | F10-03 | Planlandı | — | — |
| [F10-06](docs/plan/phase-10.md#f10-06) | Gerçek hesaplarla ortak yönetim kabulü | F10-04, F10-05, F17-01 | Planlandı | — | — |
| [F11-01](docs/plan/phase-11.md#f11-01) | Grup/satır sözleşmesi ve ileri migration | F10-02 | Planlandı | — | — |
| [F11-02](docs/plan/phase-11.md#f11-02) | Çok hizmetli müsaitlik ve atomik oluşturma | F11-01 | Planlandı | — | — |
| [F11-03](docs/plan/phase-11.md#f11-03) | Grup yönetimi ve mevcut ekranlarla uyum | F11-02 | Planlandı | — | — |
| [F11-04](docs/plan/phase-11.md#f11-04) | Çakışma, timezone ve yükseltme kabulü | F11-03, F17-02 | Planlandı | — | — |
| [F12-01](docs/plan/phase-12.md#f12-01) | Görsel yön ve akış sözleşmesi | TEMEL | Planlandı | — | — |
| [F12-02](docs/plan/phase-12.md#f12-02) | Salon profili ve public fotoğraflar | F12-01, F10-03 | Planlandı | — | — |
| [F12-03](docs/plan/phase-12.md#f12-03) | Hizmet kategorileri ve fiyat aralığı | F10-04, F11-01 | Planlandı | — | — |
| [F12-04](docs/plan/phase-12.md#f12-04) | Çoklu hizmet, personel ve saat seçimi | F12-02, F12-03, F11-02 | Planlandı | — | — |
| [F12-05](docs/plan/phase-12.md#f12-05) | Özet, sonuç ve müşteri yönetimi | F12-04, F09-02, F11-03 | Planlandı | — | — |
| [F13-01](docs/plan/phase-13.md#f13-01) | Takvim güncelliği ve istek yarışı | F11-03 | Planlandı | — | — |
| [F13-02](docs/plan/phase-13.md#f13-02) | Gün, hafta ve liste görünümleri | F13-01, F12-01 | Planlandı | — | — |
| [F13-03](docs/plan/phase-13.md#f13-03) | Randevu oluşturma, kapanış ve detay | F13-02, F11-03, F10-05 | Planlandı | — | — |
| [F13-04](docs/plan/phase-13.md#f13-04) | İşletme navigasyonu ve kullanım kabulü | F13-03, F10-06, F12-05 | Planlandı | — | — |
| [F14-01](docs/plan/phase-14.md#f14-01) | SalonApp mobil kabuğu | F13-04 | Planlandı | — | — |
| [F14-02](docs/plan/phase-14.md#f14-02) | Adisyon modeli ve hizmet satırları | F11-03, F10-02, F12-03 | Planlandı | — | — |
| [F14-03](docs/plan/phase-14.md#f14-03) | Manuel tahsilat ve düzeltme | F14-02, F12-03 | Planlandı | — | — |
| [F14-04](docs/plan/phase-14.md#f14-04) | Adisyon ve kasa işlem ekranları | F14-01, F14-03 | Planlandı | — | — |
| [F14-05](docs/plan/phase-14.md#f14-05) | Üç kol, mali bütünlük ve PWA kabulü | F14-04, F12-05 | Planlandı | — | — |
| [F15-01](docs/plan/phase-15.md#f15-01) | Ürün kataloğu ve stok hareketleri | F14-02 | Planlandı | — | — |
| [F15-02](docs/plan/phase-15.md#f15-02) | Ürün satışı, adisyon ve iade etkisi | F15-01, F14-03 | Planlandı | — | — |
| [F15-03](docs/plan/phase-15.md#f15-03) | Masraf ve düzeltme kayıtları | F14-03 | Planlandı | — | — |
| [F15-04](docs/plan/phase-15.md#f15-04) | Kasa, gün sonu ve temel raporlar | F15-02, F15-03, F14-05 | Planlandı | — | — |
| [F16-01](docs/plan/phase-16.md#f16-01) | Tekrarlayan randevu serisi · 16A | F11-04, F13-03 | Planlandı | — | — |
| [F16-02](docs/plan/phase-16.md#f16-02) | Hatırlatma, SMS ve yaşam döngüsü bildirimleri · 16A | F09-05, F16-01, F17-01 | Planlandı | — | — |
| [F16-03](docs/plan/phase-16.md#f16-03) | Özel hizmet/randevu fotoğrafları · 16B | F12-02, F13-03 | Planlandı | — | — |
| [F16-04](docs/plan/phase-16.md#f16-04) | Yorum, geri bildirim ve destek · 16B | F12-05, F16-03 | Planlandı | — | — |
| [F16-05](docs/plan/phase-16.md#f16-05) | Paket satışı ve kullanım bakiyesi · 16C | F15-02 | Planlandı | — | — |
| [F16-06](docs/plan/phase-16.md#f16-06) | Promosyon ve kampanya kodu · 16C | F12-03, F14-03 | Planlandı | — | — |
| [F16-07](docs/plan/phase-16.md#f16-07) | Prim ve çalışan raporu · 16D | F15-04, F16-05, F16-06 | Planlandı | — | — |
| [F16-08](docs/plan/phase-16.md#f16-08) | Hesap menüsü, dil ve eksik menülerin kapanışı · 16E | F10-06, F14-01, F12-01 | Planlandı | — | — |
| [F17-01](docs/plan/phase-17.md#f17-01) | Geliştirme ve staging ortamı | TEMEL | Planlandı | — | — |
| [F17-02](docs/plan/phase-17.md#f17-02) | Test çalıştırma ve bağımlılık bakım temeli | TEMEL | Planlandı | — | — |
| [F17-03](docs/plan/phase-17.md#f17-03) | İzleme, yedek ve yayın hazırlığı | F09-05, F14-03, F17-01, F17-02 | Planlandı | — | — |
| [F17-04](docs/plan/phase-17.md#f17-04) | MVP kabul matrisi ve referans doğrulaması | G09, G10, G11, G12, G13, G14, G15, G16, F17-03 | Planlandı | — | — |
| [F17-05](docs/plan/phase-17.md#f17-05) | Kontrollü pilot ve MVP teslimi | F17-04 | Planlandı | — | — |

## Faz kapıları

Bir kapı, ilgili fazdaki bütün görevler main'e alınmış ve kabul kanıtı tamamlanmış olduğunda kapanır. Planlandı veya Main'de / kabul açık görevle kapı kapatılmaz.

| Kapı | Kapsam | Durum / kanıt |
| --- | --- | --- |
| G09 | F09-01…F09-05 | Açık — kabul bekliyor |
| G10 | F10-01…F10-06 | Açık — kabul bekliyor |
| G11 | F11-01…F11-04 | Açık — kabul bekliyor |
| G12 | F12-01…F12-05 | Açık — kabul bekliyor |
| G13 | F13-01…F13-04 | Açık — kabul bekliyor |
| G14 | F14-01…F14-05 | Açık — kabul bekliyor |
| G15 | F15-01…F15-04 | Açık — kabul bekliyor |
| G16 | F16-01…F16-08 | Açık — kabul bekliyor |
| G17 | F17-01…F17-05 | Açık — kabul bekliyor |

Yeni PR başlangıcında bu tablonun main sürümü ile açık taslak PR'ları karşılaştır. Branch'te yazılan sahip/durum, merge olmadan main'e yansımaz; bu tablo atomik kilit değildir. Çift sahiplenmede CONTRIBUTING'deki dosya alanı ve entegrasyon kuralını uygula.
