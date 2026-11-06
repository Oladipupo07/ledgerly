const NGN_PER_KOBO = 100;

/** Formats an exact integer-kobo amount. Use only at the display boundary. */
export function formatNgn(amountKobo: number): string {
  if (!Number.isSafeInteger(amountKobo)) throw new Error("Amount must be a safe integer number of kobo");
  return new Intl.NumberFormat("en-NG", {
    style: "currency", currency: "NGN", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amountKobo / NGN_PER_KOBO);
}

export function parseNairaToKobo(input: string): number {
  const normalized = input.trim().replaceAll(",", "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error("Enter a positive NGN amount with up to two decimal places");
  const [naira, fraction = ""] = normalized.split(".");
  const result = Number(naira) * NGN_PER_KOBO + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("Amount is too large");
  return result;
}
