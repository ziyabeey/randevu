# Plan v3 — Revizyon devri

- **Görev:** 12 Eylül 2026 ürün sahibi talebiyle MVP planını mimari incelemeye göre revize etmek.
- **Kapsam:** Dokümanlar; mevcut üç kollu MVP Faz 17'ye kadar korunur. Uygulama, migration, workflow, secret, deployment ve bağımsız gelecek planı PDF'si değişmez.
- **Sorumlu:** Ana ajan mimari/entegrasyon/inceleme; GPT-5.6 Sol katkı/ajan protokolü ve bağımsız plan incelemesi.
- **Başlangıç main:** `3b73bf827346542cd36f5bc6ed32d4d8a0b30cea`.
- **Teslim branch:** `codex/plan-revision-v3`; son commit ve PR, GitHub'da bu dosyanın bağlı olduğu revizyon üzerinden doğrulanır. Branch veya PR adı tek başına kabul kanıtı değildir.

## Revizyon

1. F09–F17'deki 46 kimlik ve 8 tarihsel kabul korunur; S01…S08 teknik düzeltmeleriyle 54 görev oluşur. GS yeni özellik kodunun önkoşuludur.
2. K01 eski appointment/grup/capability/recovery/audit/outbox geçişini, K02 fiyat/mali kaynakları, K03 bütçe/retention sınırlarını tanımlar. Bunlar plan sözleşmesidir, uygulanmış özellik değildir.
3. F12-03 fiyat veri desteği F11-01'den önceye alınır. Bildirim→seri, yorum→fotoğraf ve rapor→PWA gereksiz beklemeleri kaldırılır; birleşik etkileşim kabulü korunur.
4. F17-03 bütün son veri türleriyle restore/yayın kabulü olur; erken kaynak/erişim kontrolleri S07/S08'dedir. F17-04 M23 hariç release kabulü, F17-05 M23 pilotudur.
5. Görev başına beceri okuma, dosya sınırı, davranış kanıtı, bağımsız inceleme ve kalıcı devir protokolü yazılır. Sırf beceri adı listelendi diye kullanıldı sayılmaz.
6. README, mevcut durum ve referans matrisi eski PR #8/ilk aday ifadelerinden arındırılır. Açık PR #32 F10-02 mevcut sahibiyle GS bekler; o PR'a kod/devir müdahalesi yapılmaz.

## Doğrulama

- 54 tekil görev; 8 tarihsel Tamamlandı, 45 Planlandı, 1 Engelli. Tamamlanan kimlik kümesi eski main ile aynı.
- Görev önkoşulları ile faz/S kartları eşit; kapıları açan DFS kontrolünde döngü ve eksik düğüm yok.
- Tamamlanmamış bütün özellik kod görevleri GS'ye transitif bağlı; F12-01 yalnız tasarım istisnası.
- F12-03 → F11-01 sırası ve F17-04'ün F17-05'e bağımlı olmaması ayrıca kontrol edildi.
- M01…M31 tekil ve sıralı; M23 pilotta kapanır. Hiçbir senaryo sırf plan yazıldığı için Geçti yapılmadı.
- Yerel Markdown dosya/ilgili görev anchor bağlantıları, referans görsel yolları ve `git diff --check` doğrulanır. Remote diff yalnız Markdown olmalıdır; mevcut görsel ve kod blob'ları korunur.
- Sol bağımsız plan incelemesi ve ana ajan düzeltme/entegrasyonu yapıldı: kesin gönderilmemiş eski confirmation’ın yerine güncel iş üretme ile açık mali izin kaydının F10-02 sahipliği ayrıca netleştirildi. Mevcut GitHub CI sonucu plan PR'ının test kanıtına eklenir; yerel build/SQL veya canlı sağlayıcı testi bu doküman işi için yeniden çalıştırılmış sayılmaz.

## Kullanılan beceriler ve sınır

Supabase ve PostgreSQL Best Practices, güvenlik/veri sözleşmesini değerlendirmek için okundu; bunlar yeni canlı DB işlemi başlatmadı. Ajan protokolü gelecekteki görevlerin beceri seçimini tarif eder. Product Design veya PDF uygulaması bu revizyonda yapılmadı.

## Sonraki tek somut adım

Kullanıcının sonraki uygulama kapsamı içinde **S01 mevcut recovery oturumunda geçersiz confirmation ve marker expiry için davranış regresyonunu oluşturmak**. Önce güncel TASKS/main/açık PR kontrol edilir, S01 sahibi ve dar dosya alanı kaydedilir. Gerçek staging kabulünden önce S05'in dağıtım durumuyla koordinasyon yapılır. F10-02'yi veya başka özelliği otomatik başlatma.

S kartlarının bütün açık bulguları devam eder; bu teslimat onları kodda düzeltmez. Ürün politikası örnekleri (paket/prim/promosyon) ilgili gelecekteki görevde Ziya ile netleşir. Gelecek planı PDF'si ayrı ve değişmeden kalır.
