// =============================================================================
// DREDGE — SINGLE FILE LEARNING GUIDE
// =============================================================================
//
// This file condenses the entire orchestrator into one place so you can read
// the full pipeline from top to bottom without jumping between files.
//
// In the real codebase each section below lives in its own file:
//
//   ┌─────────────────────────────────────────────────────────┐
//   │  Section in this file   →   Real file                   │
//   │─────────────────────────────────────────────────────────│
//   │  1. Types                →   intent.ts / fetcher.ts     │
//   │  2. Database singleton   →   db.ts                      │
//   │  3. Intent parser        →   intent.ts                  │
//   │  4. API fetcher          →   fetcher.ts                 │
//   │  5. Schema evolution     →   schema.ts                  │
//   │  6. Results store        →   store.ts                   │
//   │  7. Query pipeline       →   query.ts                   │
//   │  8. Express server       →   index.ts                   │
//   └─────────────────────────────────────────────────────────┘
//
// HOW TO READ THIS FILE
// ─────────────────────
// Read it top to bottom. Each section starts with a plain-English explanation
// of what it does and why, followed by the actual code.
//
// DO NOT run this file as-is. It is a teaching document.
// Dependencies you would need: express, axios, @prisma/client, openai, dotenv
//
// =============================================================================

import dotenv from "dotenv";
dotenv.config(); // Load .env values (DEEPSEEK_API_KEY, DATABASE_URL, PORT) first
// before any other imports that might read process.env

import express, { Router, Request, Response } from "express";
import cors from "cors";
import axios from "axios";
import OpenAI from "openai"; // We use the OpenAI SDK pointed at DeepSeek's
// API — DeepSeek is OpenAI-compatible, so the
// same SDK works with a different baseURL
import { PrismaClient } from "@prisma/client";

// =============================================================================
// SECTION 1 — TYPES
// =============================================================================
//
// TypeScript interfaces describe the "shape" of data objects.
// Defining them here lets the compiler catch mistakes before the code runs —
// if you try to read a property that doesn't exist, tsc will error immediately.
//
// There are two important shapes in this system:
//   QueryPlan  — what the AI extracts from the user's sentence
//   RawCrime   — what the UK Police API returns for each crime record

// QueryPlan: the structured output of the AI intent parser.
// Every field maps directly to a parameter the Police API needs.
interface QueryPlan {
  category: CrimeCategory; // Which type of crime to query (see list below)
  date: string; // "YYYY-MM" — the Police API only accepts month-level dates
  poly: string; // "lat,lng:lat,lng:..." — a polygon defining the search area
  viz_hint: VizHint; // Tells the frontend how to display results
}

// The Police API accepts these exact slug strings as the {category} URL segment.
// Using a union type (string | string | ...) means TypeScript will error if you
// accidentally pass a typo like "burgleries" instead of "burglary".
type CrimeCategory =
  | "all-crime"
  | "anti-social-behaviour"
  | "bicycle-theft"
  | "burglary"
  | "criminal-damage-arson"
  | "drugs"
  | "other-theft"
  | "possession-of-weapons"
  | "public-order"
  | "robbery"
  | "shoplifting"
  | "theft-from-the-person"
  | "vehicle-crime"
  | "violent-crime"
  | "other-crime";

// VizHint: a signal from the AI to the frontend about what visualisation fits best.
// "map" → show pins on a map; "bar" → a bar chart; "table" → a plain data table
type VizHint = "map" | "bar" | "table";

// RawCrime: one record as returned by the UK Police API.
// The API returns an array of these objects. Some fields are nullable (| null)
// because not every crime has a recorded outcome yet.
interface RawCrime {
  persistent_id: string;
  category: string;
  month: string;
  location_type: string;
  location_subtype: string;
  context: string;
  id: number;
  location: {
    latitude: string; // Note: the API returns lat/lng as strings, not numbers
    longitude: string;
    street: {
      id: number;
      name: string;
    };
  };
  outcome_status: {
    category: string;
    date: string;
  } | null; // null means no outcome has been recorded yet
}

