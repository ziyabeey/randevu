# H19t ikinci okuyucu anahtarı

| No | Vaka | Katman | Etiket | Yön (kayıt) | Gerekçe |
|---|---|---|---|---|---|
| 1 | PP07 | PP | yes + D1 | weakens | D5: işletme ve takma ad kilitleri kaldırıldı (aynı işletmeye eşzamanlı iki farklı takma ad bağlama "işletme zaten bağlı" kontrolünü birlikte geçer). D1: aynı takma adın aynı işletmeye yeniden bağlanması artık "zaten bağlı" diye başarılı dönmüyor, çakışma hatası veriyor (tekrar semantiği). |
| 2 | PS07 | PS | yes (yalnız D5) | weakens | Tetikleyicideki grup satırı kilidi kaldırıldı; aynı grubun iki satırı eşzamanlı güncellenirse her tetikleyici özet durumu kendi anlık görüntüsünden hesaplar, son yazan diğerinin sonucunu ezer. |
| 3 | PP20 | PP | yes + D4 | weakens | D5: sürmekte olan oluşturmayı bekleten advisory kilit kaldırıldı (aynı kurtarma kimliğiyle oluşturma bitmeden sorgu "yok" döner). D4: kurtarma bilgisi süresi dolduktan sonra 10 dakika daha geçerli ve o süre boyunca silinmiyor. |
| 4 | NP13 | NP | no; D1, D4 | — | D1: tekrar özeti yeni başlangıç zamanını içermiyor (farklı zamanlı istek aynı istek sayılır). D4: personel uygunluğu için gün, işletmenin yerel günü yerine UTC gününden alınıyor. |
| 5 | NS20 | NS | no; D4 | — | Eski sayaçların silinme eşiği 48 saatten 72 saate çıktı (saklama süresi sınırı). |
| 6 | NS04 | NS | no; D0 | — | Gönderim sırrı doğrulaması kaldırıldı; iş talebini ve alıcı/yönetim verisini yetkisiz çağıran da alabilir. |
| 7 | NS11 | NS | no; D2 | — | Satış satırı ürün kodu anlık görüntüsünü yakalamıyor (kod sonradan değişirse satırdan izlenemez). |
| 8 | NP03 | NP | no; D0, D2 | — | D0: fiş kapatma fiyat düzeltme yetkisi yerine ödeme yetkisi istiyor. D2: kapatan üye kaydedilmiyor (geçmiş kaydı). |
| 9 | PS03 | PS | yes (yalnız D5) | weakens | Ürün sürüm belirteci isteğe bağlı oldu; belirteç göndermeyen istemci, eşzamanlı bir ürün düzenlemesinden sonra bayat fiyat/ad görünümüyle satış satırı ekler. |
| 10 | NP20 | NP | no; D3, D4 | — | D3: pasif personel-hizmet ataması da geçerli sayılıyor. D4: işletme saatlerinin haftanın günü, yerel tarih yerine UTC tarihinden hesaplanıyor. |
| 11 | PP02 | PP | yes + D0 | weakens | D5: blok sayımını serileştiren advisory kilit kaldırıldı (eşzamanlı eklemeler 100 sınırını birlikte geçer; aynı ad alanını kilitleyen grup randevusuyla da serileşmez). D0: blok eklemeyi yönetici yerine her aktif üye yapabiliyor. |
| 12 | PS19 | PS | yes (yalnız D5) | strengthens | İstek beklenen abonelik sürümünü taşıyorsa kilit altında karşılaştırılıyor; eski görünüme dayanan eşzamanlı plan değişikliği reddedilir (iyimser sürüm). |
| 13 | PP13 | PP | yes + D3 | weakens | D5: bekleyen davet sayımını serileştiren advisory kilit kaldırıldı (eşzamanlı davetler sınırı birlikte geçer). D3: bekleyen davet sınırı 100'den 200'e çıktı. |
| 14 | PS15 | PS | yes (yalnız D5) | strengthens | Personel kontrolüne paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme bu blok eklemesiyle serileşir. |
| 15 | NS14 | NS | no; D3 | — | Grup satırlarının personel uygunluk denetimi pasif personeli de kabul ediyor (personel etkinlik koşulu kaldırıldı). |
| 16 | NP05 | NP | no; D0, D3 | — | D0: herkese açık rezervasyon kapısı sırrı doğrulanmıyor. D3: oluşturma istekleri artık istek sınırına (kişi/ağ başı kota) tabi değil. |
