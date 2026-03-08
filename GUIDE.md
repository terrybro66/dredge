# query-os implementation guide

---

## prerequisites

- [ ] node 20+
- [ ] docker desktop
- [ ] anthropic api key
- [ ] github repo created and cloned

---

## initial setup

```bash
bash scaffold.sh
cd query-os
git init
git remote add origin <your-repo-url>
```

```bash
git checkout -b setup/monorepo
npm install
git add .
git commit -m "chore: scaffold monorepo"
git push origin setup/monorepo
# open pull request → merge → delete branch
```

---

## test setup

```bash
git checkout main && git pull
git checkout -b setup/testing
```

```bash
# install test deps in orchestrator
npm install --save-dev vitest @vitest/coverage-v8 --workspace=apps/orchestrator
```

add to `apps/orchestrator/package.json` scripts:
```json
"test": "vitest",
"test:coverage": "vitest run --coverage"
```

create `apps/orchestrator/src/__tests__/` folder

```bash
git add .
git commit -m "chore: add vitest to orchestrator"
git push origin setup/testing
# open pull request → merge → delete branch
```

---

## step 1 — database schema

```bash
git checkout main && git pull
git checkout -b feat/database-schema
```

- [ ] open `packages/database/prisma/schema.prisma`
- [ ] define `Query` model
- [ ] define `CrimeResult` model
- [ ] define `SchemaVersion` model
- [ ] open `packages/database/index.ts` and export `PrismaClient`

```bash
docker compose up -d
npm run db:migrate
# name the migration: initial
```

- [ ] verify tables exist

```bash
npm run db:studio
# check tables in browser at localhost:5555
```

```bash
git add .
git commit -m "feat: initial prisma schema"
git push origin feat/database-schema
# open pull request → merge → delete branch
```

---

## step 2 — db singleton

```bash
git checkout main && git pull
git checkout -b feat/db-singleton
```

- [ ] implement `apps/orchestrator/src/db.ts`
  - import `PrismaClient`
  - attach to `globalThis` to survive hot reloads
  - export single `prisma` instance

**test**
- [ ] create `apps/orchestrator/src/__tests__/db.test.ts`
  - [ ] test: prisma instance is defined
  - [ ] test: same instance returned on multiple imports (singleton check)

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: prisma singleton"
git push origin feat/db-singleton
# open pull request → merge → delete branch
```

---

## step 3 — express entry point

```bash
git checkout main && git pull
git checkout -b feat/express-server
```

- [ ] implement `apps/orchestrator/src/index.ts`
  - load `dotenv/config`
  - create express app
  - add `cors()` and `express.json()` middleware
  - mount `queryRouter` on `/query` (comment out until step 9)
  - `GET /health` → `{ status: "ok" }`
  - `app.listen(PORT)`

**test**
- [ ] create `apps/orchestrator/src/__tests__/index.test.ts`
  - [ ] test: `GET /health` returns 200
  - [ ] test: `GET /health` returns `{ status: "ok" }`

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: express server with health endpoint"
git push origin feat/express-server
# open pull request → merge → delete branch
```

---

## step 4 — intent parser

```bash
git checkout main && git pull
git checkout -b feat/intent-parser
```

- [ ] implement `apps/orchestrator/src/intent.ts`
  - define `QueryPlan` interface (`category`, `date`, `poly`, `viz_hint`)
  - `parseIntent(rawText)` calls anthropic
  - system prompt: return JSON only, list valid category slugs, default date and polygon rules
  - parse response with `JSON.parse`
  - return as `QueryPlan`

valid category slugs:
```
all-crime, burglary, robbery, violent-crime, anti-social-behaviour,
vehicle-crime, shoplifting, criminal-damage-arson, drugs,
possession-of-weapons, public-order, theft-from-the-person,
bicycle-theft, other-theft, other-crime
```

**test**
- [ ] create `apps/orchestrator/src/__tests__/intent.test.ts`
- [ ] mock the anthropic client
  - [ ] test: returns a valid `QueryPlan` shape
  - [ ] test: defaults to `all-crime` when no category mentioned
  - [ ] test: extracts date in `YYYY-MM` format
  - [ ] test: defaults to cambridge polygon when no location given
  - [ ] test: throws on malformed LLM response

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: intent parser with QueryPlan"
git push origin feat/intent-parser
# open pull request → merge → delete branch
```

---

## step 5 — api fetcher

```bash
git checkout main && git pull
git checkout -b feat/api-fetcher
```

- [ ] implement `apps/orchestrator/src/fetcher.ts`
  - define `RawCrime` interface
  - `fetchCrimes(plan)` calls `https://data.police.uk/api/crimes-street/{category}`
  - pass `date` and `poly` as query params
  - return `RawCrime[]`

