import { useEffect } from "react";

export const MARKETING_DOCUMENT_META = {
  title: "Randevu kolay. | Kepenk.ai",
  description: "Kuaför, berber ve güzellik işletmeleri için kolay randevu yönetimi. Müşteri kendi alsın, takvimin karışmasın, kurulumu da birlikte yapalım.",
  canonical: "https://randevu.kepenk.ai/",
  ogType: "website",
} as const;

function upsertMeta(selector: string, attributes: Record<string, string>): HTMLMetaElement {
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  const element = existing ?? document.createElement("meta");

  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }

  if (!existing) {
    document.head.append(element);
  }

  return element;
}

function upsertCanonical(href: string): HTMLLinkElement {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const element = existing ?? document.createElement("link");
  element.rel = "canonical";
  element.href = href;

  if (!existing) {
    document.head.append(element);
  }

  return element;
}

export function useMarketingDocumentMeta(): void {
  useEffect(() => {
    const isStandalonePreview = window.location.pathname.endsWith("/marketing-preview.html");
    if (isStandalonePreview) {
      return undefined;
    }

    const previousTitle = document.title;
    const previousLang = document.documentElement.lang;

    document.title = MARKETING_DOCUMENT_META.title;
    document.documentElement.lang = "tr";

    const description = upsertMeta('meta[name="description"]', {
      name: "description",
      content: MARKETING_DOCUMENT_META.description,
    });
    const ogTitle = upsertMeta('meta[property="og:title"]', {
      property: "og:title",
      content: MARKETING_DOCUMENT_META.title,
    });
    const ogDescription = upsertMeta('meta[property="og:description"]', {
      property: "og:description",
      content: MARKETING_DOCUMENT_META.description,
    });
    const ogType = upsertMeta('meta[property="og:type"]', {
      property: "og:type",
      content: MARKETING_DOCUMENT_META.ogType,
    });
    const canonical = upsertCanonical(MARKETING_DOCUMENT_META.canonical);

    return () => {
      document.title = previousTitle;
      document.documentElement.lang = previousLang;
      description.remove();
      ogTitle.remove();
      ogDescription.remove();
      ogType.remove();
      canonical.remove();
    };
  }, []);
}
