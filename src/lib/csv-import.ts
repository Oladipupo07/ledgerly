export type CsvMapping = { date: number; description: number; amount: number; direction?: number; reference?: number };
export type CsvOptions = { dateFormat: "iso" | "dmy" | "mdy"; decimalSeparator: "." | "," };
export type ImportedRow = { date: string; description: string; amountKobo: string; direction: "inflow" | "outflow"; reference: string | null };

export function parseCsv(text: string, maxRows = 1001, maxColumns = 100): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") {
      row.push(cell); cell = "";
      if (row.length > maxColumns) return null;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.length > maxColumns || rows.length >= maxRows) return null;
      if (row.some((value) => value.length > 10_000)) return null;
      rows.push(row); row = [];
    } else cell += char;
    if (cell.length > 10_000) return null;
  }
  if (quoted) return null;
  if (cell.length || row.length) {
    row.push(cell);
    if (row.length > maxColumns || rows.length >= maxRows || row.some((value) => value.length > 10_000)) return null;
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((value) => value.trim() === "")) rows.pop();
  return rows;
}

function parseDate(value: string, format: CsvOptions["dateFormat"]): string | null {
  const normalized = value.trim();
  if (format === "iso") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
    const date = new Date(`${normalized}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === normalized ? normalized : null;
  }
  const parts = normalized.split(/[./-]/);
  if (parts.length !== 3 || parts.some((part) => !/^\d{1,4}$/.test(part))) return null;
  const [first, second, third] = parts;
  const year = format === "dmy" ? third : first.length === 4 ? first : third;
  const month = format === "dmy" ? second : first.length === 4 ? second : first;
  const day = format === "dmy" ? first : first.length === 4 ? third : second;
  if (year.length !== 4) return null;
  const iso = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

function parseAmount(value: string, decimalSeparator: CsvOptions["decimalSeparator"]): { amount: bigint; negative: boolean } | null {
  let text = value.trim().replace(/[₦\s]/g, "");
  const negative = text.startsWith("-") || (text.startsWith("(") && text.endsWith(")"));
  if (text.startsWith("(") && text.endsWith(")")) text = text.slice(1, -1);
  if (text.startsWith("-") || text.startsWith("+")) text = text.slice(1);
  const groupSeparator = decimalSeparator === "." ? "," : ".";
  text = text.replaceAll(groupSeparator, "");
  if (decimalSeparator === ",") text = text.replace(",", ".");
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return amount > 0n && amount <= 9_000_000_000_000_000n ? { amount, negative } : null;
}

export function normalizeCsvRow(cells: string[], mapping: CsvMapping, options: CsvOptions): ImportedRow | null {
  const fields = [mapping.date, mapping.description, mapping.amount, mapping.direction, mapping.reference]
    .filter((index): index is number => index !== undefined);
  if (fields.some((index) => !Number.isInteger(index) || index < 0 || index >= cells.length)) return null;
  const date = parseDate(cells[mapping.date], options.dateFormat);
  const description = cells[mapping.description].trim();
  const parsedAmount = parseAmount(cells[mapping.amount], options.decimalSeparator);
  const reference = mapping.reference === undefined ? "" : cells[mapping.reference].trim();
  if (!date || !description || description.length > 240 || !parsedAmount || reference.length > 120) return null;
  let direction: "inflow" | "outflow" = parsedAmount.negative ? "outflow" : "inflow";
  if (mapping.direction !== undefined) {
    const value = cells[mapping.direction].trim().toLowerCase();
    if (["inflow", "income", "credit", "cr", "in"].includes(value)) {
      if (parsedAmount.negative) return null;
      direction = "inflow";
    }
    else if (["outflow", "expense", "debit", "dr", "out"].includes(value)) direction = "outflow";
    else return null;
  }
  return { date, description, amountKobo: parsedAmount.amount.toString(), direction, reference: reference || null };
}
