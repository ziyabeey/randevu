# H19b′ ikinci okuyucu anahtarı

| No | Vaka | Hücre | D5 etiketi | Eksen | Eş | Gerekçe |
|---|---|---|---|---|---|---|
| 1 | BP04 | B′ | strengthens | D5 | DP04 | Süre dolumu dalına etkin kiralama koruması eklendi; bakım, gönderim yapan bir işçinin işini artık altından sonlandırmaz. |
| 2 | BP12 | B′ | weakens | D5 | DP12 | Tek ifadelik upsert "güncelle, bulamazsan ekle"ye bölündü; profil satırı otomatik oluşturulmadığı için ilk kaydı yapan eşzamanlı iki istekten ikincisi benzersizlik hatası alır. |
| 3 | AP12 | A′ | weakens | D5 | CP12 | Davet satırı kilitleniyor ama yeniden okunmuyor; iptal/kabul/süre kontrolleri kilit öncesi anlık görüntüde çalışıyor. Aynı işletme kilidini alan eşzamanlı bir iptal gözden kaçar. |
| 4 | CP12 | C′ | no_effect | D0 | AP12 | Davet e-postasının tam eşleşmesi yerine yalnız alan adı eşleşmesi aranıyor ve yeniden etkinleşen üye eski rolünü koruyor (yetki kapsamı ve rol). |
| 5 | BP16 | B′ | strengthens | D5 | DP16 | Hızlı arama korunuyor, ama müşteri bulunamazsa yarışa açık doğrudan ekleme yerine seri hale getiren müşteri çözümleyici çağrılıyor; aynı yeni iletişim bilgisiyle gelen eşzamanlı randevular yinelenen müşteri oluşturamaz. |
| 6 | DP05 | D′ | no_effect | D4 | BP05 | Belirsiz teslimatlarda sağlayıcı tekilleştirme penceresi 1 dakika tolerans sonrası kapanmış sayılıyor (zaman sınırı). |
| 7 | BP03 | B′ | weakens | D5 | DP03 | Deneme bütçesi dalında etkin kiralama koruması kaldırıldı; bakım, bir işçi gönderim yaparken işi sonlandırıp kiralama belirtecini siler. |
| 8 | AP01 | A′ | weakens | D5 | CP01 | Durum ve zaman kontrolü kilitsiz yetenek okumasının hemen arkasına taşındı; satır kilidiyle yeniden okunan randevu artık kontrol edilmiyor. Eşzamanlı bir iptal/yeniden planlama arada tamamlanırsa ikinci iptal yine yazılır. |
| 9 | AP06 | A′ | strengthens | D5 | CP06 | Belirteçsiz istek, mevcut saatler boş değilse bayat sayılıyor; eşzamanlı iki değiştirmeden ikincisi ilkini körlemesine silemez. |
| 10 | CP09 | C′ | no_effect | D3 | AP09 | Etkinleştirmede personelin aktif olması şartı kalktı; pasif personele hizmet atanabilir (personel/atama kuralı). |
| 11 | DP09 | D′ | no_effect | D2 | BP09 | Kapak geri yükleme varsayılan politikası "hayır"dan "evet"e döndü (politika seçimi). |
| 12 | DP15 | D′ | no_effect | D3 | BP15 | Personel uygunluğunda atamanın aktif olması şartı kalktı; pasif atamayla randevu alınabilir (atama kuralı). |
| 13 | DP07 | D′ | no_effect | D0 | BP07 | Silme koşulundan işletme kapsamı kaldırıldı; başka işletmenin görseli id ile silinebilir (kiracı yalıtımı). |
| 14 | CP01 | C′ | no_effect | D4 | AP01 | Müşteri iptali randevudan en geç 2 saat önce ve aynı yerel gün içinde olmamak koşuluyla yapılabiliyor (zaman sınırı, yerel gün); kontrol aynı kilit altında. |
| 15 | CP04 | C′ | no_effect | D2 | AP04 | Hizmet fiyatı oluşturulduktan sonra bu fonksiyonla değiştirilemiyor; fiyat alanı yamadan, hesaplamadan ve güncellemeden çıkarıldı (yakalanan fiyat politikası). |
| 16 | AP04 | A′ | strengthens | D5 | CP04 | Bayat yazma belirteci zorunlu oldu; eşzamanlı hizmet düzenlemeleri birbirinin üstüne sessizce yazamaz. |
