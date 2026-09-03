export function absoluteShareUrl(link: string): string {
  if (link.startsWith("http://") || link.startsWith("https://")) return link;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}${link.startsWith("/") ? link : `/${link}`}`;
}
