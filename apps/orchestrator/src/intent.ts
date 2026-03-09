import OpenAI from "openai";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VizHint = "map" | "bar" | "table";

export type CrimeCategory =
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

export interface QueryPlan {
  /** UK Police API crime category slug */
  category: CrimeCategory;
  /** Month in YYYY-MM format (e.g. "2024-01") */
  date: string;
  /** Polygon string for the Police API: "lat,lng:lat,lng:lat,lng:..." */
  poly: string;
  /** Hint for the frontend renderer */
  viz_hint: VizHint;
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const categoryList = Object.entries(CRIME_CATEGORIES)
    .map(([slug, desc]) => `  • "${slug}" — ${desc}`)
    .join("\n");

  return `You are a query parser for a UK crime data platform.

Given a natural-language question, extract a structured QueryPlan JSON object.

## Available crime categories (use exact slugs):
${categoryList}

## QueryPlan schema:
interface QueryPlan {
  category: string;   // one of the slugs above; use "all-crime" if unclear
  date: string;       // "YYYY-MM" — if not specified, use the most recent full month
  poly: string;       // "lat,lng:lat,lng:lat,lng:lat,lng" — a bounding box or polygon
  viz_hint: "map" | "bar" | "table";
}

## viz_hint rules:
- "map"   → user asks where, show me on a map, geographic distribution
- "bar"   → user asks how many, compare, breakdown, chart, graph
- "table" → user asks list, show me, what are the, details

## Output rules:
- Respond with ONLY a valid JSON object — no prose, no markdown fences, no explanation.
- All four keys must be present: category, date, poly, viz_hint.
- "category" must be an exact slug from the list above.`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function validateQueryPlan(raw: unknown): QueryPlan {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Missing required fields");
  }

  const obj = raw as Record<string, unknown>;

  if (!obj["category"] || !obj["date"] || !obj["poly"] || !obj["viz_hint"]) {
    throw new Error("Missing required fields");
  }

  if (
    typeof obj["category"] !== "string" ||
    !(obj["category"] in CRIME_CATEGORIES)
  ) {
    throw new Error(`Invalid category: "${obj["category"]}"`);
  }

  if (typeof obj["date"] !== "string" || !/^\d{4}-\d{2}$/.test(obj["date"])) {
    throw new Error(`Invalid date format: "${obj["date"]}"`);
  }

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

// ── Main export ───────────────────────────────────────────────────────────────

export async function parseIntent(rawText: string): Promise<QueryPlan> {
  console.log("API KEY:", process.env.DEEPSEEK_API_KEY?.slice(-4));
  if (!rawText || rawText.trim().length === 0) {
    throw new Error("Query text must not be empty");
  }

  // Instantiated here (not at module level) so mocks are in place during tests
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com",
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
    throw new Error("Failed to parse intent: no text content in response");
  }

  const rawJson = stripFences(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error(
      `Failed to parse intent: invalid JSON response — ${rawJson}`,
    );
  }

  return validateQueryPlan(parsed);
}
