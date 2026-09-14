import { useEffect } from "react";

export const MARKETING_DOCUMENT_META = {
  title: "Randevu kolay. | Kepenk.ai",
  description: "Kuaför, berber ve güzellik işletmeleri için kolay randevu yönetimi. Müşteri kendi alsın, takvimin karışmasın, kurulumu da birlikte yapalım.",
  canonical: "https://randevu.kepenk.ai/",
  ogType: "website",
} as const;

interface HeadMutation<T extends Element> {
  element: T;
  created: boolean;
  previous: Record<string, string | null>;
}

function applyAttributes<T extends Element>(
  element: T,
  attributes: Record<string, string>,
): Record<string, string | null> {
  const previous: Record<string, string | null> = {};

  for (const [name, value] of Object.entries(attributes)) {
    previous[name] = element.getAttribute(name);
    element.setAttribute(name, value);
  }

  return previous;
}

function upsertMeta(selector: string, attributes: Record<string, string>): HeadMutation<HTMLMetaElement> {
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  const element = existing ?? document.createElement("meta");
  const previous = applyAttributes(element, attributes);

  if (!existing) {
    document.head.append(element);
  }

  return { element, created: !existing, previous };
}

function upsertCanonical(href: string): HeadMutation<HTMLLinkElement> {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const element = existing ?? document.createElement("link");
  const previous = applyAttributes(element, { rel: "canonical", href });

  if (!existing) {
    document.head.append(element);
  }

  return { element, created: !existing, previous };
}

function restoreMutation({ element, created, previous }: HeadMutation<Element>): void {
  if (created) {
    element.remove();
    return;
  }

  for (const [name, value] of Object.entries(previous)) {
    if (value === null) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, value);
    }
  }
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

    const mutations: HeadMutation<Element>[] = [
      upsertMeta('meta[name="description"]', {
        name: "description",
        content: MARKETING_DOCUMENT_META.description,
      }),
      upsertMeta('meta[property="og:title"]', {
        property: "og:title",
        content: MARKETING_DOCUMENT_META.title,
      }),
      upsertMeta('meta[property="og:description"]', {
        property: "og:description",
        content: MARKETING_DOCUMENT_META.description,
      }),
      upsertMeta('meta[property="og:type"]', {
        property: "og:type",
        content: MARKETING_DOCUMENT_META.ogType,
      }),
      upsertCanonical(MARKETING_DOCUMENT_META.canonical),
    ];

    return () => {
      document.title = previousTitle;
      document.documentElement.lang = previousLang;
      mutations.forEach(restoreMutation);
    };
  }, []);
}
