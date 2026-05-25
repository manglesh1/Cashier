const AWS_COMPUTE_HOST = /\.compute\.amazonaws\.com$/i;

export function redirectAwsOriginToCanonicalHost() {
  if (typeof window === "undefined") return false;

  const canonicalBase =
    import.meta.env.VITE_PUBLIC_APP_URL || import.meta.env.VITE_ADMIN_URL || "";

  if (!canonicalBase) return false;

  const { hostname, pathname, search, hash } = window.location;
  const isAwsOriginHost = AWS_COMPUTE_HOST.test(hostname);

  if (!isAwsOriginHost) return false;

  const target = new URL(canonicalBase);
  target.pathname = pathname;
  target.search = search;
  target.hash = hash;

  if (target.href === window.location.href) return false;

  window.location.replace(target.href);
  return true;
}
