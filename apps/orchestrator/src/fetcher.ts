// TODO - Step 7: Call the UK Police API
//
// export interface RawCrime {
//   category: string
//   location: { latitude: string; longitude: string; street: { name: string } }
//   month: string
//   outcome_status: { category: string; date: string } | null
//   persistent_id: string
// }
//
// export async function fetchCrimes(plan: QueryPlan): Promise<RawCrime[]>
// - Base URL: https://data.police.uk/api/crimes-street/{category}
// - Params: date, poly
// - Use axios.get and return the data array
