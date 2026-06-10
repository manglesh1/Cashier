# Movira Wristband Sidecar

Tiny Electron app that bridges a USB RFID wristband reader to the
browser-based Cashier app. Talks USB on one side, localhost WebSocket
on the other.

The Cashier reads from `ws://127.0.0.1:7777/`. When a scan lands, the
sidecar broadcasts it; the Cashier dispatches a `cashier:scan`
CustomEvent that the existing redemption/binding handlers already
listen to.

## Why a separate process

The Cashier runs in a browser tab. Browsers can't talk to USB serial /
HID devices reliably across platforms (WebHID and WebUSB exist but are
Chrome-only, fiddly to permission, and unsupported on Android tablets).
Native Node access via Electron sidesteps all of that.

## Running for development

```bash
cd sidecar
npm install
npm run start:mock    # emits a fake scan every 7s — no hardware needed
```

Scripts use `cross-env` so they work in Windows PowerShell/CMD as well
as POSIX shells. If you see `'MOVIRA_WRISTBAND_ADAPTER' is not
recognized as an internal or external command`, re-run `npm install` —
`cross-env` needs to be on disk.

Open the Cashier (`http://localhost:5173`) in Chrome on the same
machine. If the venue's `wristbandMode` is `rfid`, the bridge auto-
connects on cashier login. You'll see fake scans dispatched as
`cashier:scan` events — drop a `window.addEventListener("cashier:scan", ...)`
into the DevTools console to verify.

## Running against real hardware (ACR122U)

The ACR122U is a $40 USB NFC reader that enumerates as a PC/SC
smartcard device. The adapter uses [`@pokusew/pcsclite`](https://github.com/pokusew/node-pcsclite).

**Windows:**
1. Install ACS's unified driver: <https://www.acs.com.hk/en/driver/3/acr122u-usb-nfc-reader/>
2. Plug in the reader — Device Manager should show a "Smart Card Reader"
3. `npm install` (includes the pcsclite optional dep)
4. `npm run start:acr122u`

**macOS:**
PC/SC is built-in (CryptoTokenKit). Just plug + run.

**Linux:**
```bash
sudo apt install pcscd libccid     # or your distro's equivalent
sudo systemctl start pcscd
npm run start:acr122u
```

(The `start:acr122u` script wraps the env var with `cross-env`; the
manual `MOVIRA_WRISTBAND_ADAPTER=...` form only works on POSIX shells.)

If pcsclite isn't installed or can't find the reader, the sidecar
stays up and the status panel shows "ACR122U · driver not installed"
or "ACR122U · waiting for reader" — the Cashier won't get a connection
error storm.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `MOVIRA_WRISTBAND_ADAPTER` | `mock` | `mock` or `acr122u` |
| `MOVIRA_WRISTBAND_PORT` | `7777` | Localhost WebSocket port |
| `MOVIRA_WRISTBAND_MOCK_MS` | `7000` | Mock scan interval (ms) |

The Cashier's connection port is driven by the venue config
(`wristbandConfig.rfid.bridgePort`, set in the admin Wristbands page).
Default `7777`; change if you have a port conflict.

## Wire protocol

JSON messages, one per WebSocket frame.

```
server → client   { type: "hello", version: 1, at }
                  { type: "rfid_scan", uid: "04A53C1F", reader: "ACR122U", at }

client → server   { type: "ping", at }     (optional)
```

The Cashier dispatches:

```js
window.dispatchEvent(
  new CustomEvent("cashier:scan", {
    detail: { code: uid, source: "rfid", reader, at },
  })
);
```

`detail.source === "rfid"` lets consumers distinguish from USB-HID
barcode tokens (which use `source: "barcode"`).

## Packaging

```bash
npm run package:win     # NSIS installer
npm run package:mac     # DMG
npm run package:linux   # AppImage
```

Bundles Electron + the adapter for the platform. Plan to add code-
signing (Windows Authenticode + Apple notarisation) before venue
rollout; unsigned binaries trigger SmartScreen and Gatekeeper warnings
that confuse cashiers.

## What's NOT in this scaffold yet

- **Auto-update** — wire `electron-updater` once you have a GitHub
  release pipeline. The status window has space for a "Restart to
  update" banner.
- **Tray icon art** — currently a 1×1 transparent placeholder.
- **Mifare DESFire / NFC Type 2 tag support** — the ACR122U adapter
  reads the standard GET_DATA_UID APDU which covers Type A / Mifare
  Classic 4-byte UIDs (most venue wristbands). Type 2 (7-byte) and
  DESFire are a follow-up if your tag vendor supplies those.
- **Tag-write support** — current code is read-only. Writing app data
  to tags (locker IDs, F&B credit) would extend the adapter with
  `transmit()` calls for WRITE_BLOCK APDUs.
- **Multi-reader support** — if a till has two ACR122Us plugged in,
  only the first PICC reader is used. Generalise the adapter to
  enumerate all readers and surface them in the status panel.
