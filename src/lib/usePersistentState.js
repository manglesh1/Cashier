// useState backed by localStorage — survives a hard refresh / kiosk reload.
// Used for transient-but-nice-to-keep UI lists like the Redeem "Recent
// activity" and Voucher counter "Recent scans", which otherwise reset to empty
// on every page reload because plain useState lives only in memory.
//
// Keep payloads small (these lists are capped by the caller). Reads are
// lazy-initialised once; writes are debounced to a microtask via useEffect.

import { useEffect, useRef, useState } from "react";

export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });

  // Track the key in a ref so a changing key writes to the right slot without
  // re-subscribing the effect on every render.
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    try {
      localStorage.setItem(keyRef.current, JSON.stringify(value));
    } catch {
      /* quota exceeded / non-serialisable — ignore, fall back to memory only */
    }
  }, [value]);

  return [value, setValue];
}
