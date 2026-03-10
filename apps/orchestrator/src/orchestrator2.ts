// =============================================================================
// DREDGE ORCHESTRATOR — GEOSPATIAL + TYPED LLM VERSION
// =============================================================================
// Key Improvements Implemented
// 1. Typed LLM responses using Zod validation
// 2. PostGIS geospatial storage instead of latitude/longitude numeric columns
//
// This version assumes PostgreSQL has the PostGIS extension enabled.
//   CREATE EXTENSION IF NOT EXISTS postgis;
//
// Crime locations are stored as a geometry(Point,4326) column called `location`.
// =============================================================================

import dotenv from "dotenv";
dotenv.config();

import express, { Router, Request, Response } from "express";
import cors from "cors";
import axios from "axios";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

// =============================================================================
// TYPES
// =============================================================================

type CrimeCategory =
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

type VizHint = "map" | "bar" | "table";

interface QueryPlan {
  category: CrimeCategory;
  date: string;
  poly: string;
  viz_hint: VizHint;
}

interface RawCrime {
  persistent_id: string;
  category: string;
  month: string;
  id: number;
  location: {
    latitude: string;
    longitude: string;
    street: {
      id: number;
      name: string;
    };
  };
  outcome_status: {
    category: string;
    date: string;
  } | null;
}

// =============================================================================
// ZOD SCHEMA FOR LLM OUTPUT (Typed LLM Responses)
// =============================================================================

const QueryPlanSchema = z.object({
  category: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}$/),
  poly: z.string(),
  viz_hint: z.enum(["map", "bar", "table"]),
});

// =============================================================================
// DATABASE SINGLETON
// =============================================================================

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// =============================================================================
// INTENT PARSER WITH TYPED VALIDATION
// =============================================================================

const CRIME_CATEGORIES: Record<CrimeCategory, string> = {
  "all-crime": "All crime",
  "anti-social-behaviour": "Anti-social behaviour",
  "bicycle-theft": "Bicycle theft",
  burglary: "Burglary",
  "criminal-damage-arson": "Criminal damage",
  drugs: "Drugs",
  "other-theft": "Other theft",
  "possession-of-weapons": "Weapons",
  "public-order": "Public order",
  robbery: "Robbery",
  shoplifting: "Shoplifting",
  "theft-from-the-person": "Theft from person",
  "vehicle-crime": "Vehicle crime",
  "violent-crime": "Violence",
  "other-crime": "Other crime",
};

function buildSystemPrompt() {
  const categories = Object.entries(CRIME_CATEGORIES)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  return `Return a JSON QueryPlan.

Categories:
${categories}

Format:
{
  "category": string,
  "date": "YYYY-MM",
  "poly": "lat,lng:lat,lng:lat,lng",
  "viz_hint": "map" | "bar" | "table"
}

Respond with JSON only.`;
}

function stripFences(text: string) {
  return text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

async function parseIntent(text: string): Promise<QueryPlan> {
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com",
  });

  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: text },
    ],
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("LLM returned empty response");

  const parsed = JSON.parse(stripFences(raw));

  const validated = QueryPlanSchema.parse(parsed);

  return validated as QueryPlan;
}

// =============================================================================
// FETCHER
// =============================================================================

const POLICE_API = "https://data.police.uk/api/crimes-street";

async function fetchCrimes(plan: QueryPlan): Promise<RawCrime[]> {
  const url = `${POLICE_API}/${plan.category}`;

  const res = await axios.get<RawCrime[]>(url, {
    params: {
      date: plan.date,
      poly: plan.poly,
    },
  });

  return res.data;
}

// =============================================================================
// GEOSPATIAL STORE
// =============================================================================

async function storeResults(
  queryId: string,
  crimes: RawCrime[],
): Promise<void> {
  if (crimes.length === 0) return;

  await prisma.$transaction(
    crimes.map((crime) => {
      const lat = parseFloat(crime.location.latitude);
      const lng = parseFloat(crime.location.longitude);

      return prisma.$executeRaw`
        INSERT INTO "CrimeResult" (
          query_id,
          persistent_id,
          category,
          month,
          street,
          location,
          outcome_category,
          outcome_date,
          raw
        ) VALUES (
          ${queryId},
          ${crime.persistent_id},
          ${crime.category},
          ${crime.month},
          ${crime.location.street.name},
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326),
          ${crime.outcome_status?.category ?? null},
          ${crime.outcome_status?.date ?? null},
          ${JSON.stringify(crime)}::jsonb
        )`;
    }),
  );
}

// =============================================================================
// QUERY ROUTER
// =============================================================================

const queryRouter = Router();

queryRouter.post("/", async (req: Request, res: Response) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "text required" });
  }

  try {
    const plan = await parseIntent(text);

    const queryRecord = await prisma.query.create({
      data: {
        text,
        category: plan.category,
        date: plan.date,
        poly: plan.poly,
        viz_hint: plan.viz_hint,
      },
    });

    const crimes = await fetchCrimes(plan);

    await storeResults(queryRecord.id, crimes);

    res.json({
      query_id: queryRecord.id,
      plan,
      count: crimes.length,
      results: crimes.slice(0, 100),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    res.status(500).json({ error: message });
  }
});

queryRouter.get("/:id", async (req: Request, res: Response) => {
  const query = await prisma.query.findUnique({
    where: { id: req.params.id },
    include: { results: true },
  });

  if (!query) return res.status(404).json({ error: "not found" });

  res.json(query);
});

// =============================================================================
// SERVER
// =============================================================================

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

app.use("/query", queryRouter);

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
