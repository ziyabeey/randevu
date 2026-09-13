# YZT Randevu — Görev takip tablosu

**Plan v3 · 12 Eylül 2026.** İncelenen main `3b73bf827346542cd36f5bc6ed32d4d8a0b30cea`. 46 mevcut kimlik ve 8 tarihsel tamamlanma korunur; S01…S08 teknik düzeltmeleriyle toplam **54 görev** vardır. Başlangıç durumu: 8 Tamamlandı, 45 Planlandı, 1 Engelli (F10-02 / mevcut PR #32). Bu sayılar ürün tamamlanma yüzdesi değildir.

## Kullanım ve bağımlılıklar

- [CONTRIBUTING](CONTRIBUTING.md) sahip/PR, [ajan çalışma düzeni](docs/plan/agent-workflow.md) görev başına beceri/kanıt/devir kuralıdır. Başlamadan güncel main ve açık PR'ı karşılaştır; bu dosya atomik kilit değildir.
- `TEMEL`: main'de mevcut temel. `Sxx` / `Fxx-yy`: kabulü tamamlanacak görev. `Gxx`: ilgili F fazının bütün görevleri. `GS`: S01…S08'in bütünü. K01…K03 [bağlayıcı sözleşme bölümleridir](docs/plan/architecture-contracts.md), görev veya bağımlılık düğümü değildir.
- GS bitmeden yeni özellik koduna başlanmaz. Tarihsel Tamamlandı kaydı korunur; yeni güvenlik bulgusu ilgili S görevinde kapanır. F12-01 tasarım çalışması teknik uygulama değildir ve ayrı ürün oturumunda ele alınabilir.
- İlk bağımsız teknik adaylar S01, S03, S04, S05, S06, S08; hepsi otomatik atanmış değildir. Ortak SQL/router/CI yazımları ayrı sahip ve merge sırasıyla yürür. S02 ve S07 kendi önkoşullarını bekler.
- Durumlar: Planlandı, Üstlenildi, Çalışılıyor, Engelli, İncelemede, Main'de / kabul açık, Tamamlandı. Tamamlandı = main + kart kabulü; sadece PR açılması değildir.
- Büyük görev somut incelemeden sonra ana kapsam korunarak `.a/.b` alt işlerine ayrılabilir; kart/bağımlılık/kanıt birlikte güncellenir. Oturum/PR/süre garantisi verilmez.

## Teknik düzeltmeler

| Kimlik | İş | Önkoşullar | Durum | Sahip / UTC güncelleme | Branch / PR / kanıt veya engel |
| --- | --- | --- | --- | --- | --- |
| [S01](docs/plan/stabilization.md#s01) | Recovery oturum sınırı | F10-01 | Tamamlandı | ChatGPT / 2026-09-12T16:06Z | `s01-recovery-session-boundary` · [PR #34](https://github.com/ziyabeey1-ai/randevu/pull/34) · [Devir](docs/handoffs/S01.md) · kırmızı CI `34691808686` · code CI `34703904598` · staging [`34704131649`](https://github.com/ziyabeey1-ai/randevu/actions/runs/34704131649) success: public mailbox recovery, PKCE, marker silme/onarım, refresh, ikinci sekme, invalid/replay, parola değişimi ve eski bearer sınırı |
| [S02](docs/plan/stabilization.md#s02) | Ortak auth ve cookie mutation koruması | S01 | Tamamlandı | Ana ajan / 2026-09-12T17:36Z | [PR #36](https://github.com/ziyabeey1-ai/randevu/pull/36) · main `1045abc` · [Devir](docs/handoffs/S02.md) · 265 test, bağımsız inceleme, [CI 34708432373](https://github.com/ziyabeey1-ai/randevu/actions/runs/34708432373) ve [gerçek staging 34708621675](https://github.com/ziyabeey1-ai/randevu/actions/runs/34708621675) aynı code head üzerinde başarılı |
| [S03](docs/plan/stabilization.md#s03) | Bildirim içeriği/sürüm/tekrar tutarlılığı | F09-03 | Tamamlandı | Ana ajan / 2026-09-13 | [PR #35](https://github.com/ziyabeey1-ai/randevu/pull/35) · main `aa5b6b2` · [devir](docs/handoffs/S03.md) · 272 test, bağımsız inceleme, [CI 34733476367](https://github.com/ziyabeey1-ai/randevu/actions/runs/34733476367) ve [staging deneme 2](https://github.com/ziyabeey1-ai/randevu/actions/runs/34733661007/attempts/2) başarılı; ilk zaman aşımı/deployment hazır olma S05 takibinde |
| [S04](docs/plan/stabilization.md#s04) | Güvenli tekrar ve yönetim kaynak sınırı | F09-04 | Tamamlandı | Ana ajan / 2026-09-13 | [PR #39](https://github.com/ziyabeey1-ai/randevu/pull/39) · main `a00b66a` · [devir](docs/handoffs/S04.md) · 277 HTTP, bağımsız son inceleme, [PG17 CI 34735531168](https://github.com/ziyabeey1-ai/randevu/actions/runs/34735531168) ve [gerçek staging 34737231931](https://github.com/ziyabeey1-ai/randevu/actions/runs/34737231931) aynı head üzerinde başarılı |
| [S05](docs/plan/stabilization.md#s05) | Staging secret ve dağıtım tutarlılığı | F17-01 | Planlandı | — | İnceleme bulgusu var; düzeltme/kanıt henüz yok |
| [S06](docs/plan/stabilization.md#s06) | CI maliyeti ve zorunlu merge kapısı | F17-02 | Planlandı | — | İnceleme bulgusu var; düzeltme/kanıt henüz yok |
| [S07](docs/plan/stabilization.md#s07) | Runtime bütçeleri ve operasyonel veri ömrü | S02, S03, S04 | Planlandı | — | İnceleme bulgusu var; düzeltme/kanıt henüz yok |
| [S08](docs/plan/stabilization.md#s08) | Yeni DB nesnelerinde erişim kapısı | F17-01, F17-02 | Planlandı | — | İnceleme bulgusu var; düzeltme/kanıt henüz yok |

## Korunan MVP işleri

| Kimlik | İş | Önkoşullar | Durum | Sahip / UTC güncelleme | Branch / PR / kanıt veya engel |
| --- | --- | --- | --- | --- | --- |
| [F09-01](docs/plan/phase-09.md#f09-01) | Taslak incelemesi ve kurtarma sözleşmesi | TEMEL | Tamamlandı | ChatGPT / 2026-09-11T17:52Z | `f09-01-recovery-contract` · [PR #11](https://github.com/ziyabeey1-ai/randevu/pull/11) · [Sözleşme](docs/plan/f09-01-recovery-contract.md) |
| [F09-02](docs/plan/phase-09.md#f09-02) | Rezervasyon sonucunu ve yönetim erişimini kurtarma | F09-01 | Tamamlandı | ChatGPT / 2026-09-11T21:58Z | `f09-02-booking-recovery` · [PR #12](https://github.com/ziyabeey1-ai/randevu/pull/12) · [Devir](docs/handoffs/F09-02.md) · CI `34651571690` |
| [F09-03](docs/plan/phase-09.md#f09-03) | Kalıcı gönderim ve güvenilir sağlayıcı kaydı | F09-02 | Tamamlandı | ChatGPT / 2026-09-11T22:25Z | `f09-03-durable-notifications` · [PR #13](https://github.com/ziyabeey1-ai/randevu/pull/13) · [Devir](docs/handoffs/F09-03.md) · CI `34653785166` · Yeni doğruluk kapsamı S03/S07 |
| [F09-04](docs/plan/phase-09.md#f09-04) | Public rezervasyonda kötüye kullanım kontrolü | F09-02 | Tamamlandı | ChatGPT / 2026-09-11T23:10Z | `f09-04-public-abuse-control` · [PR #14](https://github.com/ziyabeey1-ai/randevu/pull/14) · [Devir](docs/handoffs/F09-04.md) · CI `34656950693` · Yeni kaynak sınırı kapsamı S04 |
| [F09-05](docs/plan/phase-09.md#f09-05) | Rezervasyon/bildirim entegrasyon kapısı | F09-03, F09-04, F17-01, F17-02 | Tamamlandı | ChatGPT / 2026-09-12T07:47Z | `f09-05-staging-integration` · [PR #30](https://github.com/ziyabeey1-ai/randevu/pull/30) · [Devir](docs/handoffs/F09-05.md) · CI `34681255156` · staging `34681540142` success: kayıp cevap recovery, duplicate/conflict, capability, sahte receipt reddi ve Resend `delivered` |
| [F10-01](docs/plan/phase-10.md#f10-01) | Ortak oturum ve parola akışları | F09-05 | Tamamlandı | ChatGPT / 2026-09-12T08:56Z | `f10-01-auth-session-password` · [PR #31](https://github.com/ziyabeey1-ai/randevu/pull/31) · [Devir](docs/handoffs/F10-01.md) · CI `34684288886` · staging `34684481828` success: Origin/CSRF, refresh rotation, güncel üyelik, hosted signup/recovery ve parola rotation · Sonraki inceleme açıkları S01/S02 |
| [F10-02](docs/plan/phase-10.md#f10-02) | Davet, üyelik ve rol yönetimi | F10-01, GS | Engelli | Mevcut PR sahibi: ChatGPT / plan kontrolü 2026-09-12 | [PR #32](https://github.com/ziyabeey1-ai/randevu/pull/32) · `f10-02-invites-memberships-roles` · head `5099ea3`: yalnız devir; GS bekleniyor. Yeniden sahiplenme yok. |
| [F10-03](docs/plan/phase-10.md#f10-03) | İşletme geçişi ve kurulum akışı | F10-02 | Planlandı | — | — |
| [F10-04](docs/plan/phase-10.md#f10-04) | Hizmet, personel ve çalışma ayarları | F10-03 | Planlandı | — | — |
| [F10-05](docs/plan/phase-10.md#f10-05) | İşletmenin müşteri kayıtları | F10-03 | Planlandı | — | — |
| [F10-06](docs/plan/phase-10.md#f10-06) | Gerçek hesaplarla ortak yönetim kabulü | F10-04, F10-05, F17-01 | Planlandı | — | — |
| [F11-01](docs/plan/phase-11.md#f11-01) | Grup/satır sözleşmesi ve ileri migration | F10-02, F12-03 | Planlandı | — | — |
| [F11-02](docs/plan/phase-11.md#f11-02) | Çok hizmetli müsaitlik ve atomik oluşturma | F11-01 | Planlandı | — | — |
| [F11-03](docs/plan/phase-11.md#f11-03) | Grup yönetimi ve mevcut ekranlarla uyum | F11-02 | Planlandı | — | — |
| [F11-04](docs/plan/phase-11.md#f11-04) | Çakışma, timezone ve yükseltme kabulü | F11-03, F17-02 | Planlandı | — | — |
| [F12-01](docs/plan/phase-12.md#f12-01) | Görsel yön ve akış sözleşmesi | TEMEL | Planlandı | — | — |
| [F12-02](docs/plan/phase-12.md#f12-02) | Salon profili ve public fotoğraflar | F12-01, F10-03 | Planlandı | — | — |
| [F12-03](docs/plan/phase-12.md#f12-03) | Hizmet kategorileri ve fiyat aralığı | F10-04 | Planlandı | — | — |
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
| [F15-04](docs/plan/phase-15.md#f15-04) | Kasa, gün sonu ve temel raporlar | F15-02, F15-03, F14-03 | Planlandı | — | — |
| [F16-01](docs/plan/phase-16.md#f16-01) | Tekrarlayan randevu serisi · 16A | F11-04, F13-03 | Planlandı | — | — |
| [F16-02](docs/plan/phase-16.md#f16-02) | Hatırlatma, SMS ve yaşam döngüsü bildirimleri · 16A | F09-05, F11-03, F17-01 | Planlandı | — | — |
| [F16-03](docs/plan/phase-16.md#f16-03) | Özel hizmet/randevu fotoğrafları · 16B | F12-02, F13-03 | Planlandı | — | — |
| [F16-04](docs/plan/phase-16.md#f16-04) | Yorum, geri bildirim ve destek · 16B | F12-05 | Planlandı | — | — |
| [F16-05](docs/plan/phase-16.md#f16-05) | Paket satışı ve kullanım bakiyesi · 16C | F15-02 | Planlandı | — | — |
| [F16-06](docs/plan/phase-16.md#f16-06) | Promosyon ve kampanya kodu · 16C | F12-03, F14-03 | Planlandı | — | — |
| [F16-07](docs/plan/phase-16.md#f16-07) | Prim ve çalışan raporu · 16D | F15-04, F16-05, F16-06 | Planlandı | — | — |
| [F16-08](docs/plan/phase-16.md#f16-08) | Hesap menüsü, dil ve eksik menülerin kapanışı · 16E | F10-06, F14-01, F12-01 | Planlandı | — | — |
| [F17-01](docs/plan/phase-17.md#f17-01) | Geliştirme ve staging ortamı | TEMEL | Tamamlandı | ChatGPT / 2026-09-12T07:10Z | `f17-01-staging-environment` · [PR #16](https://github.com/ziyabeey1-ai/randevu/pull/16) · hosted uyumluluk [PR #17](https://github.com/ziyabeey1-ai/randevu/pull/17) + [PR #18](https://github.com/ziyabeey1-ai/randevu/pull/18) · canlı sınır [PR #19](https://github.com/ziyabeey1-ai/randevu/pull/19) + [PR #20](https://github.com/ziyabeey1-ai/randevu/pull/20) · contract daraltmaları [PR #21](https://github.com/ziyabeey1-ai/randevu/pull/21), [#22](https://github.com/ziyabeey1-ai/randevu/pull/22), [#23](https://github.com/ziyabeey1-ai/randevu/pull/23), [#25](https://github.com/ziyabeey1-ai/randevu/pull/25), [#26](https://github.com/ziyabeey1-ai/randevu/pull/26), [#27](https://github.com/ziyabeey1-ai/randevu/pull/27), [#28](https://github.com/ziyabeey1-ai/randevu/pull/28) · [Devir](docs/handoffs/F17-01.md) · staging run `34679959999` success: DB credential, migrations, Auth owners, fixture, Worker deploy, persistent management secret, health/login/session/business/catalog smoke · Kısmi deploy düzeltmesi S05 |
| [F17-02](docs/plan/phase-17.md#f17-02) | Test çalıştırma ve bağımlılık bakım temeli | TEMEL | Tamamlandı | ChatGPT / 2026-09-11T23:30Z | `f17-02-ci-test-dependency-baseline` · [PR #15](https://github.com/ziyabeey1-ai/randevu/pull/15) · [Devir](docs/handoffs/F17-02.md) · CI `34658041327` · CI/merge iyileştirmesi S06 |
| [F17-03](docs/plan/phase-17.md#f17-03) | İzleme, yedek ve yayın hazırlığı | GS, G14, G15, G16, F17-01, F17-02 | Planlandı | — | — |
| [F17-04](docs/plan/phase-17.md#f17-04) | MVP kabul matrisi ve referans doğrulaması | GS, G09, G10, G11, G12, G13, G14, G15, G16, F17-03 | Planlandı | — | — |
| [F17-05](docs/plan/phase-17.md#f17-05) | Kontrollü pilot ve MVP teslimi | F17-04 | Planlandı | — | — |

## Kabul kapıları

| Kapı | Kapsam | Durum / kanıt |
| --- | --- | --- |
| GS | S01…S08 | Açık — S01…S04 tamamlandı; S05…S08 bekleniyor |
| G09 | F09-01…F09-05 | Tarihsel kapalı — PR #30, staging `34681540142`; yeni bulgular GS içinde ayrıca açık |
| G10 | F10-01…F10-06 | Açık — F10-01 tarihsel tamam, GS ve kalan F10 görevleri bekleniyor |
| G11 | F11-01…F11-04 | Açık — fiyat veri desteği F12-03 önce gerekir |
| G12 | F12-01…F12-05 | Açık — F12-03 veri işi görsel işlerden önce yapılır |
| G13 | F13-01…F13-04 | Açık |
| G14 | F14-01…F14-05 | Açık |
| G15 | F15-01…F15-04 | Açık |
| G16 | F16-01…F16-08 | Açık — seri/bildirim ve mali etkileşim ortak kabulü dahil |
| G17 | F17-01…F17-05 | Açık — GS ve tüm ürün kabulü; M23 pilot kanıtı F17-05'te tamamlanır |

G09'un tarihsel kapanışı yeni açıkları yok saymaz. G17 için GS dahil tüm bağımlı kapılar ve MVP_ACCEPTANCE satırları geçer. Kanıt, sorumlu ve sonraki somut adım devir kaydında tutulur; başka ajanın kaydedilmemiş işi ezilmez. PR #8 kapalı/superseded'dır; mevcut F10-02 PR #32 ile ikinci sahiplenme yapılmaz.
