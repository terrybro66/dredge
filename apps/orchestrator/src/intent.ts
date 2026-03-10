import OpenAI from "openai";
import { z } from "zod";

// ── Schema & Types ────────────────────────────────────────────────────────────

const CRIME_CATEGORIES = {
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
} as const;

const QueryPlanSchema = z.object({
  category: z.enum(Object.keys(CRIME_CATEGORIES) as [string, ...string[]], {
    required_error: "Missing required fields",
    invalid_type_error: "Missing required fields",
  }),
  date: z
    .string({
      required_error: "Missing required fields",
      invalid_type_error: "Missing required fields",
    })
    .regex(/^\d{4}-\d{2}$/, "Date must be YYYY-MM format"),
  poly: z
    .string({
      required_error: "Missing required fields",
      invalid_type_error: "Missing required fields",
    })
    .refine(
      (s) => s.includes(",") && s.includes(":"),
      "Invalid polygon format",
    ),
  viz_hint: z.enum(["map", "bar", "table"], {
    required_error: "Invalid viz_hint",
    invalid_type_error: "Invalid viz_hint",
  }),
});

export type QueryPlan = z.infer<typeof QueryPlanSchema>;
export type CrimeCategory = keyof typeof CRIME_CATEGORIES;
export type VizHint = "map" | "bar" | "table";

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

// ── Main export ───────────────────────────────────────────────────────────────

export async function parseIntent(rawText: string): Promise<QueryPlan> {
  if (!rawText || rawText.trim().length === 0) {
    throw new Error("Query text must not be empty");
  }

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

  const result = QueryPlanSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues;

    const hasMissingFields = issues.some(
      (i) =>
        ["category", "date", "poly", "viz_hint"].includes(
          i.path[0] as string,
        ) && i.code === "invalid_type",
    );

    const hasInvalidVizHint = issues.some(
      (i) => i.path[0] === "viz_hint" && i.code !== "invalid_type",
    );

    if (hasMissingFields) {
      throw new Error("Missing required fields");
    }
    if (hasInvalidVizHint) {
      throw new Error("Invalid viz_hint");
    }

    throw new Error(
      `Failed to parse intent: ${issues.map((i) => i.message).join(", ")}`,
    );
  }

  return result.data;
}
