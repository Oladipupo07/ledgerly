export type InvoiceLineInput = {
  description: string;
  quantityMilli: bigint;
  unitPriceKobo: bigint;
};

// UI and JSON values use integer JavaScript numbers, so cap calculated totals
// at the largest API amount limit instead of risking unsafe Number rounding.
export const MAX_SAFE_KOBO = 9_000_000_000_000_000n;

/** API monetary values are decimal kobo strings and must remain exact in the UI. */
export function parsePositiveKobo(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,15}$/.test(value)) return null;
  try {
    const amount = BigInt(value);
    return amount <= MAX_SAFE_KOBO ? amount : null;
  } catch { return null; }
}

export function hasSameRequestFields(
  stored: Record<string, unknown>,
  requested: Record<string, unknown>,
): boolean {
  return Object.entries(requested).every(([field, value]) => stored[field] === value);
}

export function parseQuantityMilli(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  try {
    const quantity = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0") || "0");
    return quantity > 0n ? quantity : null;
  } catch { return null; }
}

/** Percent is a decimal string with up to two places (7.50 => 750 hundredths). */
export function parseTaxRateHundredths(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  try {
    const scaled = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
    return scaled <= 10000n ? scaled : null;
  } catch { return null; }
}

export function roundPositiveRatio(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new RangeError("Expected a non-negative ratio.");
  return (numerator + denominator / 2n) / denominator;
}

export function calculateInvoiceTotals(
  lines: InvoiceLineInput[],
  discountKobo: bigint,
  taxRateHundredths: bigint,
) {
  const subtotalKobo = lines.reduce(
    (total, line) => total + roundPositiveRatio(line.quantityMilli * line.unitPriceKobo, 1000n),
    0n,
  );
  if (subtotalKobo > MAX_SAFE_KOBO || discountKobo > subtotalKobo) return null;
  const taxableKobo = subtotalKobo - discountKobo;
  const taxKobo = roundPositiveRatio(taxableKobo * taxRateHundredths, 10000n);
  const totalKobo = taxableKobo + taxKobo;
  if (totalKobo > MAX_SAFE_KOBO) return null;
  return { subtotalKobo, taxableKobo, taxKobo, totalKobo };
}