// SchemaOp: describes whether the database schema needs changing.
// This is a "discriminated union" — the `op` field tells you which variant you have.
// Pattern:  if (op.op === "ADD_COLUMN") { /* op.column and op.type are available */ }
type SchemaOp =
  | { op: "USE_EXISTING" }
  | { op: "ADD_COLUMN"; table: string; column: string; type: string };

// =============================================================================
// SECTION 2 — DATABASE SINGLETON  (db.ts)
// =============================================================================
//
// PrismaClient is the object that lets us talk to PostgreSQL.
// Creating a new PrismaClient() opens a connection pool to the database.
//
// PROBLEM: In development, tools like `tsx watch` re-execute this file every time
// you save a change. If we just wrote `export const prisma = new PrismaClient()`
// at the top level, each hot-reload would create a brand-new connection pool,
// eventually exhausting the database's connection limit.
//
// SOLUTION: Store the client on `globalThis`. Global variables survive hot-reloads
// because Node keeps the same process alive. On the first run the client is created
// and stored; on subsequent runs the existing one is reused.
//
// In production (NODE_ENV === "production") this guard is skipped because production
// servers don't hot-reload — they restart entirely when deployed.

// We have to tell TypeScript that globalThis may have a `prisma` property,
// because TypeScript doesn't know about it by default.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const prisma = globalForPrisma.prisma ?? new PrismaClient();
//             ─────────────────────    ───────────────────
//             Use existing if present  Otherwise create new

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma; // Save it so the next hot-reload finds it
}

// =============================================================================
// SECTION 3 — INTENT PARSER  (intent.ts)
// =============================================================================
//
// The user types something like "show me knife crime in Hackney last October".
// We can't pass that directly to the Police API — the API needs structured data:
// a category slug, a YYYY-MM date string, and a lat/lng polygon.
//
// This section uses DeepSeek (an LLM) to extract that structure from free text.
// We send a carefully engineered system prompt that:
//   1. Lists all valid category slugs so the model picks an exact one
//   2. Explains the date and polygon formats required
//   3. Defines a Cambridge fallback polygon for when no location is mentioned
//   4. Demands JSON-only output so we can reliably parse the response
//
// After getting the response we:
//   - Strip any markdown fences the model may have added (```json ... ```)
//   - JSON.parse the result
//   - Validate every field before trusting it

// A lookup of every valid category slug → human-readable description.
// This is used to build the system prompt so the LLM knows its options.
const CRIME_CATEGORIES: Record<CrimeCategory, string> = {
  "all-crime": "All crime types combined",
  "anti-social-behaviour": "Anti-social behaviour",
  "bicycle-theft": "Bicycle theft",
  burglary: "Residential or commercial burglary",
  "criminal-damage-arson": "Criminal damage and arson",
  drugs: "Drug offences",
  "other-theft": "Theft not elsewhere classified",
  "possession-of-weapons": "Possession of weapons",
  "public-order": "Public order offences",
  robbery: "Robbery",
  shoplifting: "Shoplifting",
  "theft-from-the-person": "Theft from the person",
  "vehicle-crime": "Vehicle crime",
  "violent-crime": "Violence and sexual offences",
  "other-crime": "Other crime",
};

const VALID_VIZ_HINTS: VizHint[] = ["map", "bar", "table"];

