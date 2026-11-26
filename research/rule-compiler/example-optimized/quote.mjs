export function quote(qty, tier) {
  if (![qty, tier].every(x => Number.isInteger(x) && x >= 0 && x <= 255)) throw RangeError("Expected uint8 inputs");
  return (qty * ((tier === 1) ? 95 : ((tier === 2) ? 90 : 100)));
}
