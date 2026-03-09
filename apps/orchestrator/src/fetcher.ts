import axios from "axios";
import type { QueryPlan } from "./intent";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RawCrime {
  category: string;
  location: {
    latitude: string;
    longitude: string;
    street: { id: number; name: string };
  };
  month: string;
  outcome_status: { category: string; date: string } | null;
  persistent_id: string;
  context: string;
  id: number;
  location_type: string;
  location_subtype: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = "https://data.police.uk/api/crimes-street";
const MAX_POLY_POINTS = 100;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validates the polygon string won't exceed the API's 100-point limit.
 */
function validatePoly(poly: string): void {
  const points = poly.split(":").length;
  if (points > MAX_POLY_POINTS) {
    throw new Error(
      `Polygon has ${points} points, exceeding the API limit of ${MAX_POLY_POINTS}`,
    );
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetch crimes from the UK Police API for a given QueryPlan.
 *
 * @example
 * const crimes = await fetchCrimes({
 *   category: "burglary",
 *   date: "2024-01",
 *   poly: "51.5,-0.1:51.6,-0.1:51.6,0.0:51.5,0.0",
 *   viz_hint: "map"
 * });
 */
export async function fetchCrimes(plan: QueryPlan): Promise<RawCrime[]> {
  validatePoly(plan.poly);

  const url = `${BASE_URL}/${plan.category}`;

  const response = await axios.get<RawCrime[]>(url, {
    params: {
      date: plan.date,
      poly: plan.poly,
    },
  });

  return response.data;
}
