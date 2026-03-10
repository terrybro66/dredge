import OpenAI from "openai";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

// ── Schema & Types ────────────────────────────────────────────────────────────

const ALLOWED_PG_TYPES = [
  "text",
  "integer",
  "bigint",
  "boolean",
  "double precision",
  "jsonb",
  "timestamptz",
] as const;

const AddColumnSchema = z.object({
  op: z.literal("ADD_COLUMN"),
  table: z.literal("crime_results"),
  column: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/, "Column must be snake_case lowercase"),
  type: z.enum(ALLOWED_PG_TYPES, {
    error: `Schema LLM suggested disallowed type`,
  }),
});

export type SchemaOp = { op: "USE_EXISTING" } | z.infer<typeof AddColumnSchema>;

// Safe ALTER TABLE pattern: only ADD COLUMN, known table, safe identifier chars
const SAFE_ALTER_REGEX =
  /^ALTER TABLE "?crime_results"? ADD COLUMN "?([a-z_][a-z0-9_]*)"? (text|integer|bigint|boolean|double precision|jsonb|timestamptz)$/i;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ColumnInfo {
  column_name: string;
  data_type: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

function getClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com",
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getCurrentColumns(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<ColumnInfo[]>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'crime_results'
    ORDER BY ordinal_position
  `;
  return rows.map((r) => r.column_name);
}

function findNewKeys(
  sampleRow: Record<string, unknown>,
  existingColumns: string[],
): string[] {
  const existing = new Set(existingColumns);
  return Object.keys(sampleRow).filter((key) => !existing.has(key));
}

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

Allowed Postgres types: ${ALLOWED_PG_TYPES.join(", ")}

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

  const result = AddColumnSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(result.error.issues[0].message);
  }

  return result.data;
}

// ── Main exports ──────────────────────────────────────────────────────────────

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
