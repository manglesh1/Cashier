export function createIdempotencyKey(prefix = "payment") {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}:${suffix}`;
}

export function ensureIdempotencyKey(ref, prefix = "payment") {
  if (!ref.current) {
    ref.current = createIdempotencyKey(prefix);
  }
  return ref.current;
}

export function keyForAttempt(ref, { prefix = "payment", fingerprint }) {
  const normalizedFingerprint = String(fingerprint || "");
  if (
    !ref.current ||
    ref.current.fingerprint !== normalizedFingerprint
  ) {
    ref.current = {
      fingerprint: normalizedFingerprint,
      key: createIdempotencyKey(prefix),
    };
  }
  return ref.current.key;
}
