const headers = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=300",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};

const OG_PNG_BASE64 = "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";
const OG_PNG = Uint8Array.from(atob(OG_PNG_BASE64), (char) => char.charCodeAt(0));

const shell = ({ title, description, content }) => `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="tr_TR" />
  <meta property="og:site_name" content="Kepenk.ai" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="https://kepenk.ai/" />
  <meta property="og:image" content="https://kepenk.ai/og.png" />
  <meta property="og:image:secure_url" content="https://kepenk.ai/og.png" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Kepenk.ai — Kepenk açık, sistem çalışıyor." />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="https://kepenk.ai/og.png" />
  <link rel="canonical" href="https://kepenk.ai/" />
  <meta name="theme-color" content="#0b1633" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <style>
    :root{color-scheme:dark;--ink:#081126;--panel:#0b1633;--line:rgba(255,255,255,.12);--blue:#3366cc;--lime:#c6e800;--paper:#f5f7ff;--muted:#aab5d2}
    *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--ink);color:var(--paper);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    body{min-height:100vh;overflow-x:hidden}.wrap{position:relative;min-height:100vh;display:flex;flex-direction:column}
    .shutter{position:fixed;inset:0;pointer-events:none;opacity:.55;background:
      linear-gradient(90deg,transparent 0 8%,rgba(51,102,204,.14) 8% 9%,transparent 9% 91%,rgba(198,232,0,.09) 91% 92%,transparent 92%),
      repeating-linear-gradient(180deg,rgba(255,255,255,.025) 0 1px,transparent 1px 54px)}
    .glow{position:fixed;width:42rem;height:42rem;border-radius:50%;filter:blur(90px);opacity:.18;pointer-events:none}
    .g1{background:#3366cc;right:-15rem;top:-18rem}.g2{background:#c6e800;left:-22rem;bottom:-28rem}
    header,main,footer{position:relative;z-index:1}.bar{width:min(1120px,calc(100% - 40px));margin:auto}
    header{padding:28px 0}.brand{display:flex;align-items:center;gap:12px;font-weight:800;letter-spacing:-.02em;font-size:20px}
    .mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(145deg,var(--blue),#244a9e);position:relative;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16),0 10px 30px rgba(0,0,0,.28)}
    .mark:before,.mark:after{content:"";position:absolute;left:7px;right:7px;height:3px;border-radius:9px;background:var(--lime)}
    .mark:before{top:10px}.mark:after{top:20px}
    main{flex:1;display:flex;align-items:center;padding:54px 0 90px}.hero{width:min(1120px,calc(100% - 40px));margin:auto;display:grid;grid-template-columns:1.2fr .8fr;gap:56px;align-items:center}
    .eyebrow{display:inline-flex;align-items:center;gap:9px;color:#d9e3ff;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
    .dot{width:8px;height:8px;border-radius:50%;background:var(--lime);box-shadow:0 0 0 7px rgba(198,232,0,.08)}
    h1{font-size:clamp(52px,8vw,108px);line-height:.91;letter-spacing:-.065em;margin:24px 0 28px;max-width:860px}
    h1 span{color:var(--lime)}.lead{font-size:clamp(18px,2vw,24px);line-height:1.55;color:#c6d1eb;max-width:700px;margin:0}
    .chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:30px}.chip{padding:10px 14px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.035);color:#dce5fb;font-size:13px}
    .card{border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.025));border-radius:28px;padding:28px;box-shadow:0 32px 80px rgba(0,0,0,.28)}
    .card .kicker{font-size:12px;color:#94a6ce;text-transform:uppercase;letter-spacing:.14em}.status{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:18px;padding:18px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .status strong{font-size:22px}.live{display:flex;align-items:center;gap:8px;color:#e8ff83;font-weight:700}.live i{display:block;width:10px;height:10px;border-radius:50%;background:var(--lime);box-shadow:0 0 24px rgba(198,232,0,.85)}
    .mini{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}.mini div{padding:16px;border:1px solid var(--line);border-radius:16px;background:rgba(7,16,38,.5)}.mini b{display:block;margin-bottom:5px}.mini span{font-size:13px;color:var(--muted)}
    .legal{width:min(780px,calc(100% - 40px));margin:auto;padding:36px 0 72px}.legal h1{font-size:clamp(42px,7vw,72px);line-height:1;letter-spacing:-.05em}.legal h2{margin-top:34px}.legal p,.legal li{color:#c6d1eb;line-height:1.7}.legal a{color:#dfff52}
    footer{border-top:1px solid var(--line);padding:20px 0 26px;color:#8f9bbc;font-size:13px}.foot{display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap}.foot a{color:#c9d5f3;text-decoration:none}.foot nav{display:flex;gap:18px}
    @media(max-width:820px){.hero{grid-template-columns:1fr;gap:36px}.card{max-width:580px}.mini{grid-template-columns:1fr}.foot{flex-direction:column}.lead{font-size:18px}main{padding-top:28px}}
  </style>
</head>
<body data-kepenk-root="v1">
  <div class="wrap"><div class="shutter"></div><div class="glow g1"></div><div class="glow g2"></div>
  <header><div class="bar"><div class="brand"><span class="mark" aria-hidden="true"></span><span>Kepenk.ai</span></div></div></header>
  ${content}
  <footer><div class="bar foot"><span>© 2026 yzt.digital · Kepenk.ai</span><nav><a href="/">Ana sayfa</a><a href="/gizlilik">Gizlilik</a><a href="/kullanim-kosullari">Kullanım koşulları</a></nav></div></footer>
  </div>
</body></html>`;

