import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SchemaOp =
  | { op: "USE_EXISTING" }
  | { op: "ADD_COLUMN"; table: string; column: string; type: string };

interface ColumnInfo {
  column_name: string;
  data_type: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_PG_TYPES = new Set([
  "text",
  "integer",
  "bigint",
  "boolean",
  "double precision",
  "jsonb",
  "timestamptz",
]);

// Safe ALTER TABLE pattern: only ADD COLUMN, known table, safe identifier chars
const SAFE_ALTER_REGEX =
  /^ALTER TABLE "?crime_results"? ADD COLUMN "?([a-z_][a-z0-9_]*)"? (text|integer|bigint|boolean|double precision|jsonb|timestamptz)$/i;

// ── Client ────────────────────────────────────────────────────────────────────

function getClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com",
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fetch current column names on the CrimeResult table directly from
 * information_schema so we don't rely on Prisma's generated types.
 */
async function getCurrentColumns(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<ColumnInfo[]>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'crime_results'
    ORDER BY ordinal_position
  `;
  return rows.map((r) => r.column_name);
}

/**
 * Find keys in sampleRow that don't exist as columns yet.
 */
function findNewKeys(
  sampleRow: Record<string, unknown>,
  existingColumns: string[],
): string[] {
  const existing = new Set(existingColumns);
  return Object.keys(sampleRow).filter((key) => !existing.has(key));
}

/**
 * Ask DeepSeek which Postgres type best fits each new key,
 * and return a single SchemaOp for the first new key.
 * (One migration per query keeps ALTER TABLE logic simple.)
 */
async function askLlmForSchemaOp(
  newKeys: string[],
  sampleRow: Record<string, unknown>,
): Promise<SchemaOp> {
  const client = getClient();

  const sampleValues = Object.fromEntries(
    newKeys.map((k) => [k, sampleRow[k]]),
  );

  const prompt = `You are a Postgres schema assistant.

A crime data table needs new columns. Given these new field names and sample values, return a SchemaOp JSON object for the FIRST field only.

New fields and sample values:
${JSON.stringify(sampleValues, null, 2)}

Allowed Postgres types: ${[...ALLOWED_PG_TYPES].join(", ")}

Return ONLY this JSON, no prose:
{
  "op": "ADD_COLUMN",
  "table": "crime_results",
  "column": "<snake_case_column_name>",
  "type": "<postgres_type>"
}

Rules:
- column must be snake_case, lowercase, no spaces
- type must be one of the allowed types above
- prefer "text" for strings, "integer" for whole numbers, "double precision" for decimals, "boolean" for booleans, "jsonb" for objects/arrays`;

  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error("Schema LLM returned no content");
  }

  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Schema LLM returned invalid JSON: ${cleaned}`);
  }

  const obj = parsed as Record<string, unknown>;

  if (
    obj["op"] !== "ADD_COLUMN" ||
    !obj["table"] ||
    !obj["column"] ||
    !obj["type"]
  ) {
    throw new Error(`Schema LLM returned incomplete op: ${cleaned}`);
  }

  if (!ALLOWED_PG_TYPES.has(obj["type"] as string)) {
    throw new Error(`Schema LLM suggested disallowed type: "${obj["type"]}"`);
  }

  return {
    op: "ADD_COLUMN",
    table: obj["table"] as string,
    column: obj["column"] as string,
    type: obj["type"] as string,
  };
}

// ── Main exports ──────────────────────────────────────────────────────────────

/**
 * Inspect the current schema and decide what operation (if any) is needed.
 * Never calls the LLM if no new columns are required.
 */
export async function decideSchemaOp(
  prisma: PrismaClient,
  sampleRow: Record<string, unknown>,
): Promise<SchemaOp> {
  const existingColumns = await getCurrentColumns(prisma);
  const newKeys = findNewKeys(sampleRow, existingColumns);

  if (newKeys.length === 0) {
    return { op: "USE_EXISTING" };
  }

  return askLlmForSchemaOp(newKeys, sampleRow);
}

/**
 * Apply a SchemaOp to the database.
 * Validates the generated SQL against a safe pattern before executing.
 */
export async function applySchemaOp(
  prisma: PrismaClient,
  op: SchemaOp,
  triggeredBy: string,
): Promise<void> {
  if (op.op === "USE_EXISTING") {
    return;
  }

  const sql = `ALTER TABLE "crime_results" ADD COLUMN "${op.column}" ${op.type}`;

  if (!SAFE_ALTER_REGEX.test(sql)) {
    throw new Error(`Unsafe ALTER TABLE SQL rejected: ${sql}`);
  }

  await prisma.$executeRawUnsafe(sql);

  await prisma.schemaVersion.create({
    data: {
      table_name: op.table,
      column_name: op.column,
      column_type: op.type,
      triggered_by: triggeredBy,
    },
  });
}
