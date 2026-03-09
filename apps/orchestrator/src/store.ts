import { PrismaClient } from "@prisma/client";
import type { QueryPlan } from "./intent";
import type { RawCrime } from "./fetcher";

const prisma = new PrismaClient();

export async function storeResults(
  queryId: string,
  plan: QueryPlan,
  crimes: RawCrime[],
): Promise<void> {
  if (crimes.length === 0) return;

  const rows = crimes.map((crime) => ({
    query_id: queryId,
    persistent_id: crime.persistent_id,
    category: crime.category,
    month: crime.month,
    street: crime.location.street.name,
    latitude: parseFloat(crime.location.latitude),
    longitude: parseFloat(crime.location.longitude),
    outcome_category: crime.outcome_status?.category ?? null,
    outcome_date: crime.outcome_status?.date ?? null,
    location_type: crime.location_type,
    context: crime.context ?? null,
  }));

  await prisma.$transaction(
    rows.map((row) => prisma.crimeResult.create({ data: row })),
  );
}
