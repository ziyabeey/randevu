# Coding Agent Protocol

## Kaynak sırası

1. [TASKS.md](TASKS.md): **tek canlı görev/durum otoritesi**; sahiplik, bağımlılık, kabul kapıları, main kabulü ve açık engeller burada okunur.
2. [PRODUCT_SPEC.md](PRODUCT_SPEC.md) ve [ROADMAP.md](ROADMAP.md): ürün sınırı ile Faz 17'ye kadar planlanan sıra; canlı statü tutmaz.
3. [CONTRIBUTING.md](CONTRIBUTING.md), [ajan çalışma akışı](docs/plan/agent-workflow.md), [Context Pack protokolü](docs/plan/context-packs.md) ve [Shadow Validation Mode](docs/plan/shadow-validation-mode.md): çalışma, context, validation ve devir kuralları.
4. Yalnız görevin ilgili faz/kontrat belgesi, kodu ve testleri. Teknik karar gerekiyorsa [DECISIONS.md](DECISIONS.md); onaylı bir UI referansı varsa [referans matrisi](docs/references/README.md) okunur. Handoff/PR/CI kayıtları tarihsel kanıttır, canlı durum kaynağı değildir.

Kullanıcının açık ve güncel talebi önceliklidir. Planlanan durum, uygulanmış kod ve doğrulanmış sonuç ayrı raporlanır. Sohbet tek kalıcı talimat veya devir kaynağı olamaz.

Teknik düzeltmeler `S01…S08` ve kapı `GS`, [stabilizasyon planında](docs/plan/stabilization.md) tanımlıdır. Güncel tamamlanma ve açık PR sahipliği TASKS/PROJECT_STATE üzerinden kontrol edilir; tarihsel teslim yeni iş gibi sahiplenilmez. `K01…K03`, [mimari sözleşmelerdeki](docs/plan/architecture-contracts.md) tasarım bölümleridir, bağımlılık düğümü değildir. Plan değişikliği uygulama başlatmaz. Koordinatör mimari ve bağımsız incelemeyi yürütür; kullanıcının seçtiği varsayılan uygulayıcı **GPT-5.6 Sol**'dür. İnsan veya başka ajan katkısı açık dosya/görev sınırıyla aynı protokole uyar.

## Ürün ve mimari sınırları

- MVP'nin üç yüzeyi **müşteri paneli, randevu paneli ve SalonApp**'tir. Ortak backend ile işletme, müşteri, personel, randevu ve mali kayıtları paylaşırlar.
- Müşteri panelinde işlev eşdeğerliği korunarak özgün ve daha estetik bir deneyim kurulur. Randevu paneli ile SalonApp'te referansın bilgi, menü ve işlem sırası korunur. SalonApp alt menüsü **Randevular / Adisyonlar / Yeni / Müşteriler / Diğer** olarak kalır.
- Adisyon, manuel tahsilat ve sınırlı ürün/stok/kasa kapsam içindedir. Çevrimiçi ödeme, muhasebe, e-fatura, bordro, ERP, marketplace ve AI kapsam dışıdır. Yapılmamış iş, sahte veri veya etkisiz butonla tamamlanmış gösterilmez.
- Kullanıcı ekranları Türkçedir. `tenant`, RPC, faz ve benzeri uygulama ayrıntıları ürün metnine taşınmaz. Referanslardaki rakip kimliği ve örnek veri üretim varlığı yapılmaz.
- `Business` tenant köküdür. Client business ID veya seçim cookie'si yetki değildir. Yetki Supabase Auth, aktif `Membership` ve RLS ile doğrulanır; Worker'a service-role anahtarı eklenmez.
- Birleştirilmiş migration dosyaları değişmez. Yeni veri davranışı ileri migration ve anlamlı gerileme kanıtıyla eklenir. Cross-tenant FK/RLS sınırları korunur.
- Zaman, işletmenin IANA timezone'u ve gerçek `timestamptz` anlarıyla hesaplanır. Personel çakışmasının son güvencesi tamponları da kapsayan PostgreSQL exclusion constraint'idir.
- Oluşturma, taşıma, durum ve mali işlemler tekrar güvenlidir. Snapshot ve audit korunur; çok satırlı işlem yarım kayıt bırakmaz. Randevu durumu ile adisyon/tahsilat durumu ayrı tutulur.
- Takvim ve SalonApp aynı randevu durum/çakışma motorunu kullanır. Para tutarı sunucuda hesaplanır; kapanmış mali kayıt sessizce değiştirilmez veya silinmez.
- Public rezervasyon opt-in'dir. Anon kullanıcı yalnız dar yetkili RPC'leri kullanır. Yönetim bağlantısı `/m#<token>` ve POST body kullanır; düz token/link loga veya veritabanına yazılmaz.
- Bildirim hatası randevu sonucunu belirsizleştirmez. İstemcinin sağlayıcı gönderim beyanına güvenilmez.

## Görev ve inceleme protokolü

