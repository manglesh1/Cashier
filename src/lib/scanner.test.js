import test from "node:test";
import assert from "node:assert/strict";

import { attachScannerListener } from "./scanner.js";

test("scanner listener ignores malformed key events without breaking focused inputs", () => {
  let keydown;
  const target = {
    addEventListener(type, listener) {
      if (type === "keydown") keydown = listener;
    },
    removeEventListener() {},
  };
  const previousWindow = globalThis.window;
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };

  const detach = attachScannerListener({ targetEl: target });
  try {
    assert.doesNotThrow(() =>
      keydown({
        key: undefined,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      })
    );
  } finally {
    detach();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
