# KolayApp — ürün adı kararı

**Karar tarihi:** 15 Eylül 2026

Randevu Kolay ürününde daha önce **SalonApp** olarak anılan mobil işletme yüzeyinin kanonik ürün adı artık **KolayApp**'tir.

Domain/marka sınırı için bağlayıcı kaynak: [Randevu Kolay domain, marka ve origin sözleşmesi](randevu-kolay-domain-contract.md).

## Kapsam

- Yeni ürün metni, görev paketi, branch/PR açıklaması ve kullanıcıya görünen adlandırmada `KolayApp` kullanılır.
- Tarihsel commit, PR, issue, receipt ve eski handoff metinleri kanıt bütünlüğü için geriye dönük olarak yeniden yazılmaz.
- Mevcut plan/README/PRODUCT_SPEC içindeki yaşayan `SalonApp` adlandırması ilgili doküman değişikliğinde güncellenir; canlı görev durumu yalnız TASKS'ta tutulur.
- Bu isim değişikliği route, API, database schema, auth/session modeli veya alt menü sırasını tek başına değiştirmez.
- Sabit mobil alt menü sırası korunur: `Randevular / Adisyonlar / Yeni / Müşteriler / Diğer`.
- KolayApp private işletme uygulamasının mobil kabuğudur; ayrı customer-facing marka/domain/backend değildir.
- Canonical private origin `randevu.kepenk.ai`'dir; customer-facing Randevu Kolay evreni `randevukolay.net` altında kalır.

## Implementation sınırı

F14-01 production entegrasyon bağımlılıkları değişmez. Ancak shared router/API'ye dokunmayan, yalnız `src/kolayapp/**` altında yaşayan izole ve geri döndürülebilir UI shell/component spike'ı bağımlılıklar tamamlanırken paralel geliştirilebilir. Bu spike F14-01'i `Tamamlandı` saydırmaz ve production route'a bağlanmaz.
