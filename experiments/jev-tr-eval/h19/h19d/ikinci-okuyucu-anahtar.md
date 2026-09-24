# H19d ikinci okuyucu anahtarı

| No | Vaka | Katman | Etiket | Yön (kayıt) | Gerekçe |
|---|---|---|---|---|---|
| 1 | PP07 | PP | yes + D1 | weakens | Komut makbuzu ekleme "var mı bak, yoksa ekle"ye döndü: eşzamanlı aynı istekler kontrolü birlikte geçer (D5), ikincisi tekrar yanıtı yerine benzersizlik hatası alır (D1). |
| 2 | PS07 | PS | yes (yalnız D5) | weakens | Geri yüklemenin "deleting" durum koşulu kaldırıldı; eşzamanlı olarak silinmesi bitirilen ya da temizlemeye alınan görsel tekrar "ready" yapılabilir. |
| 3 | PP20 | PP | yes + D4 | strengthens | Kilit beklemesinden sonraki süre hesapları işlem başı now() yerine clock_timestamp() kullanıyor: uzun satır kilidi beklemesi sonrası pencere ve yeniden deneme sınırı gerçek zamana göre değerlendirilir (D4) ve bekleme sırasında dolan süre gözden kaçmaz (D5). |
| 4 | NP13 | NP | no; D1, D4 | — | D1: tekrar özeti yeni başlangıç zamanını içermiyor (farklı zamanlı istek aynı istek sayılır). D4: yeni başlangıç en fazla 180 gün ileride olabilir. |
| 5 | NS20 | NS | no; D4 | — | Grup yeni başlangıç zamanı geçmişte olamıyor (zaman sınırı). |
| 6 | NS04 | NS | no; D0 | — | İşletmeyi oluşturan kullanıcı sahip değil yönetici rolüyle üye oluyor (yetki kapsamı). |
| 7 | NS11 | NS | no; D2 | — | Başarılı tamamlamada son hata sınıfı artık temizlenmiyor; geçmiş hata kaydı korunuyor (geçmiş değer). |
| 8 | NP03 | NP | no; D0, D2 | — | D0: herkese açık profili her aktif üye düzenleyebiliyor. D2: kapak gönderilmezse önceki kapak korunuyor (yakalanan durum politikası). |
| 9 | PS03 | PS | yes (yalnız D5) | weakens | Randevu satırı kilidi kaldırıldı; durum geçişi kilitsiz okumayla doğrulanıyor ve güncelleme durum koşulu taşımıyor: eşzamanlı iki geçiş birlikte geçer. |
| 10 | NP20 | NP | no; D3, D4 | — | D3: personelin çakışan çalışma aralıkları artık reddedilmiyor (müsaitlik kuralı). D4: başlangıcı bitişinden sonra olan gece aralıkları kabul ediliyor. |
| 11 | PP02 | PP | yes + D0 | weakens | D5: iletişim çakışma kontrolü işletme kilidinden önceye taşındı (eşzamanlı müşteri oluşturmayla serileşmez). D0: düzenlenen müşteri artık işletme kapsamıyla sınırlı değil. |
| 12 | PS19 | PS | yes (yalnız D5) | strengthens | Personel uygunluk okumasına paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme veya atama kaldırma serileşir. |
| 13 | PP13 | PP | yes + D3 | weakens | D5: advisory kilit anahtarı personel adına daraldı (farklı adlı eşzamanlı eklemeler sayımı birlikte geçer). D3: personel limiti 100'den 200'e çıktı. |
| 14 | PS15 | PS | yes (yalnız D5) | strengthens | İşletme satırı kilidi eklendi; silmeyi bitirme, aynı kilidi alan geri yükleme işlemiyle serileşir. |
| 15 | NS14 | NS | no; D3 | — | Yönetim değişikliği için kişi başı istek limiti 10'dan 5'e indi (kaynak sınırı). |
| 16 | NP05 | NP | no; D0, D3 | — | D0: atamayı her aktif üye yapabiliyor. D3: atama limiti 5000'den 1000'e indi. |
