import { prisma } from "./db";

// Temporary stub — replace with: import type { QueryPlan } from "./intent";
export interface QueryPlan {
  category: string;
  date?: string;
  poly?: string;
  viz_hint?: string;
}

export interface RawCrime {
  category: string;
  location?: {
    street?: { name?: string };
    latitude?: string;
    longitude?: string;
  };
  month?: string;
  [key: string]: unknown;
}

export async function storeResults(
  queryId: string,
  plan: QueryPlan,
  crimes: RawCrime[],
): Promise<void> {
  if (crimes.length === 0) return;

  await prisma.$transaction(
    crimes.map((crime) =>
      prisma.crimeResult.create({
        data: {
          queryId,
          category: crime.category ?? plan.category,
          street: crime.location?.street?.name ?? null,
          month: crime.month ?? plan.date ?? null,
          latitude: crime.location?.latitude
            ? parseFloat(crime.location.latitude)
            : null,
          longitude: crime.location?.longitude
            ? parseFloat(crime.location.longitude)
            : null,
          raw: crime as object,
        },
      }),
    ),
  );
}