// The system prompt tells the model exactly what we need.
// It is a function (not a constant) so it can be regenerated if needed.
function buildSystemPrompt(): string {
  // Build a bulleted list of category slugs from the lookup above
  const categoryList = Object.entries(CRIME_CATEGORIES)
    .map(([slug, desc]) => `  • "${slug}" — ${desc}`)
    .join("\n");

  return `You are a query parser for a UK crime data platform.

Given a natural-language question, extract a structured QueryPlan JSON object.

## Available crime categories (use exact slugs):
${categoryList}

## QueryPlan schema:
{
  "category": string,   // one of the slugs above; use "all-crime" if unclear
  "date":     string,   // "YYYY-MM" — if not specified, use the most recent full month
  "poly":     string,   // "lat,lng:lat,lng:lat,lng:lat,lng" — a bounding polygon
  "viz_hint": string    // "map" | "bar" | "table"
}

## viz_hint rules:
- "map"   → user asks where, geographic distribution, show on a map
- "bar"   → user asks how many, compare, breakdown, chart, graph
- "table" → user asks list, show me, what are the, details

## Default polygon (use this if no location is mentioned):
Cambridge: "52.17,-0.14:52.17,0.16:52.24,0.16:52.24,-0.14"

## Output rules:
- Respond with ONLY a valid JSON object — no prose, no markdown fences.
- All four keys must be present.
- "category" must be an exact slug from the list above.`;
}

// Strip markdown code fences that LLMs sometimes add around JSON responses.
// e.g. converts:  ```json\n{ ... }\n```  →  { ... }
function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

// Validate the raw parsed object has the correct shape before we trust it.
// Throws a descriptive error if anything is wrong — this is better than letting
// a bad object silently cause errors further down the pipeline.
function validateQueryPlan(raw: unknown): QueryPlan {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("LLM response was not an object");
  }

  const obj = raw as Record<string, unknown>;

  if (!obj["category"] || !obj["date"] || !obj["poly"] || !obj["viz_hint"]) {
    throw new Error("LLM response missing required fields");
  }

  if (
    typeof obj["category"] !== "string" ||
    !(obj["category"] in CRIME_CATEGORIES)
  ) {
    throw new Error(`Invalid category: "${obj["category"]}"`);
  }

  // YYYY-MM format check using a regular expression
  if (typeof obj["date"] !== "string" || !/^\d{4}-\d{2}$/.test(obj["date"])) {
    throw new Error(`Invalid date format: "${obj["date"]}"`);
  }

  // A polygon must contain at least one comma and one colon
  if (
    typeof obj["poly"] !== "string" ||
    !obj["poly"].includes(",") ||
    !obj["poly"].includes(":")
  ) {
    throw new Error(`Invalid poly: "${obj["poly"]}"`);
  }

  if (!VALID_VIZ_HINTS.includes(obj["viz_hint"] as VizHint)) {
    throw new Error(`Invalid viz_hint: "${obj["viz_hint"]}"`);
  }

  return {
    category: obj["category"] as CrimeCategory,
    date: obj["date"] as string,
    poly: obj["poly"] as string,
    viz_hint: obj["viz_hint"] as VizHint,
  };
}

// The main export: turn a raw user sentence into a structured QueryPlan.
async function parseIntent(rawText: string): Promise<QueryPlan> {
  if (!rawText || rawText.trim().length === 0) {
    throw new Error("Query text must not be empty");
  }

  // Instantiate the client here rather than at module level so that unit tests
  // can mock the OpenAI constructor before this function runs.
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com", // Point the OpenAI SDK at DeepSeek's endpoint
  });

  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    max_tokens: 256,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: rawText.trim() },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error("DeepSeek returned no content");
  }

  // Parse and validate — both steps can throw, which will bubble up to the
  // route handler and be returned as a 500 error to the client
  const rawJson = stripFences(text);
  const parsed = JSON.parse(rawJson); // Throws SyntaxError if not valid JSON
  return validateQueryPlan(parsed);
}

// =============================================================================
// SECTION 4 — UK POLICE API FETCHER  (fetcher.ts)
// =============================================================================
//
// The UK Police API (data.police.uk) is free and requires no API key.
// Given a crime category, a month, and a polygon, it returns an array of crime
// records that occurred inside that area during that month.
//
// URL pattern: https://data.police.uk/api/crimes-street/{category}
// Query params: date=YYYY-MM  &  poly=lat,lng:lat,lng:...
//
// IMPORTANT LIMIT: The API rejects polygons with more than 100 points.
// We validate this before making the request to give a clear error message
// rather than a cryptic 400 from the API.

