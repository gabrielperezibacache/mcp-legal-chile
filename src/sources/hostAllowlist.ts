/** Official host allowlists for provenance (never trust SERP `site:` alone). */

export function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** True if host is exactly `domain` or a subdomain (`www.domain`, `a.b.domain`). */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

export function isAllowedHost(
  url: string | undefined,
  allowedDomains: readonly string[],
): boolean {
  if (!url) return false;
  const host = hostnameOf(url);
  if (!host) return false;
  return allowedDomains.some((d) => hostMatchesDomain(host, d));
}

export const CGR_HOSTS = ["contraloria.cl"] as const;
export const DIPRES_HOSTS = ["dipres.gob.cl"] as const;
export const DT_HOSTS = ["dt.gob.cl", "dirtrab.cl"] as const;
export const SERNAC_HOSTS = ["sernac.cl"] as const;
export const CMF_HOSTS = ["cmfchile.cl"] as const;

export function publisherForOfficialUrl(
  url: string | undefined,
  mapping: ReadonlyArray<{ domains: readonly string[]; publisher: string }>,
): string | undefined {
  if (!url) return undefined;
  for (const { domains, publisher } of mapping) {
    if (isAllowedHost(url, domains)) return publisher;
  }
  return undefined;
}
