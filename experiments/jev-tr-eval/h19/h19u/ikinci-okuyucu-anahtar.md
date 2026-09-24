# H19u ikinci okuyucu anahtarı

| No | Vaka | Katman | Etiket | Aile | Yön (kayıt) | Gerekçe |
|---|---|---|---|---|---|---|
| 1 | A04 | A | D1_ONLY | receipt_not_finished | — | Komut makbuzu sonuçla kapatılmıyor; tekrar eden kapatma isteği kayıtlı sonucu bulamayıp komutu yeniden çalıştırır ve "fiş açık değil" hatası alır. |
| 2 | D19 | D (D4) | NEITHER_OR_OTHER | time_window | — | Müşteri yeniden planlamasında asgari önceden bildirim süresi artık uygulanmıyor; yalnız gün aralığı denetleniyor. |
| 3 | C13 | C | BOTH | replay_probe_unlocked | weakens | Takma ad kilidi kaldırıldı: aynı takma adla eşzamanlı iki kurulum tekrar yoklamasını birlikte geçer (D5); ikisi de işletme açmaya çalışır, ikincisi mevcut işletmeye eşlenmek yerine hata alır (D1: belirlenimci tekrar). |
| 4 | D11 | D (D3) | NEITHER_OR_OTHER | availability | — | Personel uygunluk denetiminde pasif bloklar da müsaitliği engelliyor (blok etkinlik koşulu kaldırıldı). |
| 5 | B16 | B | D5_ONLY | lock_mode_order | strengthens | Hizmet ve personel satırları FOR UPDATE yerine FOR NO KEY UPDATE ile kilitleniyor; başka rezervasyonun tuttuğu yabancı anahtar paylaşımlı kilitleriyle satır/advisory kilit terslenmesi (kilitlenme) ortadan kalkar. |
| 6 | A17 | A | D1_ONLY | provider_idempotency_key | — | Sağlayıcı tekilleştirme anahtarı olay başına değil randevu başına üretiliyor; yeniden planlama sonrası yeni onay bildirimi sağlayıcı tarafında önceki gönderimin tekrarı sayılıp bastırılır. |
| 7 | A16 | A | D1_ONLY | noop_repeat | — | Aynı duruma ikinci geçiş artık etkisiz sayılmıyor: tekrar "onayla" yeni bir olay yazar, tekrar "iptal/tamamla" geçersiz geçiş hatası verir (tekrarlanan komutun işlenişi). |
| 8 | C12 | C | BOTH | compound | weakens | D5: randevu satırı kilidi FOR KEY SHARE'e indi (eşzamanlı iptal ile yeniden planlama birlikte geçer). D1: tekrar özeti randevuyu içermiyor; aynı anahtarla başka randevunun taşınması öncekinin tekrarı sayılır. |
| 9 | B08 | B | D5_ONLY | lock_removal | weakens | Tetikleyicideki işletme satırı kilidi kaldırıldı; iletişim bilgisini kaldıran yazım, eşzamanlı rezervasyon açma kararıyla serileşmez. |
| 10 | A08 | A | D1_ONLY | command_identity | — | Arşivleme makbuzda "ürün güncelleme" komut kimliğiyle açılıp kapanıyor; aynı anahtarla gelen güncelleme ile arşivleme aynı makbuzu paylaşır. |
| 11 | C20 | C | BOTH | get_or_create_unlocked | weakens | Grup anahtarlı advisory kilit kaldırıldı: aynı grup için eşzamanlı iki fiş açma "fiş var mı" yoklamasını birlikte geçer (D5); ikincisi mevcut fişi döndürmek yerine benzersizlik hatası alır (D1: "varsa getir, yoksa oluştur" tekrar semantiği). |
| 12 | D01 | D (D0) | NEITHER_OR_OTHER | authority_scope | — | İade ödeme yetkisi yerine fiyat düzeltme yetkisi istiyor (yetki kapsamı). |
| 13 | D10 | D (D2) | NEITHER_OR_OTHER | snapshot | — | Satış satırı en yüksek fiyat anlık görüntüsünü yakalamıyor. |
| 14 | B02 | B | D5_ONLY | lock_downgrade | weakens | Fiş ve fiş satırı kilitleri FOR UPDATE yerine FOR KEY SHARE oldu; aynı fişe eşzamanlı iki indirim birlikte kilit alır, ikisi de toplam/ödenen kontrolünü eski toplamla geçer. |
| 15 | C04 | C | BOTH | command_key_lock | weakens | İstek anahtarı advisory kilidi kaldırıldı: henüz satırı olmayan yeni bir anahtarla eşzamanlı iki istek tekrar yoklamasını kilitsiz geçer (D5); ikincisi tekrar olarak dönmeden önce dondurulmuş sonuç yerine güncel katalog doğrulamasından geçer (D1). |
| 16 | B17 | B | D5_ONLY | lock_mode_order | strengthens | Katılan personel satırları FOR UPDATE yerine FOR KEY SHARE ile kilitleniyor; korumalı personel saati yazımlarıyla satır/advisory kilit terslenmesi (kilitlenme) ortadan kalkar. |