const POLICE_API_BASE = "https://data.police.uk/api/crimes-street";
const MAX_POLY_POINTS = 100;

function validatePoly(poly: string): void {
  const points = poly.split(":").length;
  if (points > MAX_POLY_POINTS) {
    throw new Error(
      `Polygon has ${points} points — Police API limit is ${MAX_POLY_POINTS}`,
    );
  }
}

async function fetchCrimes(plan: QueryPlan): Promise<RawCrime[]> {
  validatePoly(plan.poly);

  const url = `${POLICE_API_BASE}/${plan.category}`;

  // axios.get<RawCrime[]> tells TypeScript what shape the response data will be.
  // The actual runtime check is up to us — TypeScript types are erased at runtime.
  const response = await axios.get<RawCrime[]>(url, {
    params: {
      date: plan.date,
      poly: plan.poly,
    },
  });

  return response.data;
}

// =============================================================================
// SECTION 5 — SCHEMA EVOLUTION  (schema.ts)
// =============================================================================
//
// The Police API occasionally changes — new fields appear, existing fields gain
// new sub-properties. Rather than hard-coding every possible column and migrating
// manually, this service detects new fields automatically and adds columns to the
// database without any developer intervention.
//
// HOW IT WORKS (step by step):
//   1. We look at a sample crime record from the current API response
//   2. We query PostgreSQL's information_schema to get the current column list
//   3. We diff: which keys in the sample don't exist as columns yet?
//   4. If no new keys → return USE_EXISTING immediately (no LLM needed)
//   5. If new keys exist → ask DeepSeek which Postgres type fits each one
//   6. Build an ALTER TABLE statement and validate it against a regex
//   7. Execute the statement and log it in the SchemaVersion table
//
// WHY VALIDATE THE SQL WITH A REGEX?
//   The SQL is built partly from LLM output. LLMs can hallucinate.
//   Before running any DDL (Data Definition Language — statements that change
//   the schema) we check it matches a known-safe pattern to prevent injection.
//
// NOTE ON THE SPEC:
//   The guide requires this exact safe pattern:
//   /^ALTER TABLE "[A-Za-z]+" ADD COLUMN IF NOT EXISTS "[a-z_]+" (TEXT|NUMERIC|BOOLEAN|JSONB|TIMESTAMPTZ);$/
//   The `IF NOT EXISTS` clause prevents errors if the migration runs twice
//   (e.g. on a retry). Without it, Postgres throws "column already exists".

// Only these Postgres types are allowed. The LLM must pick from this list.
const ALLOWED_PG_TYPES = new Set([
  "TEXT",
  "NUMERIC",
  "BOOLEAN",
  "JSONB",
  "TIMESTAMPTZ",
]);

// The regex every generated ALTER TABLE must match before execution.
// Breaking it down:
//   ALTER TABLE "crime_results"   — only this table is ever altered
//   ADD COLUMN IF NOT EXISTS      — safe re-run behaviour
//   "[a-z_]+"                     — column name must be snake_case lowercase
//   (TEXT|NUMERIC|...)            — type must be one of our allowed set
//   ;                             — must end with a semicolon
const SAFE_ALTER_REGEX =
  /^ALTER TABLE "[A-Za-z]+" ADD COLUMN IF NOT EXISTS "[a-z_]+" (TEXT|NUMERIC|BOOLEAN|JSONB|TIMESTAMPTZ);$/;

