#!/usr/bin/env bash
set -e

echo "🚔 Scaffolding query-os (crime domain)..."

mkdir -p query-os
cd query-os

# ── Root ─────────────────────────────────────────────────────────────────────

cat > package.json << 'EOF'
{
  "name": "query-os",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "concurrently \"npm run dev --workspace=apps/web\" \"npm run dev --workspace=apps/orchestrator\"",
    "db:generate": "npm run db:generate --workspace=packages/database",
    "db:migrate": "npm run db:migrate --workspace=packages/database",
    "db:studio": "npm run db:studio --workspace=packages/database"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
EOF

cat > .env << 'EOF'
# LLM
ANTHROPIC_API_KEY=

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/queryos

# Redis
REDIS_URL=redis://localhost:6379

# App
PORT=3001
EOF

cat > .gitignore << 'EOF'
node_modules
.env
dist
.turbo
EOF

cat > docker-compose.yml << 'EOF'
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: queryos
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
EOF

# ── Database package ──────────────────────────────────────────────────────────

mkdir -p packages/database/prisma

cat > packages/database/package.json << 'EOF'
{
  "name": "@query-os/database",
  "version": "0.0.1",
  "scripts": {
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "@prisma/client": "^5.10.0"
  },
  "devDependencies": {
    "prisma": "^5.10.0"
  }
}
EOF

cat > packages/database/prisma/schema.prisma << 'EOF'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// TODO - Step 4: Define your three starting models
// model Query        { ... }
// model CrimeResult  { ... }
// model SchemaVersion { ... }
EOF

cat > packages/database/index.ts << 'EOF'
// TODO - Step 4: Export PrismaClient
EOF

# ── Orchestrator ──────────────────────────────────────────────────────────────

mkdir -p apps/orchestrator/src

cat > apps/orchestrator/package.json << 'EOF'
{
  "name": "@query-os/orchestrator",
  "version": "0.0.1",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.20.0",
    "@query-os/database": "*",
    "axios": "^1.6.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0"
  }
}
EOF

cat > apps/orchestrator/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
EOF

cat > apps/orchestrator/src/index.ts << 'EOF'
// TODO - Step 5: Express entry point
// - Load dotenv
// - Create Express app
// - Add cors + json middleware
// - Mount queryRouter on /query
// - Add GET /health route
// - Start listening on PORT
EOF

cat > apps/orchestrator/src/db.ts << 'EOF'
// TODO - Step 4: Prisma client singleton
// - Import PrismaClient from @prisma/client
// - Export a single shared instance
// - Attach to globalThis in development to survive hot reloads
EOF

cat > apps/orchestrator/src/intent.ts << 'EOF'
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
EOF

cat > apps/orchestrator/src/fetcher.ts << 'EOF'
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
EOF

cat > apps/orchestrator/src/schema.ts << 'EOF'
// TODO - Step 8: Schema evolution logic
//
// export type SchemaOp =
//   | { op: "USE_EXISTING" }
//   | { op: "ADD_COLUMN"; table: string; column: string; type: string }
//
// export async function decideSchemaOp(sampleRow): Promise<SchemaOp>
// - List the current columns in CrimeResult
// - Diff against the keys in sampleRow
// - If no new keys → return USE_EXISTING immediately (no LLM call needed)
// - If new keys exist → call Anthropic, ask it to return a SchemaOp JSON
//
// export async function applySchemaOp(op: SchemaOp, triggeredBy: string): Promise<void>
// - If USE_EXISTING → return early
// - If ADD_COLUMN → build the ALTER TABLE SQL
// - Validate the SQL matches a safe pattern before running it
// - Execute with prisma.$executeRawUnsafe
// - Write a record to SchemaVersion
EOF

cat > apps/orchestrator/src/store.ts << 'EOF'
// TODO - Step 9: Persist results to Postgres
//
// export async function storeResults(
//   queryId: string,
//   plan: QueryPlan,
//   crimes: RawCrime[]
// ): Promise<void>
// - Map each RawCrime to a CrimeResult row shape
// - Batch insert using prisma.$transaction
EOF

cat > apps/orchestrator/src/query.ts << 'EOF'
// TODO - Step 10: Wire the pipeline together
//
// export const queryRouter = Router()
//
// POST /
// 1. Validate req.body.text exists
// 2. parseIntent(text)           → QueryPlan
// 3. prisma.query.create(...)    → persist the query
// 4. fetchCrimes(plan)           → RawCrime[]
// 5. decideSchemaOp(sampleRow)   → SchemaOp
// 6. applySchemaOp(op, queryId)  → evolve schema if needed
// 7. storeResults(...)           → write rows
// 8. Return { query_id, plan, count, viz_hint, results }
//
// GET /:id
// - Return query + its results from Postgres
EOF

# ── Web ───────────────────────────────────────────────────────────────────────

mkdir -p apps/web/src/components

cat > apps/web/package.json << 'EOF'
{
  "name": "@query-os/web",
  "version": "0.0.1",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.3.0",
    "vite": "^5.1.0"
  }
}
EOF

cat > apps/web/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>query-os</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
EOF

cat > apps/web/vite.config.ts << 'EOF'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: { "/query": "http://localhost:3001" },
  },
});
EOF

cat > apps/web/tailwind.config.ts << 'EOF'
import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
EOF

cat > apps/web/src/main.tsx << 'EOF'
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>
);
EOF

cat > apps/web/src/index.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;
EOF

cat > apps/web/src/App.tsx << 'EOF'
// TODO - Step 11: Root app component
// - useState for: result, loading, error
// - handleQuery(text) → POST /query → setResult
// - Render <QueryInput> and <ResultRenderer>
EOF

cat > apps/web/src/components/QueryInput.tsx << 'EOF'
// TODO - Step 11: Query input component
// Props: onSubmit(text: string), loading: boolean
// - Controlled text input
// - Submit on Enter or button click
// - Disable while loading
EOF

cat > apps/web/src/components/ResultRenderer.tsx << 'EOF'
// TODO - Step 11: Result display component
// Props: result (query_id, plan, count, viz_hint, results)
// - Show count + category + date as summary
// - Render a basic table of results (category, street, month)
// - Later: swap table for map or chart based on viz_hint
EOF

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "✅ query-os scaffolded (placeholders only)."
echo ""
echo "See GUIDE.md for step-by-step implementation instructions."
