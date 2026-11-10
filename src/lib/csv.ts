/** Quote CSV cells and neutralize spreadsheet formulas in user-controlled text. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const formulaLike = /^[\u0000-\u0020]*[=+@-]/.test(text);
  const plainNumber = /^-?\d+(?:\.\d+)?$/.test(text);
  const safeText = formulaLike && !plainNumber ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}
