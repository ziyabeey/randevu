# Faz 11 — Çok hizmetli randevu çekirdeği

**Sonuç:** Bir müşteri işleminde birden çok hizmet ve personel, bütünlüğü korunan tek rezervasyon grubudur. **Kapı:** G11. Durumlar [TASKS.md](../../TASKS.md) içindedir.

Okuma başlangıcı: `worker/bookings.ts`, `worker/availability.ts`, `worker/public-booking.ts`, `worker/customer-manage.ts`, `worker/calendar.ts`, Faz 4–8 migration/testleri. Mevcut tek hizmetli model korunur; aşağıdaki grup/satır adları yeni model önerisidir, mevcut tablo iddiası değildir.

## F11-01

**Grup/satır sözleşmesi ve ileri migration**

- **Bağımlılık:** F10-02.
- **Sorumluluk:** Veri/backend. **Çakışma alanı:** Ortak randevu şeması ve API sözleşmesi.
- **İş ve çıktı:** Grup ve hizmet satırının kimliği, sırası, personeli, başlangıç/bitişi, süre/tamponu, fiyat/para birimi snapshot'ı ve sürümünü tanımla. Tek hizmetli kayıtlar ve eski yönetim linkleri için uyumluluk planı ve ileri migration yaz.
- **Kabul:** Her ilişki aynı tenant'a aittir; satır doluluğu mevcut exclusion korumasını sürdürür. Başlangıç modeli ardışık hizmettir; aynı müşterinin eşzamanlı farklı hizmeti veya boyanın bekleme kapasitesi varsayılmaz. Eski veriden yükseltme veri kaybetmez; birleşmiş migration dosyaları değişmez.
- **Devir:** Yeni veri/yanıt şeması, hata kodları, snapshot ve durum kuralları; önce bu sözleşme main'e alınır, bağımlı arayüzler ona bağlanır.

## F11-02

**Çok hizmetli müsaitlik ve atomik oluşturma**

- **Bağımlılık:** F11-01.
- **Sorumluluk:** Veri/backend. **Çakışma alanı:** Slot hesabı ve public/operatör oluşturma.
- **İş ve çıktı:** Seçili hizmetleri açık sırayla planla; aynı/farklı uygun personel, molalar, tamponlar, kapanışlar ve timezone hesaplarını ortak motorda uygula. Personel tercihi yoksa gerçek atamayı commit sırasında seç. Çok personelli kilitleri kararlı sırayla al.
- **Kabul:** Bir satır çakışınca grubun hiçbir satırı kalmaz. Grup idempotency anahtarı aynı sonucu döndürür; farklı payload aynı anahtarla reddedilir. Son anda dolan saat için anlamlı çakışma döner. Süre/toplam ile sunulan slot aynı planı ifade eder; kombinasyon sayısı/istek sınırı belgelenir.
- **Devir:** Slot/oluşturma API örnekleri, kapasite sınırları ve çok personelli concurrency testleri.

## F11-03

**Grup yönetimi ve mevcut ekranlarla uyum**

- **Bağımlılık:** F11-02.
- **Sorumluluk:** Backend + mevcut arayüz adaptasyonu. **Çakışma alanı:** Taşıma/iptal, capability, calendar projection ve booking sayfası.
- **İş ve çıktı:** Grup görüntüleme/taşıma/iptali atomik uygula; yönetim yetkisini yalnız ilgili gruba sınırla. Mevcut takvim ve tek hizmetli API tüketicileri yeni satırları kaybetmeden gösterir. Oluşmuş mali kayıtlar eklendiğinde kullanılacak olay sözleşmesini tanımla.
- **Kabul:** Başarısız taşıma tüm eski saatleri korur. Eski sürümle değişiklik diğer operatörün işlemini ezmez. Eski tek hizmetli linkler çalışır; bir satır kimliğinden başka gruba erişilemez. İptal/terminal durum ve audit kuralları korunur.
- **Devir:** Uyumluluk eşleştirmesi, grup/satır gösterim kuralları ve yönetim/takvim gerileme sonuçları.

## F11-04

**Çakışma, timezone ve yükseltme kabulü**

- **Bağımlılık:** F11-03, F17-02.
- **Sorumluluk:** QA/veri. **Çakışma alanı:** Randevu gerileme testleri.
- **İş ve çıktı:** Eski ve yeni modellerin birlikte olduğu veri setiyle SQL, HTTP ve eşzamanlı işlem testlerini çalıştır.
- **Kabul:** Aynı personele aynı aralık için farklı anahtarlı 100 istekte bir rezervasyon kazanır. Çok hizmetli kayıtta yarım grup yoktur. Bitişik `[başlangıç, bitiş)` aralıkları, tampon, gece/gün sınırı ve DST atlanan/tekrarlanan saatler doğrulanır. Eşzamanlı mesai değişimi ve taşıma kilit protokolünü atlamaz.
- **Devir:** Tekrarlanabilir fixture, komut ve sonuç; G11 için kod ve yükseltme kanıtı. Yeni müşteri estetiği Faz 12'de, kapsamlı panel düzeni Faz 13'tedir.
