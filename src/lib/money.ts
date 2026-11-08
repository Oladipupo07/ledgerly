const KOBO_PER_NAIRA = 100;

/**
 * Formats an exact integer-kobo amount in NGN (₦).
 * Uses integer arithmetic prior to display formatting.
 */
export function formatNgn(amountKobo: number, options?: { compact?: boolean; showSign?: boolean }): string {
  if (!Number.isSafeInteger(amountKobo)) {
    throw new Error("Amount must be a safe integer number of kobo");
  }
  const absKobo = Math.abs(amountKobo);
  const sign = amountKobo < 0 ? "−" : options?.showSign && amountKobo > 0 ? "+" : "";

  if (options?.compact && absKobo >= 100_000_00) {
    const millions = absKobo / (1_000_000 * KOBO_PER_NAIRA);
    if (millions >= 1) {
      return `${sign}₦${millions.toFixed(2)}M`;
    }
    const thousands = absKobo / (1_000 * KOBO_PER_NAIRA);
    return `${sign}₦${thousands.toFixed(0)}k`;
  }

  const formatted = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absKobo / KOBO_PER_NAIRA);

  return `${sign}${formatted}`;
}

/**
 * Parses a user-entered Naira string (e.g. "145,000.50") into integer kobo.
 * Rejects floating-point imprecision, negative inputs, or more than 2 decimal places.
 */
export function parseNairaToKobo(input: string): number {
  const normalized = input.trim().replaceAll(",", "").replace(/^₦\s*/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter a valid positive NGN amount with up to 2 decimal places (e.g. 25000 or 25000.50)");
  }
  const [nairaPart, koboPart = ""] = normalized.split(".");
  const naira = Number(nairaPart);
  const kobo = Number(koboPart.padEnd(2, "0"));
  const totalKobo = naira * KOBO_PER_NAIRA + kobo;
  if (!Number.isSafeInteger(totalKobo) || totalKobo <= 0) {
    throw new Error("Amount must be greater than ₦0.00 and within safe calculation limits");
  }
  return totalKobo;
}

/**
 * Parses a signed CSV amount string into integer kobo and direction.
 */
export function parseSignedCsvAmountToKobo(input: string, decimalSeparator: "." | "," = "."): { amountKobo: number; isNegative: boolean } {
  let raw = input.trim().replace(/[₦NGN\s]/gi, "");
  const isParenNegative = raw.startsWith("(") && raw.endsWith(")");
  if (isParenNegative) {
    raw = raw.slice(1, -1);
  }
  const isNegative = isParenNegative || raw.startsWith("-");
  raw = raw.replace(/^[+-]/, "");

  if (decimalSeparator === ",") {
    raw = raw.replaceAll(".", "").replace(",", ".");
  } else {
    raw = raw.replaceAll(",", "");
  }

  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error(`Invalid monetary value "${input}"`);
  }
  const [nairaPart, koboPart = ""] = raw.split(".");
  const totalKobo = Number(nairaPart) * KOBO_PER_NAIRA + Number(koboPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(totalKobo) || totalKobo === 0) {
    throw new Error(`Monetary value must be non-zero: "${input}"`);
  }
  return { amountKobo: totalKobo, isNegative };
}
