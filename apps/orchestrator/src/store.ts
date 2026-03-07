// TODO - Step 9: Persist results to Postgres
//
// export async function storeResults(
//   queryId: string,
//   plan: QueryPlan,
//   crimes: RawCrime[]
// ): Promise<void>
// - Map each RawCrime to a CrimeResult row shape
// - Batch insert using prisma.$transaction
