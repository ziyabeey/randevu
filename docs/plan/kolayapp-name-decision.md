# KolayApp — ürün adı kararı

**Karar tarihi:** 15 Eylül 2026

Randevu/Kepenk.ai ürün ailesinde daha önce **SalonApp** olarak anılan mobil işletme yüzeyinin kanonik ürün adı artık **KolayApp**'tir.

## Kapsam

- Yeni ürün metni, görev paketi, branch/PR açıklaması ve kullanıcıya görünen adlandırmada `KolayApp` kullanılır.
- Tarihsel commit, PR, issue, receipt ve eski handoff metinleri kanıt bütünlüğü için geriye dönük olarak yeniden yazılmaz.
- Mevcut plan/README/PRODUCT_SPEC/TASKS/PROJECT_STATE içindeki yaşayan `SalonApp` referansları ilk uygun docs/state sync'te `KolayApp` olarak topluca güncellenir.
- Bu isim değişikliği route, API, database schema, auth/session modeli veya alt menü sırasını tek başına değiştirmez.
- Sabit mobil alt menü sırası korunur: `Randevular / Adisyonlar / Yeni / Müşteriler / Diğer`.

## Implementation sınırı

F14-01 production entegrasyon bağımlılıkları değişmez. Ancak shared router/API'ye dokunmayan, yalnız `src/kolayapp/**` altında yaşayan izole ve geri döndürülebilir UI shell/component spike'ı bağımlılıklar tamamlanırken paralel geliştirilebilir. Bu spike F14-01'i `Tamamlandı` saydırmaz ve production route'a bağlanmaz.
