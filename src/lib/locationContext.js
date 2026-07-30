function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function resolveCashierLocationId({
  pairedTerminal,
  authLocations = [],
  cookieLocationId,
} = {}) {
  return (
    positiveId(pairedTerminal?.locationId) ||
    positiveId(authLocations?.[0]?.locationId) ||
    positiveId(cookieLocationId)
  );
}
