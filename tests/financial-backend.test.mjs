import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTypeScript(relativePath) {
  const filename = join(__dirname, "..", relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRef = { exports: {} };
  new Function("exports", "require", "module", javascript)(moduleRef.exports, () => { throw new Error("Unexpected require"); }, moduleRef);
  return moduleRef.exports;
}

const financial = loadTypeScript("src/lib/financial-backend.ts");
const tenant = loadTypeScript("src/lib/tenant.ts");
const csvImport = loadTypeScript("src/lib/csv-import.ts");
const csv = loadTypeScript("src/lib/csv.ts");

test("parses decimal quantities into thousandths without floating point", () => {
  assert.equal(financial.parseQuantityMilli("2.375"), 2375n);
  assert.equal(financial.parseQuantityMilli("0.000"), null);
  assert.equal(financial.parseQuantityMilli("1.0000"), null);
  assert.equal(financial.parseQuantityMilli("1e3"), null);
});

test("parses bounded tax percentages exactly", () => {
  assert.equal(financial.parseTaxRateHundredths("7.50"), 750n);
  assert.equal(financial.parseTaxRateHundredths("100.01"), null);
  assert.equal(financial.parseTaxRateHundredths("2.345"), null);
});

test("accepts only positive kobo amounts that remain exact in JavaScript clients", () => {
  assert.equal(financial.parsePositiveKobo("9000000000000000"), 9000000000000000n);
  assert.equal(financial.parsePositiveKobo("9000000000000001"), null);
  assert.equal(financial.parsePositiveKobo("0"), null);
  assert.equal(financial.parsePositiveKobo("1e6"), null);
});

test("transaction create retries still match after posting changes the stored status", () => {
  const requested = { date: "2026-11-10", description: "Sale", type: "income", amountKobo: "10000", direction: "inflow" };
  const stored = { ...requested, status: "posted" };
  assert.equal(financial.hasSameRequestFields(stored, requested), true);
  assert.equal(financial.hasSameRequestFields({ ...stored, amountKobo: "10001" }, requested), false);
});

test("calculates invoice kobo totals with integer rounding", () => {
  const result = financial.calculateInvoiceTotals([
    { quantityMilli: 1500n, unitPriceKobo: 101n },
    { quantityMilli: 1000n, unitPriceKobo: 200n },
  ], 50n, 750n);
  assert.deepEqual(result, { subtotalKobo: 352n, taxableKobo: 302n, taxKobo: 23n, totalKobo: 325n });
});

test("rejects discounts above subtotal and totals beyond the database range", () => {
  assert.equal(financial.calculateInvoiceTotals([{ quantityMilli: 1000n, unitPriceKobo: 100n }], 101n, 0n), null);
  assert.equal(financial.calculateInvoiceTotals([{ quantityMilli: 1000000000000n, unitPriceKobo: 10000000000000000n }], 0n, 0n), null);
});

test("database migration enables forced tenant RLS and immutable posted rows", () => {
  const migration = fs.readFileSync(join(__dirname, "..", "db/migrations/002_mvp_modules_and_rls.sql"), "utf8");
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /transactions_author_insert/);
  assert.match(migration, /Posted transactions are immutable/);
  assert.match(migration, /NEW\.notes IS DISTINCT FROM OLD\.notes/);
  assert.match(migration, /CREATE POLICY membership_invites_invitee_select/);
  assert.equal((migration.match(/DROP POLICY membership_invites_member_select/g) ?? []).length, 1);
});

test("role capabilities keep bookkeeping and read-only access separate", () => {
  assert.equal(tenant.hasCapability("owner", "workspace:manage_members"), true);
  assert.equal(tenant.hasCapability("bookkeeper", "transaction:post"), true);
  assert.equal(tenant.hasCapability("bookkeeper", "workspace:manage_members"), false);
  assert.equal(tenant.hasCapability("accountant", "report:export"), true);
  assert.equal(tenant.hasCapability("accountant", "transaction:create_edit"), false);
});

test("CSV parser handles quoted delimiters and escaped quotes", () => {
  assert.deepEqual(csvImport.parseCsv('Date,Description,Amount\r\n01/02/2026,"POS, Shop ""A""","1,234.50"'), [
    ["Date", "Description", "Amount"],
    ["01/02/2026", "POS, Shop \"A\"", "1,234.50"],
  ]);
  assert.equal(csvImport.parseCsv('a,b\n"unterminated,c'), null);
});

test("CSV normalization uses explicit date and decimal conventions with integer kobo", () => {
  const mapping = { date: 0, description: 1, amount: 2, direction: 3 };
  const dmy = { dateFormat: "dmy", decimalSeparator: "." };
  assert.deepEqual(csvImport.normalizeCsvRow(["05/11/2026", "Shop", "1,250.75", "debit"], mapping, dmy), {
    date: "2026-11-05", description: "Shop", amountKobo: "125075", direction: "outflow", reference: null,
  });
  assert.equal(csvImport.normalizeCsvRow(["31/02/2026", "Bad", "12.00", "credit"], mapping, dmy), null);
  assert.equal(csvImport.normalizeCsvRow(["05/11/2026", "Bad", "-12.00", "credit"], mapping, dmy), null);
});

test("CSV report cells prevent spreadsheet formula injection while preserving numeric values", () => {
  assert.equal(csv.csvCell('=HYPERLINK("https://example.invalid")'), `"'=HYPERLINK(""https://example.invalid"")"`);
  assert.equal(csv.csvCell("-12345"), `"-12345"`);
  assert.equal(csv.csvCell("+SUM(A1:A2)"), `"'+SUM(A1:A2)"`);
});

test("003_mvp_completion migration enforces RLS on user_sessions and feedback_submissions and protects attachment_name", () => {
  const migration3 = fs.readFileSync(join(__dirname, "..", "db/migrations/003_mvp_completion.sql"), "utf8");
  assert.match(migration3, /CREATE TABLE IF NOT EXISTS user_sessions/);
  assert.match(migration3, /ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY/);
  assert.match(migration3, /CREATE TABLE IF NOT EXISTS feedback_submissions/);
  assert.match(migration3, /ALTER TABLE feedback_submissions FORCE ROW LEVEL SECURITY/);
  assert.match(migration3, /NEW\.attachment_name IS DISTINCT FROM OLD\.attachment_name/);
  assert.match(migration3, /REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM ledgerly_app/);
});