**test**
- [ ] create `apps/orchestrator/src/__tests__/fetcher.test.ts`
- [ ] mock `axios`
  - [ ] test: calls correct url with category slug
  - [ ] test: passes date param correctly
  - [ ] test: passes poly param correctly
  - [ ] test: returns array of `RawCrime`
  - [ ] test: handles empty array response

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: police api fetcher"
git push origin feat/api-fetcher
# open pull request → merge → delete branch
```

---

## step 6 — schema evolution

```bash
git checkout main && git pull
git checkout -b feat/schema-evolution
```

- [ ] implement `apps/orchestrator/src/schema.ts`
  - define `SchemaOp` type (`USE_EXISTING` | `ADD_COLUMN`)
  - `decideSchemaOp(sampleRow)`:
    - diff sample keys against known `CrimeResult` columns
    - if no new keys → return `USE_EXISTING` immediately (no llm call)
    - if new keys → call anthropic, return `SchemaOp` JSON
  - `applySchemaOp(op, triggeredBy)`:
    - if `USE_EXISTING` → return
    - if `ADD_COLUMN` → build `ALTER TABLE` sql
    - validate sql with regex before executing
    - run with `prisma.$executeRawUnsafe`
    - write `SchemaVersion` record

safe sql pattern to validate against:
```
/^ALTER TABLE "[A-Za-z]+" ADD COLUMN IF NOT EXISTS "[a-z_]+" (TEXT|NUMERIC|BOOLEAN|JSONB|TIMESTAMPTZ);$/
```

**test**
- [ ] create `apps/orchestrator/src/__tests__/schema.test.ts`
- [ ] mock anthropic client and prisma
  - [ ] test: returns `USE_EXISTING` when no new keys
  - [ ] test: does not call LLM when no new keys
  - [ ] test: calls LLM when new keys present
  - [ ] test: returns `ADD_COLUMN` op with correct shape
  - [ ] test: `applySchemaOp` does nothing on `USE_EXISTING`
  - [ ] test: `applySchemaOp` runs correct sql on `ADD_COLUMN`
  - [ ] test: `applySchemaOp` rejects unsafe sql
  - [ ] test: `applySchemaOp` writes `SchemaVersion` record

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: schema evolution service"
git push origin feat/schema-evolution
# open pull request → merge → delete branch
```

---

## step 7 — store

```bash
git checkout main && git pull
git checkout -b feat/store
```

- [ ] implement `apps/orchestrator/src/store.ts`
  - `storeResults(queryId, plan, crimes)`:
    - map each `RawCrime` to a `CrimeResult` row
    - parse lat/lng with `parseFloat`
    - preserve full crime object in `raw` field
    - batch insert with `prisma.$transaction`

**test**
- [ ] create `apps/orchestrator/src/__tests__/store.test.ts`
- [ ] mock prisma
  - [ ] test: calls `prisma.$transaction` with correct number of creates
  - [ ] test: parses latitude as float
  - [ ] test: parses longitude as float
  - [ ] test: stores full raw object
  - [ ] test: handles empty crimes array

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: results store"
git push origin feat/store
# open pull request → merge → delete branch
```

---

## step 8 — query pipeline

```bash
git checkout main && git pull
git checkout -b feat/query-pipeline
```

- [ ] implement `apps/orchestrator/src/query.ts`
  - create express `Router`, export as `queryRouter`
  - `POST /`:
    - [ ] validate `req.body.text`, return 400 if missing
    - [ ] call `parseIntent(text)`
    - [ ] create `Query` record in postgres
    - [ ] call `fetchCrimes(plan)`
    - [ ] call `decideSchemaOp` on first result
    - [ ] call `applySchemaOp`
    - [ ] call `storeResults`
    - [ ] return `{ query_id, plan, count, viz_hint, results }` (cap results at 100)
    - [ ] catch all errors, return 500
  - `GET /:id`:
    - [ ] `prisma.query.findUnique` with `include: { results: true }`
    - [ ] return 404 if not found

- [ ] uncomment `queryRouter` import in `index.ts`

**test**
- [ ] create `apps/orchestrator/src/__tests__/query.test.ts`
- [ ] mock all service imports
  - [ ] test: `POST /` returns 400 when text missing
  - [ ] test: `POST /` calls `parseIntent` with correct text
  - [ ] test: `POST /` calls `fetchCrimes` with plan
  - [ ] test: `POST /` calls `decideSchemaOp`
  - [ ] test: `POST /` calls `storeResults`
  - [ ] test: `POST /` returns correct response shape
  - [ ] test: `POST /` returns 500 on service error
  - [ ] test: `GET /:id` returns 404 for unknown id
  - [ ] test: `GET /:id` returns query with results

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: query pipeline controller"
git push origin feat/query-pipeline
# open pull request → merge → delete branch
```

---

## step 9 — frontend

```bash
git checkout main && git pull
git checkout -b feat/frontend
```

- [ ] implement `apps/web/src/App.tsx`
  - `useState` for `result`, `loading`, `error`
  - `handleQuery(text)` → `POST /query` → set result
  - render `<QueryInput>` and `<ResultRenderer>`
  - show error in red when set

- [ ] implement `apps/web/src/components/QueryInput.tsx`
  - controlled input
  - submit on enter or button click
  - disable while loading

- [ ] implement `apps/web/src/components/ResultRenderer.tsx`
  - summary line: count, category, date
  - table: category | street | month
  - cap at 50 rows

```bash
git add .
git commit -m "feat: frontend query ui"
git push origin feat/frontend
# open pull request → merge → delete branch
```

---

## smoke test — full run

```bash
git checkout main && git pull
npm run dev
```

- [ ] open `http://localhost:3000`
- [ ] query: `show me burglaries in Cambridge in January 2024`
- [ ] verify results table renders
- [ ] query: `what were the outcomes of those burglaries`
- [ ] check orchestrator logs for schema evolution firing
- [ ] open `npm run db:studio` and verify `SchemaVersion` has a new record

---

## coverage check

```bash
npm run test:coverage --workspace=apps/orchestrator
```

- [ ] all tests passing
- [ ] coverage above 80%

```bash
git add .
git commit -m "chore: confirm test coverage"
git push origin main
```

---

## useful commands

| action | command |
|---|---|
| start db | `docker compose up -d` |
| stop db | `docker compose down` |
| run tests | `npm test --workspace=apps/orchestrator` |
| run dev | `npm run dev` |
| prisma studio | `npm run db:studio` |
| new migration | `npm run db:migrate` |
| regenerate client | `npm run db:generate` |
| reset db (dev only) | `npx prisma migrate reset --workspace=packages/database` |