- Her uygulama işi TASKS'taki tek kimlik, tek sahibi, başlangıç `main` SHA'sı, kısa ömürlü branch, açık dosya sınırı, kontratlar, kapsam dışı maddeler ve kabul ölçütleriyle başlar. Koordinatör bunları yazılı hale getirir; uygulayıcı kapsamı kendiliğinden büyütmez.
- Görev uygulama öncesinde **S / M / L / XL** olarak boyutlandırılır. Boyut dosya sayısından önce değişen authority, contract ve risk alanına göre belirlenir. **XL görev tek implementer işi olarak açılamaz; önce S/M/L dilimlere bölünür.** Ayrıntılı kurallar [Context Pack protokolündedir](docs/plan/context-packs.md).
- M ve L işlerde koordinatör kısa bir **Context Pack** yazar; S işlerde mevcut görev paketi yeterliyse ayrı özet gerekmez. Context Pack authoritative kayıtların yerine geçmez, yalnız exact okuma/yazma alanını ve current state'i sıkıştırır.
- Bir görev çoklu oturuma/ajana devredildiğinde, base/head anlamlı değiştiğinde, acceptance değiştiğinde veya eski context'in geçerliliği belirsizleştiğinde **Context Refresh** yapılır. Yeni snapshot eski kanıtı silmez; current state'i canonical PR/TASKS/handoff'a yeniden bağlar.
- Uzun süren CI/remote validation sırasında uygulayıcı boşta beklemek yerine [Shadow Validation Mode](docs/plan/shadow-validation-mode.md) ile aynı task ve exact SHA üzerinde bounded read-only çalışma yapar. Shadow ikinci ajan/reviewer değildir; branch write, semantic commit, ready/merge ve scope expansion kapalıdır.
- TASKS ve açık PR'lar birlikte kontrol edilir. Açık devir veya sahip varken aynı kapsam tekrar sahiplenilmez. Ortak dosya ya da migration için yazım sırası, uygulamadan önce belirlenir.
- Bağımlılık alanlarında yalnız `TEMEL`, `Sxx`, `Fxx-yy`, `GS` ve `Gxx` sembolleri kullanılır. Bir görev `K01…K03` sözleşmesine uyabilir veya atıf verebilir; bu atıf görev bağımlılığı değildir.
- `GS`, S01…S08'in tümü kabul edilmeden yeni özellik uygulamasını engeller. F12-01 tasarım çalışması ayrı planlanabilir; bu istisna özellik kodunu başlatmaz.
- Uygulayıcı görev türüne uygun beceriyi okuyup kullanılan sabit beceri adını devirde kaydeder. Beceri bulunamıyorsa okunmuş sayılmaz; eksik kaydedilir ve koordinatör belgelenmiş güvenli eşdeğeri seçer. Ayrıntılı yönlendirme [ajan çalışma akışındadır](docs/plan/agent-workflow.md).
- Auth, para ve migration işleri uygulayıcı kanıtından sonra koordinatör tarafından bağımsız incelenir. İnceleme, uygulayıcının kendi yeşil test beyanıyla tamamlanmış sayılmaz.
- Kapsam veya ajan rolü çatışması ile gerçek erişim/izin sınırları korunur. Bu belgeler yeni kullanıcı onayı icat etmez; oturumda verilmiş yetki yeniden istenmez.
- Faz 1–8 yalnız kanıtlanmış hata veya onaylı yeni gereksinim için genişletilir. Eski branch ya da PR, güncel üç yüzeyli MVP kararını geri çeviremez.

## Doğrulama

Kod değişikliklerinde mevcut zorunlu kapı, S06 kapsamında ayrı bir kod değişikliğiyle incelenip değiştirilene kadar korunur:

```bash
npm ci
npm run typecheck
npm run build
```

GitHub CI içindeki tüm PostgreSQL migration/gerileme testleri de geçmelidir. Görevin riski auth, yetki, idempotency, concurrency, para, ağ hatası veya gerçek UI davranışıysa ilgili negatif/entegrasyon/tarayıcı kanıtı eklenir. Uygulamayı kopyalayan düşük değerli test yazılmaz. Aynı hipotez 2–3 kez başarısız olursa yeni varyasyon denemek yerine koordinatör incelemesi istenir. Somut yeni risk yoksa tüm test paketi tekrar tekrar çalıştırılmaz.

Yalnız doküman değişikliğinde bağlantılar, bağımlılıklar, durum tutarlılığı ve diff doğrulanır; repo politikası ayrıca gerektiriyorsa mevcut CI çalıştırılır. Test kapsamı dışındaki canlı kullanım hazır diye raporlanmaz.

## Devir

Her oturumun kalıcı devri görev kimliğini, base SHA'yı, branch'i, head commit/PR'ı, değişen dosyaları, korunan/değişen kontratları, okunan beceriyi, test kanıtını ve sonraki tek somut adımı içerir. Engel ve başarısız kontroller açık yazılır; secret, düz yönetim token'ı, parola veya gerçek müşteri verisi yazılmaz. Tam şablon [CONTRIBUTING.md](CONTRIBUTING.md#oturum-sonu-devri) içindedir. Büyük veya çok oturumlu işlerde sonraki ajanın giriş noktası ayrıca güncel [Context Pack](docs/plan/context-packs.md) snapshot'ı olmalıdır.
