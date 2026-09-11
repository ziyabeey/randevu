# YZT Randevu

YZT Digital'ın yerel hizmet işletmeleri için geliştirdiği randevu SaaS'ının başlangıcı.

**Mevcut kapsam: Faz 1 — yerelde çalışan frontend ve Worker API.** Bu sürüm randevu almaz ve müşteri verisi saklamaz. Authentication, işletme/tenant modeli, veritabanı, migration, takvim ve deployment sonraki fazlardadır.

## Gereksinimler

- Node.js 24 önerilir; minimum sürüm 22.12.0'dır. `.nvmrc` Node 24'ü seçer.
- npm 11.9.0 ile doğrulanır. Bağımlılıkların kesin sürümleri `package-lock.json` ile sabitlenir.
- Yerel kullanım için Cloudflare hesabı, Supabase projesi, API anahtarı veya `.env` gerekmez.

## Yerelde çalıştırma

```bash
npm ci
npm run dev
```

Uygulama: http://127.0.0.1:5173

Vite ve Cloudflare Vite eklentisi, React arayüzünü ve gerçek yerel Workers runtime'ını tek komutla çalıştırır. İkinci bir backend sunucusu veya API proxy ayarı gerekmez. Port kullanımda ise sunucu başka porta sessizce geçmek yerine hata verir.

Worker debug inspector'ı kapalıdır; yerel başlangıç otomatik inspector portu veya ağ arayüzü keşfi gerektirmez.

Başlangıç ekranı `/api/health` isteğinin sonucunu gösterir. Kontrol sekiz saniyede zaman aşımına uğrar; hatada kullanıcı tekrar deneyebilir. “Bağlantı hazır” yalnızca API'nin yanıt verdiğini ifade eder; bir veritabanı veya booking hazırlık kontrolü değildir.

## Komutlar

| Komut | İşlev |
| --- | --- |
| `npm ci` | Lockfile'daki sürümlerle temiz kurulum. |
| `npm run dev` | Yerel React + Worker geliştirme sunucusu. |
| `npm run typecheck` | Frontend, Worker ve Vite yapılandırmasını ayrı TypeScript ortamlarında kontrol eder. |
| `npm run build` | Önce typecheck, ardından frontend ve Worker build'i. Çıktılar `dist/` altındadır. |
| `npm run preview` | Son build'i yerelde http://127.0.0.1:4173 üzerinden çalıştırır. Önce build gerekir. |

Bu komutlar deployment yapmaz. Cloudflare kaynakları ve CI/CD bu fazda oluşturulmaz.

## Yapı

| Yol | Sorumluluk |
| --- | --- |
| `src/` | React başlangıç ekranı ve stiller. |
| `worker/index.ts` | Hono API; uygulamanın server giriş noktası. |
| `public/` | Statik dosyalar. |
| `vite.config.ts` | React/Cloudflare eklentileri ve yerel portlar. |
| `wrangler.jsonc` | Worker girişi ve statik dosya/API yönlendirmesi. |
| `tsconfig.*.json` | Tarayıcı, Worker ve Node yapılandırma kodunun ayrı tip ortamları. |

Frontend iş verisine kendi API'si üzerinden erişecek. Booking kuralları sonraki fazlarda backend/domain kodunda yer alacak. Şimdilik ihtiyaç duyulmayan domain klasörleri, SDK'lar ve veri bağlantıları eklenmedi.

## API sözleşmesi

| İstek | Sonuç |
| --- | --- |
| `GET /api/health` | `200`, `{"status":"ok","service":"yzt-randevu"}` |
| `HEAD /api/health` | `200`, boş gövde. |
| `POST /api/health` ve diğer desteklenmeyen metotlar | `405`, JSON hata ve `Allow: GET, HEAD`. |
| `/api` ve bilinmeyen `/api/*` adresleri | `404`, `NOT_FOUND` kodlu JSON hata. |

API yanıtları `Cache-Control: no-store` ve `X-Content-Type-Options: nosniff` taşır. Health yanıtı secrets veya ortam değişkenlerini içermez.

`run_worker_first`, hem `/api` hem `/api/*` için açıktır. Böylece API istekleri SPA fallback tarafından `200 index.html` yanıtına dönüştürülmez; `Accept: text/html` gönderen gezinme istekleri de JSON hata alır.

## Faz 1 kabul kontrolü

```bash
npm ci
npm run typecheck
npm run build
npm run dev
```

Ayrı bir terminalde:

```bash
curl -i http://127.0.0.1:5173/api/health
curl -I http://127.0.0.1:5173/api/health
curl -i -X POST http://127.0.0.1:5173/api/health
curl -i -H 'Accept: text/html' http://127.0.0.1:5173/api/bulunamadi
curl -i http://127.0.0.1:5173/api
```

Sırasıyla 200, 200, 405, 404 ve 404 beklenir. Aynı kontroller build sonrası `npm run preview` ile 4173 portunda da yapılabilir. Arayüzde kontrol sürerken düğme kilitlenmeli, bağlantı sonucu metinle açıklanmalıdır.

Secrets yalnızca ileride ihtiyaç oluştuğunda server ortamına eklenecek. `VITE_` önekli değişkenler tarayıcıya açık kabul edilir; burada secret tutulmaz. Yerel `.env` ve `.dev.vars` dosyaları Git dışında bırakılır.
