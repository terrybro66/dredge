import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { parseIntent } from "./intent";
import { fetchCrimes } from "./fetcher";
import { decideSchemaOp, applySchemaOp } from "./schema";
import { storeResults } from "./store";

const prisma = new PrismaClient();

export const queryRouter = Router();

// ── POST / ────────────────────────────────────────────────────────────────────

queryRouter.post("/", async (req: Request, res: Response) => {
  const { text } = req.body;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res
      .status(400)
      .json({ error: "Request body must include a non-empty 'text' field" });
  }

  let queryRecord: { id: string };

  try {
    // 1. Parse intent
    const plan = await parseIntent(text);

    // 2. Persist the query
    queryRecord = await prisma.query.create({
      data: {
        text: text.trim(),
        category: plan.category,
        date: plan.date,
        poly: plan.poly,
        viz_hint: plan.viz_hint,
      },
    });

    // 3. Fetch crimes from Police API
    const crimes = await fetchCrimes(plan);

    // 4. Evolve schema if needed
    if (crimes.length > 0) {
      const sampleRow = {
        category: crimes[0].category,
        month: crimes[0].month,
        street: crimes[0].location.street.name,
        latitude: crimes[0].location.latitude,
        longitude: crimes[0].location.longitude,
        outcome_category: crimes[0].outcome_status?.category ?? null,
        outcome_date: crimes[0].outcome_status?.date ?? null,
        location_type: crimes[0].location_type,
        context: crimes[0].context,
      };

      const schemaOp = await decideSchemaOp(prisma, sampleRow);
      await applySchemaOp(prisma, schemaOp, queryRecord.id);
    }

    // 5. Store results
    await storeResults(queryRecord.id, plan, crimes);

    // 6. Return response
    return res.status(200).json({
      query_id: queryRecord.id,
      plan,
      count: crimes.length,
      viz_hint: plan.viz_hint,
      results: crimes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /query] error:", message);
    return res.status(500).json({ error: message });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

queryRouter.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const query = await prisma.query.findUnique({
      where: { id },
      include: { results: true },
    });

    if (!query) {
      return res.status(404).json({ error: `Query ${id} not found` });
    }

    return res.status(200).json(query);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /query/:id] error:", message);
    return res.status(500).json({ error: message });
  }
});