// Query information_schema to get the actual column names currently in the table.
// We use information_schema (a built-in Postgres view) rather than relying on
// the Prisma-generated types, because Prisma's types only reflect what was in the
// schema at the time `prisma generate` was last run — they don't reflect live
// ALTER TABLE statements that were run after that.
async function getCurrentColumns(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'crime_results'
    ORDER BY ordinal_position
  `;
  return rows.map((r) => r.column_name);
}

// Compare the keys of a sample row against the columns that exist in the DB.
// Returns only the keys that don't have a matching column yet.
function findNewKeys(
  sampleRow: Record<string, unknown>,
  existingColumns: string[],
): string[] {
  const existing = new Set(existingColumns);
  return Object.keys(sampleRow).filter((key) => !existing.has(key));
}

// Ask DeepSeek what Postgres type best fits each new field.
// We only process the FIRST new key per request to keep migrations atomic —
// one ALTER TABLE per query, rather than batching several at once.
// In production you'd want to loop and handle all new keys.
async function askLlmForSchemaOp(
  newKeys: string[],
  sampleRow: Record<string, unknown>,
): Promise<SchemaOp> {
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com",
  });

  // Only show the LLM the values for the new (unknown) keys
  const sampleValues = Object.fromEntries(
    newKeys.map((k) => [k, sampleRow[k]]),
  );

  const prompt = `You are a Postgres schema assistant.

A crime data table needs new columns. Given these new field names and sample values,
return a SchemaOp JSON object for the FIRST field only.

New fields and sample values:
${JSON.stringify(sampleValues, null, 2)}

Allowed Postgres types: ${[...ALLOWED_PG_TYPES].join(", ")}

Return ONLY this JSON, no prose:
{
  "op": "ADD_COLUMN",
  "table": "crime_results",
  "column": "<snake_case_column_name>",
  "type": "<POSTGRES_TYPE>"
}

Rules:
- column must be snake_case, lowercase, no spaces
- type must be one of the allowed types listed above (uppercase)
- prefer TEXT for strings, NUMERIC for numbers, BOOLEAN for booleans, JSONB for objects`;

  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("Schema LLM returned no content");

  // Strip fences and parse — same pattern as the intent parser
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  // Validate the LLM followed instructions before trusting the output
  if (
    parsed["op"] !== "ADD_COLUMN" ||
    !parsed["table"] ||
    !parsed["column"] ||
    !parsed["type"]
  ) {
    throw new Error(`Schema LLM returned incomplete op: ${cleaned}`);
  }
  if (!ALLOWED_PG_TYPES.has(parsed["type"] as string)) {
    throw new Error(
      `Schema LLM suggested disallowed type: "${parsed["type"]}"`,
    );
  }

  return {
    op: "ADD_COLUMN",
    table: parsed["table"] as string,
    column: parsed["column"] as string,
    type: parsed["type"] as string,
  };
}

// PUBLIC: Decide what schema change (if any) is needed.
async function decideSchemaOp(
  prisma: PrismaClient,
  sampleRow: Record<string, unknown>, // Should be the RAW crime object, not a hand-mapped subset
): Promise<SchemaOp> {
  const existingColumns = await getCurrentColumns(prisma);
  const newKeys = findNewKeys(sampleRow, existingColumns);

  if (newKeys.length === 0) {
    return { op: "USE_EXISTING" }; // Fast path — no LLM call needed
  }

  return askLlmForSchemaOp(newKeys, sampleRow);
}

// PUBLIC: Apply a SchemaOp to the live database.
async function applySchemaOp(
  prisma: PrismaClient,
  op: SchemaOp,
  triggeredBy: string, // queryId — used to trace which query caused the migration
): Promise<void> {
  if (op.op === "USE_EXISTING") return; // Nothing to do

  // Build the ALTER TABLE statement
  const sql = `ALTER TABLE "crime_results" ADD COLUMN IF NOT EXISTS "${op.column}" ${op.type};`;

  // SECURITY CHECK: Validate the SQL matches our safe pattern before running it.
  // $executeRawUnsafe does NO escaping — if we passed user input directly here
  // it would be a SQL injection vulnerability. The regex is our guard.
  if (!SAFE_ALTER_REGEX.test(sql)) {
    throw new Error(`Unsafe ALTER TABLE SQL rejected: ${sql}`);
  }

  await prisma.$executeRawUnsafe(sql);

  // Log the migration so we have an audit trail of all schema changes
  await prisma.schemaVersion.create({
    data: {
      table_name: op.table,
      column_name: op.column,
      column_type: op.type,
      triggered_by: triggeredBy,
    },
  });
}

// =============================================================================
// SECTION 6 — RESULTS STORE  (store.ts)
// =============================================================================
//
// After fetching crimes from the API we persist them to PostgreSQL so that:
//   - Results survive server restarts
//   - The GET /:id endpoint can return historical queries
//   - We can query and analyse the data with SQL later
//
// Key decisions:
//   - We parse latitude/longitude from strings to floats here (the API returns
//     them as strings like "51.5074", but storing them as NUMERIC lets us do
//     geospatial queries later)
//   - We store the full raw crime object in a `raw` JSONB column. This future-
//     proofs us: if the API adds a new field we haven't explicitly mapped, it's
//     still captured. JSONB in Postgres is queryable with operators like ->> and @>
//   - We use prisma.$transaction to insert all rows atomically — either all of
//     them succeed or none do, avoiding partial saves

async function storeResults(
  queryId: string,
  plan: QueryPlan,
  crimes: RawCrime[],
): Promise<void> {
  if (crimes.length === 0) return; // Nothing to insert

  const rows = crimes.map((crime) => ({
    query_id: queryId,
    persistent_id: crime.persistent_id,
    category: crime.category,
    month: crime.month,
    street: crime.location.street.name,
    latitude: parseFloat(crime.location.latitude), // string → number
    longitude: parseFloat(crime.location.longitude), // string → number
    outcome_category: crime.outcome_status?.category ?? null,
    outcome_date: crime.outcome_status?.date ?? null,
    location_type: crime.location_type,
    context: crime.context ?? null,
    raw: crime, // Full raw object stored as JSONB — don't skip this!
  }));

  // prisma.$transaction takes an array of Prisma operations and runs them all
  // inside a single SQL transaction. If any insert fails, the whole batch is
  // rolled back, leaving the database clean.
  await prisma.$transaction(
    rows.map((row) => prisma.crimeResult.create({ data: row })),
  );
}

// =============================================================================
// SECTION 7 — QUERY PIPELINE  (query.ts)
// =============================================================================
//
// This is the central controller. It wires together every section above into a
// single request/response cycle. Think of it as the conductor of an orchestra —
// it doesn't do the work itself, it calls the right functions in the right order.
//
// POST /query
// ───────────
// Step 1: Validate input — reject early if `text` is missing
// Step 2: parseIntent(text)           → QueryPlan (what to fetch)
// Step 3: prisma.query.create(...)    → persist the query record
// Step 4: fetchCrimes(plan)           → RawCrime[] (raw API data)
// Step 5: decideSchemaOp(sampleRow)   → SchemaOp (does the DB need a new column?)
// Step 6: applySchemaOp(op, queryId)  → run ALTER TABLE if needed
// Step 7: storeResults(...)           → write crime rows to DB
// Step 8: Return response             → capped at 100 results
//
// GET /query/:id
// ──────────────
// Look up a previously-run query and return it with all stored results.

const queryRouter = Router();

queryRouter.post("/", async (req: Request, res: Response) => {
  const { text } = req.body;

  // Step 1: Input validation — fail fast with a clear error
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res
      .status(400)
      .json({ error: "Request body must include a non-empty 'text' field" });
  }

  try {
    // Step 2: Parse the natural-language query into a structured plan
    const plan = await parseIntent(text);

    // Step 3: Persist the query so we can retrieve it later via GET /:id
    const queryRecord = await prisma.query.create({
      data: {
        text: text.trim(),
        category: plan.category,
        date: plan.date,
        poly: plan.poly,
        viz_hint: plan.viz_hint,
      },
    });

    // Step 4: Call the Police API
    const crimes = await fetchCrimes(plan);

    // Steps 5 & 6: Schema evolution — only runs if there are results to inspect.
    // IMPORTANT: Pass the raw crime object directly, not a hand-mapped subset.
    // Passing a subset would defeat the purpose — the diff would never find new
    // fields because you'd only pass fields you already know about.
    if (crimes.length > 0) {
      const sampleRow = { ...crimes[0] } as Record<string, unknown>;
      const schemaOp = await decideSchemaOp(prisma, sampleRow);
      await applySchemaOp(prisma, schemaOp, queryRecord.id);
    }

    // Step 7: Persist all crime records to the database
    await storeResults(queryRecord.id, plan, crimes);

    // Step 8: Return the response — cap results at 100 to avoid huge payloads.
    // Note: `count` reflects ALL crimes fetched and stored, not just the 100 returned.
    // The frontend uses count for summary stats, and results for display.
    return res.status(200).json({
      query_id: queryRecord.id,
      plan,
      count: crimes.length, // Total stored (could be thousands)
      viz_hint: plan.viz_hint,
      results: crimes.slice(0, 100), // Only send 100 to the frontend
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /query] error:", message);
    return res.status(500).json({ error: message });
  }
});

queryRouter.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // include: { results: true } tells Prisma to JOIN and return related CrimeResult rows
    const query = await prisma.query.findUnique({
      where: { id },
      include: { results: true },
    });

    if (!query) {
      return res.status(404).json({ error: `Query ${id} not found` });
    }

    return res.status(200).json(query);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /query/:id] error:", message);
    return res.status(500).json({ error: message });
  }
});

// =============================================================================
// SECTION 8 — EXPRESS SERVER  (index.ts)
// =============================================================================
//
// The entry point. This is what Node actually executes when you run `npm run dev`.
//
// It:
//   - Creates an Express application
//   - Registers middleware (cors and json body parsing)
//   - Mounts the query router at /query
//   - Adds a /health endpoint (useful for uptime monitoring and Docker healthchecks)
//   - Starts listening for HTTP connections
//
// Middleware runs in order for every request before it reaches a route handler.
// cors()           → adds headers that allow browser requests from other origins
//                    (e.g. the React app at localhost:3000 calling localhost:3001)
// express.json()   → parses the request body from raw JSON text into req.body

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

// Health check — returns immediately without touching the database.
// Useful for: Docker HEALTHCHECK, load balancer probes, quick sanity checks.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/query", queryRouter);

app.listen(PORT, () => {
  console.log(`🚔 dredge orchestrator running on http://localhost:${PORT}`);
});

