// TODO - Step 6: Parse natural language into a QueryPlan
//
// export interface QueryPlan {
//   category: string   — police API slug e.g. "burglary", "all-crime"
//   date: string       — "YYYY-MM"
//   poly: string       — "lat,lng:lat,lng:lat,lng"
//   viz_hint: "map" | "bar" | "table"
// }
//
// export async function parseIntent(rawText: string): Promise<QueryPlan>
// - Call Anthropic with a system prompt that explains available crime categories
// - Ask it to return JSON only (no prose)
// - Parse and return the result as QueryPlan
