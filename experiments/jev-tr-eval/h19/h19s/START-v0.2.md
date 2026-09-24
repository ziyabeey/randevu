# H19s v0.2 clean start

H19s v0.1'in ekstra OpenAI API reader/pricing kolu, **hiç gerçek örnek başlamadan önce** v0.2 ile geçersiz kılındı.

- v0.2 protocol: `87a8ff5723f5afff8ed7c8d5509664ffd6572f27`
- blind label contract: `960e566a235b4a71ae47f6e63d6505e0b30d6c72`
- main üzerinde v0.1/v0.2 geçişi sırasında gözlenmiş gerçek trafik yoktu.
- ilk eligible main merge, v0.2 kohortunun başlangıcıdır.

Runtime gereksinimi:
- `TYPESAFE_API_KEY` yalnız Jev shadow için.
- `H19S_OPENAI_API_KEY` **yoktur ve gerekmiyor**.
- System Two blind labels API ile değil, iki bağımsız ürün oturumuyla stop rule tamamlandıktan sonra yapılır.