// =============================================================================
// SUMMARY — HOW A REQUEST FLOWS THROUGH THE SYSTEM
// =============================================================================
//
//  Browser / curl
//       │
//       │  POST /query  { "text": "show me burglaries in Camden last October" }
//       ▼
//  Express server (Section 8)
//       │
//       │  routes to queryRouter
//       ▼
//  Query pipeline (Section 7)
//       │
//       ├─► parseIntent(text)          (Section 3)
//       │     └─► DeepSeek API  →  QueryPlan { category, date, poly, viz_hint }
//       │
//       ├─► prisma.query.create(plan)  saves the query to PostgreSQL
//       │
//       ├─► fetchCrimes(plan)          (Section 4)
//       │     └─► Police API  →  RawCrime[]
//       │
//       ├─► decideSchemaOp(sampleRow)  (Section 5)
//       │     └─► information_schema diff
//       │           └─► (if new keys) DeepSeek API  →  SchemaOp
//       │
//       ├─► applySchemaOp(op)          (Section 5)
//       │     └─► (if ADD_COLUMN) ALTER TABLE ... ADD COLUMN IF NOT EXISTS
//       │
//       ├─► storeResults(crimes)       (Section 6)
//       │     └─► prisma.$transaction → INSERT INTO crime_results (batch)
//       │
//       └─► return { query_id, plan, count, viz_hint, results[0..99] }
//       ▼
//  Browser receives JSON response
