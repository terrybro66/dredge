import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./db";

// Columns already defined on CrimeResult in the base schema
const KNOWN_COLUMNS = new Set([
  "id",
  "queryId",
  "category",
  "street",
  "month",
  "latitude",
  "longitude",
  "raw",
  "createdAt",
]);

export type SchemaOp =
  | { type: "USE_EXISTING" }
  | { type: "ADD_COLUMN"; column: string; sqlType: string; sql: string };

const SAFE_SQL_PATTERN =
  /^ALTER TABLE "[A-Za-z]+" ADD COLUMN IF NOT EXISTS "[a-z_]+" (TEXT|NUMERIC|BOOLEAN|JSONB|TIMESTAMPTZ);$/;

export async function decideSchemaOp(
  sampleRow: Record<string, unknown>,
): Promise<SchemaOp> {
  const newKeys = Object.keys(sampleRow).filter((k) => !KNOWN_COLUMNS.has(k));

  if (newKeys.length === 0) {
    return { type: "USE_EXISTING" };
  }

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `
You are a database schema assistant. The CrimeResult table has new keys that are not yet columns.
New keys found: ${JSON.stringify(newKeys)}
Pick the single most important new column to add.
Respond with ONLY a JSON object (no markdown) in this exact shape:
{
  "type": "ADD_COLUMN",
  "column": "<column_name_snake_case>",
  "sqlType": "<TEXT|NUMERIC|BOOLEAN|JSONB|TIMESTAMPTZ>",
  "sql": "ALTER TABLE \\"CrimeResult\\" ADD COLUMN IF NOT EXISTS \\"<column_name>\\" <SQL_TYPE>;"
}
        `.trim(),
      },
    ],
  });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  return JSON.parse(text) as SchemaOp;
}

export async function applySchemaOp(
  op: SchemaOp,
  triggeredBy: string,
): Promise<void> {
  if (op.type === "USE_EXISTING") return;

  const { sql } = op;

  if (!SAFE_SQL_PATTERN.test(sql)) {
    throw new Error(`Unsafe or malformed SQL rejected: ${sql}`);
  }

  await prisma.$executeRawUnsafe(sql);

  await prisma.schemaVersion.create({
    data: { triggeredBy, sql },
  });
}
