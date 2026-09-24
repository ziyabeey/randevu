> **SUPERSEDED / UYGULANMAZ:** Bu v0.1 başlangıç kaydı OpenAI API reader koluna aittir. Geçerli başlangıç `START-v0.2.md`; geçerli yöntem H19S-PROTOKOL-v0.2 + CLARIFICATIONS-v0.2.1'dir. Tarihsel provenance için tutulur.

# H19s ölçüm başlangıç kaydı

- Ana protokol: `c9b6fcaca9a83d7cc8fa1ea162f6e4dd90fd6b59`
- Uygulama eki ilk mühür: `65650535897571eff8322b61ef6a026a8d67335b`
- Reader contract: `f73f60596c2854e63f7cbc1372eb3c932b062ed6`
- Pricing snapshot: `7cc3eb46e9d404da0d73e66abc001f90f67144fb`
- Provider/secret guard eki: `991466fdc5e890c2e016bb87fe207465473742d4`

Ana protokol zamanı ile uygulama eki/pricing/reader freeze arasında `main` üzerinde yeni commit olmadığı GitHub
geçmişiyle doğrulandı. Bu nedenle arada kaçırılmış eligible unit yoktur.

**H19s örneklemi bu kayıt ve yukarıdaki bütün frozen artifact'ler hazır olduktan sonraki ilk main merge ile başlar.**

Ölçüm başlamadan önce runtime'da:
- `TYPESAFE_API_KEY`
- `H19S_OPENAI_API_KEY`

bulunmalıdır. Eksik secret shadow ölçümünü durdurur; normal PR/CI akışını durdurmaz.