const home = shell({
  title: "Kepenk.ai — İşletmeler için dijital operasyon altyapısı",
  description: "Kepenk.ai, işletmeler için randevu, müşteri yönetimi, operasyon ve otomasyon ürünleri geliştirir.",
  content: `<main><section class="hero">
    <div>
      <div class="eyebrow"><span class="dot"></span>İşletmeler için dijital operasyon altyapısı</div>
      <h1>Kepenk açık.<br><span>Sistem çalışıyor.</span></h1>
      <p class="lead">Randevu, müşteri yönetimi, günlük operasyon ve otomasyon araçlarını tek bir ürün ailesinde geliştiriyoruz. İlk ürünlerimiz sahaya hazırlanıyor.</p>
      <div class="chips"><span class="chip">Randevu</span><span class="chip">Müşteri yönetimi</span><span class="chip">Operasyon</span><span class="chip">Otomasyon</span></div>
    </div>
    <aside class="card" aria-label="Kepenk.ai yayın durumu">
      <div class="kicker">kepenk.ai / durum</div>
      <div class="status"><strong>Platform vitrini</strong><span class="live"><i></i>Yayında</span></div>
      <div class="mini">
        <div><b>Randevu</b><span>İşletme operasyonu ve rezervasyon akışı</span></div>
        <div><b>Randevu Kolay</b><span>Müşteri tarafında kolay rezervasyon deneyimi</span></div>
        <div><b>Kepenk Core</b><span>Ortak kimlik ve platform altyapısı</span></div>
        <div><b>yzt.digital</b><span>Ürün ve teknoloji geliştirme</span></div>
      </div>
    </aside>
  </section></main>`
});

const privacy = shell({
  title: "Gizlilik Politikası — Kepenk.ai",
  description: "Kepenk.ai tanıtım sayfası gizlilik bilgileri.",
  content: `<main class="legal"><article>
    <div class="eyebrow"><span class="dot"></span>Son güncelleme: 24 Eylül 2026</div>
    <h1>Gizlilik Politikası</h1>
    <p>Bu metin, <strong>kepenk.ai</strong> alan adındaki kurumsal tanıtım sayfası için geçerlidir.</p>
    <h2>Bu sayfada hangi veriler işlenir?</h2>
    <p>Bu tanıtım sayfasında form, hesap oluşturma veya doğrudan pazarlama amaçlı veri toplama alanı bulunmaz. Sayfanın güvenli ve erişilebilir sunulabilmesi için barındırma ve güvenlik altyapısı standart teknik istek kayıtlarını işleyebilir.</p>
    <h2>Ürün yüzeyleri</h2>
    <p>Kepenk.ai ürün ailesindeki oturum açma, rezervasyon veya işletme yönetimi gibi veri işleyen yüzeylerde ilgili aydınlatma ve gizlilik metinleri, veri toplanmadan önce kendi ürün bağlamında ayrıca sunulur.</p>
    <h2>Değişiklikler</h2>
    <p>Bu politika ürün ve mevzuat gereksinimlerine göre güncellenebilir. Güncel sürüm her zaman bu adreste yayımlanır.</p>
  </article></main>`
});

const terms = shell({
  title: "Kullanım Koşulları — Kepenk.ai",
  description: "Kepenk.ai tanıtım sayfası kullanım koşulları.",
  content: `<main class="legal"><article>
    <div class="eyebrow"><span class="dot"></span>Son güncelleme: 24 Eylül 2026</div>
    <h1>Kullanım Koşulları</h1>
    <p>Bu alan adı Kepenk.ai ürün ailesinin kurumsal tanıtım yüzeyidir.</p>
    <h2>Tanıtım içeriği</h2>
    <p>Bu sayfadaki ürün açıklamaları geliştirme yönünü ve ürün ailesini tanımlar; belirli bir özelliğin, fiyatın veya hizmet seviyesinin her kullanıcı için anında kullanılabilir olduğuna dair garanti oluşturmaz.</p>
    <h2>Ürün koşulları</h2>
    <p>Kullanıma açılan ürünler, gerektiğinde kendi hizmet ve kullanım koşullarıyla sunulur. İlgili ürün yüzeyindeki koşullar o hizmet için geçerlidir.</p>
    <h2>Fikri haklar</h2>
    <p>Kepenk.ai adı, görsel kimliği ve bu sayfadaki özgün içerikler ilgili hak sahiplerine aittir.</p>
  </article></main>`
});

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "kepenk-root-site", version: "v1" }), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
      });
    }

    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\nSitemap: https://kepenk.ai/sitemap.xml\n", {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" }
      });
    }

    if (url.pathname === "/sitemap.xml") {
      return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://kepenk.ai/</loc></url><url><loc>https://kepenk.ai/gizlilik</loc></url><url><loc>https://kepenk.ai/kullanim-kosullari</loc></url></urlset>', {
        headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" }
      });
    }

    if (url.pathname === "/favicon.svg") {
      return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="%233366cc"/><path d="M14 20h36M14 32h36M14 44h24" stroke="%23c6e800" stroke-width="6" stroke-linecap="round"/></svg>', {
        headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" }
      });
    }

    if (url.pathname === "/og.png") {
      return new Response(request.method === "HEAD" ? null : OG_PNG, {
        headers: {
          "content-type": "image/png",
          "content-length": String(OG_PNG.byteLength),
          "cache-control": "public, max-age=86400, immutable",
          "x-content-type-options": "nosniff"
        }
      });
    }

    const html = url.pathname === "/gizlilik"
      ? privacy
      : url.pathname === "/kullanim-kosullari"
        ? terms
        : home;

    return new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
  }
};
