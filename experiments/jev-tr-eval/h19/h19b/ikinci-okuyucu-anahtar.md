# İkinci okuyucu anahtarı

| No | Vaka | Hücre | Etiket | Gerekçe |
|---|---|---|---|---|
| 1 | C04 | C | no_effect | Hata kodu yeniden adlandırıldı; yalnız çıktı değişir. |
| 2 | C10 | C | no_effect | Hata kodu yeniden adlandırıldı; yalnız çıktı değişir. |
| 3 | D06 | D | no_effect | Saat dilimi adı doğrulaması eklendi; yalnız girdi doğrulaması değişir. |
| 4 | B01 | B | weakens | Koşullu "ilk yazan kazanır" güncellemesinin boşluk koşulları kaldırıldı; aynı komutu eşzamanlı bitiren ikinci istek sonucu sessizce ezer, çakışma hatası artık oluşmaz. |
| 5 | C02 | C | no_effect | Hata kodu yeniden adlandırıldı; yalnız çıktı değişir. |
| 6 | D03 | D | no_effect | Ürün adı/kodu/birimi doğrulaması ayrıntılı hata kodlarına bölündü, ad sınırı 160 ve "pack" birimi eklendi; yalnız girdi doğrulaması değişir. |
| 7 | A08 | A | weakens | Kilitli okumadan kiralama belirteci (lease_token) koşulu kaldırıldı; kiralaması düşmüş eski bir işçi, işi yeniden kiralamış başka bir işçinin işini serbest bırakabilir. |
| 8 | B09 | B | weakens | "İlk yazan kazanır" koşulu gevşetildi (sonuç boşluğu koşulu kaldırıldı); aynı ürün için eşzamanlı ikinci bitirme sonucu ezer. |
| 9 | A09 | A | weakens | Pasifleştirme için kilidi ve bayat yazma kontrolünü atlayan erken bir yazma yolu eklendi; eşzamanlı bir etkinleştirmeyle sırası belirsizleşir, eski görünümle yapılan pasifleştirme sessizce yazılır. |
| 10 | A05 | A | weakens | Advisory kilit anahtarı hizmet adına daraltıldı; farklı adlı eşzamanlı eklemeler 100 limitini ve sort_order hesabını birlikte geçer. |
| 11 | B08 | B | weakens | Ekleme, çakışmada belirteci ezen upsert oldu; eşzamanlı iki kurulum kontrolü birlikte geçerse ikincisi hata almak yerine ilk belirteci ezer, ilk müşterinin yönetim bağlantısı sessizce geçersizleşir. |
| 12 | D02 | D | no_effect | Fişteki müşteri anlık görüntüsü normalize ediliyor (kırpma, boşsa null, e-posta küçük harf); yalnız kaydedilen değerler değişir. |
