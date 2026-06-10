#!/usr/bin/env python3
"""
Movira PC/SC reader helper.

Spawned by the Electron sidecar as a child process. Reads tags via
pyscard (which has prebuilt Windows wheels — no compiler needed) and
emits one JSON line per event to stdout. The sidecar's `pcsc-python`
adapter parses each line and turns it back into a scan event.

Why this exists: getting @pokusew/pcsclite to compile on a fresh
Windows dev machine needs the Visual Studio C++ Build Tools (a ~2 GB
download + 20-30 min install). pyscard ships prebuilt — `pip install
pyscard` and you're scanning in 30 seconds.

Output protocol (one JSON object per line, no batching):
  {"type": "status", "state": "no_readers"}
  {"type": "status", "state": "ready", "reader": "ACS ACR122 0 PICC Interface"}
  {"type": "scan",   "uid":   "04A53C1F"}
  {"type": "error",  "msg":   "..."}

Stderr is reserved for unstructured Python tracebacks.
"""

import json
import sys
import time

try:
    from smartcard.System import readers
    from smartcard.util import toHexString
    from smartcard.CardConnection import CardConnection
    from smartcard.Exceptions import (
        NoCardException,
        CardConnectionException,
        SmartcardException,
    )
except ImportError:
    sys.stderr.write(
        "pyscard not installed. Run: pip install pyscard\n"
    )
    sys.stdout.write(json.dumps({"type": "error", "msg": "pyscard_missing"}) + "\n")
    sys.stdout.flush()
    sys.exit(2)


GET_DATA_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]


def emit(obj):
    """Write one JSON line to stdout and flush immediately so the
    parent sidecar gets each event without buffering delay."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def pick_picc_reader(reader_list):
    """ACR122U typically exposes two readers — pick the PICC one.
    Other PC/SC readers expose just one; the regex falls through."""
    for r in reader_list:
        name = str(r)
        if "PICC" in name.upper() or "ACR122" in name.upper():
            return r
    return reader_list[0] if reader_list else None


def main():
    last_uid = None
    last_uid_at = 0.0
    current_reader_name = None

    while True:
        try:
            reader_list = readers()
            if not reader_list:
                emit({"type": "status", "state": "no_readers"})
                time.sleep(2)
                continue

            reader = pick_picc_reader(reader_list)
            if reader is None:
                emit({"type": "status", "state": "no_picc_reader"})
                time.sleep(2)
                continue

            reader_name = str(reader)
            if reader_name != current_reader_name:
                current_reader_name = reader_name
                emit({"type": "status", "state": "ready", "reader": reader_name})

            # Open connection on each poll loop. The ACR122U doesn't
            # support persistent connections without a card present;
            # connect-on-demand is the documented approach.
            connection = reader.createConnection()
            try:
                connection.connect(CardConnection.T0_protocol | CardConnection.T1_protocol)
                data, sw1, sw2 = connection.transmit(GET_DATA_UID)
                if (sw1, sw2) == (0x90, 0x00) and data:
                    uid = "".join(f"{b:02X}" for b in data)
                    now = time.time()
                    # Debounce: if the same UID was just emitted in the
                    # last second, treat it as a held card and skip the
                    # duplicate. The user lifting and re-tapping starts
                    # a fresh emit.
                    if uid != last_uid or (now - last_uid_at) > 1.0:
                        emit({"type": "scan", "uid": uid})
                        last_uid = uid
                        last_uid_at = now
            except NoCardException:
                # No card present this poll cycle — perfectly normal.
                last_uid = None
            except (CardConnectionException, SmartcardException) as e:
                # Card pulled mid-read, comms glitch, etc. Reset and try again.
                last_uid = None
                # Don't spam status; only emit if persistent.
            finally:
                try:
                    connection.disconnect()
                except Exception:
                    pass

            # Tight loop — 100 ms is responsive without busy-waiting.
            time.sleep(0.1)

        except KeyboardInterrupt:
            emit({"type": "status", "state": "stopping"})
            return
        except Exception as e:
            # Top-level safety net: surface to stderr, keep running.
            sys.stderr.write(f"[pcsc_reader] {type(e).__name__}: {e}\n")
            emit({"type": "error", "msg": str(e)})
            time.sleep(1)


if __name__ == "__main__":
    main()
