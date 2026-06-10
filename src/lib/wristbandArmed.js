// Tiny module-level registry of "armed-for-bind" participant IDs.
//
// Multiple places dispatch and listen for `cashier:scan` events:
//   • The check-in gate-lookup listener at CheckIn top-level.
//   • The per-ticket Bind affordance that arms a specific participant.
//
// When a ticket row is armed, the next RFID scan should bind to that
// participant — NOT trigger the gate-lookup flow (which would 404 on
// the unbound UID and clobber the success toast with a "wristband not
// recognised" error).
//
// This registry lets unrelated components coordinate without lifting
// state through 6 levels of props. Listeners check `isAnyArmed()`
// before acting; arming components push/pop their participant id.
//
// State is plain in-memory; not Redux. The registry is per-tab.

"use strict";

const armed = new Set();

export function armParticipant(participantId) {
  if (participantId == null) return;
  armed.add(Number(participantId));
}

export function disarmParticipant(participantId) {
  armed.delete(Number(participantId));
}

export function isAnyArmed() {
  return armed.size > 0;
}

export function disarmAll() {
  armed.clear();
}
