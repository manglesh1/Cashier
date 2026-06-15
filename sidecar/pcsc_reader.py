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
    from smartcard.CardMonitoring import CardMonitor, CardObserver
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
# Hold-down debounce: if the same UID fires twice within this window,
# the second emit is dropped. 250 ms is long enough to coalesce the
# inevitable double-fire when a tag jiggles on the reader, short
# enough that lift-and-retap (~400 ms human cadence) still emits.
HOLD_DEBOUNCE_MS = 250


def emit(obj):
    """Write one JSON line to stdout and flush immediately so the
    parent sidecar gets each event without buffering delay."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def read_uid(card):
    """Connect to the card, transmit GET DATA UID, return the UID as
    uppercase hex or None on failure. Always disconnects."""
    connection = card.createConnection()
    try:
        connection.connect(CardConnection.T0_protocol | CardConnection.T1_protocol)
        data, sw1, sw2 = connection.transmit(GET_DATA_UID)
        if (sw1, sw2) == (0x90, 0x00) and data:
            return "".join(f"{b:02X}" for b in data)
        return None
    except (NoCardException, CardConnectionException, SmartcardException):
        return None
    finally:
        try:
            connection.disconnect()
        except Exception:
            pass


class TagObserver(CardObserver):
    """Event-driven card observer. pyscard fires `update` the instant a
    card is inserted into ANY connected reader — no polling, no per-cycle
    reconnect. This trims ~100ms of perceived latency off every tap
    versus the previous poll-based implementation."""

    def __init__(self):
        self.last_uid = None
        self.last_uid_at_ms = 0

    def update(self, observable, actions):
        added, _removed = actions
        for card in added:
            uid = read_uid(card)
            if not uid:
                continue
            now_ms = int(time.time() * 1000)
            # Debounce same-UID double-emit (tag jiggle, OS-level
            # spurious insert events).
            if uid == self.last_uid and (now_ms - self.last_uid_at_ms) < HOLD_DEBOUNCE_MS:
                continue
            self.last_uid = uid
            self.last_uid_at_ms = now_ms
            emit({"type": "scan", "uid": uid})


def main():
    # Surface initial reader-status so the sidecar status panel reflects
    # whether the ACS driver is installed and the reader is plugged in.
    reader_list = readers()
    if not reader_list:
        emit({"type": "status", "state": "no_readers"})
    else:
        emit({"type": "status", "state": "ready", "reader": str(reader_list[0])})

    monitor = CardMonitor()
    observer = TagObserver()
    monitor.addObserver(observer)

    try:
        # Park the main thread; the CardMonitor runs on its own thread
        # and calls observer.update on tag events. We only wake to surface
        # status changes if the reader population shifts.
        last_reader_count = len(reader_list)
        while True:
            time.sleep(2.0)
            current = readers()
            if len(current) != last_reader_count:
                last_reader_count = len(current)
                if not current:
                    emit({"type": "status", "state": "no_readers"})
                else:
                    emit({"type": "status", "state": "ready", "reader": str(current[0])})
    except KeyboardInterrupt:
        emit({"type": "status", "state": "stopping"})
    finally:
        try:
            monitor.deleteObserver(observer)
        except Exception:
            pass


if __name__ == "__main__":
    main()
