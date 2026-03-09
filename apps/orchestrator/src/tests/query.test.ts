import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockQueryCreate, mockQueryFindUnique } = vi.hoisted(() => ({
  mockQueryCreate: vi.fn(),
  mockQueryFindUnique: vi.fn(),
}));

vi.mock("@prisma/client", () => {
  function PrismaClient() {}
  PrismaClient.prototype.query = {
    create: (...args: any[]) => mockQueryCreate(...args),
    findUnique: (...args: any[]) => mockQueryFindUnique(...args),
  };
  PrismaClient.prototype.$queryRaw = vi.fn();
  PrismaClient.prototype.$executeRawUnsafe = vi.fn();
  PrismaClient.prototype.schemaVersion = { create: vi.fn() };
  return { PrismaClient };
});

vi.mock("../intent");
vi.mock("../fetcher");
vi.mock("../schema");
vi.mock("../store");

import * as intent from "../intent";
import * as fetcher from "../fetcher";
import * as schema from "../schema";
import * as store from "../store";
import { queryRouter } from "../query";

const mockIntent = vi.mocked(intent);
const mockFetcher = vi.mocked(fetcher);
const mockSchema = vi.mocked(schema);
const mockStore = vi.mocked(store);

const app = express();
app.use(express.json());
app.use("/query", queryRouter);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockPlan = {
  category: "burglary",
  date: "2024-01",
  poly: "52.2,0.1:52.3,0.2:52.3,0.3:52.2,0.3",
  viz_hint: "map",
};

const mockCrimes = [
  {
    category: "burglary",
    location: {
      latitude: "52.21",
      longitude: "0.12",
      street: { id: 1, name: "High Street" },
    },
    month: "2024-01",
    outcome_status: null,
    persistent_id: "abc123",
    context: "",
    id: 1,
    location_type: "Force",
    location_subtype: "",
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSchema.decideSchemaOp.mockResolvedValue({ op: "USE_EXISTING" });
  mockSchema.applySchemaOp.mockResolvedValue(undefined);
  mockStore.storeResults.mockResolvedValue(undefined);
});

describe("POST /query", () => {
  it("returns 400 when text is missing", async () => {
    const res = await request(app).post("/query").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/text/);
  });

  it("returns 400 when text is empty string", async () => {
    const res = await request(app).post("/query").send({ text: "  " });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/text/);
  });

  it("runs the full pipeline and returns result", async () => {
    mockIntent.parseIntent.mockResolvedValue(mockPlan as any);
    mockQueryCreate.mockResolvedValue({ id: "query-1" });
    mockFetcher.fetchCrimes.mockResolvedValue(mockCrimes as any);

    const res = await request(app)
      .post("/query")
      .send({ text: "Show me burglaries in Cambridge" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      query_id: "query-1",
      plan: mockPlan,
      count: 1,
      viz_hint: "map",
    });
    expect(res.body.results).toHaveLength(1);
  });

  it("calls pipeline steps in correct order", async () => {
    const order: string[] = [];
    mockIntent.parseIntent.mockImplementation(async () => {
      order.push("parseIntent");
      return mockPlan as any;
    });
    mockQueryCreate.mockImplementation(async () => {
      order.push("queryCreate");
      return { id: "query-1" };
    });
    mockFetcher.fetchCrimes.mockImplementation(async () => {
      order.push("fetchCrimes");
      return mockCrimes as any;
    });
    mockSchema.decideSchemaOp.mockImplementation(async () => {
      order.push("decideSchemaOp");
      return { op: "USE_EXISTING" };
    });
    mockSchema.applySchemaOp.mockImplementation(async () => {
      order.push("applySchemaOp");
    });
    mockStore.storeResults.mockImplementation(async () => {
      order.push("storeResults");
    });

    await request(app).post("/query").send({ text: "burglaries in Camden" });

    expect(order).toEqual([
      "parseIntent",
      "queryCreate",
      "fetchCrimes",
      "decideSchemaOp",
      "applySchemaOp",
      "storeResults",
    ]);
  });

  it("skips schema and store steps when no crimes returned", async () => {
    mockIntent.parseIntent.mockResolvedValue(mockPlan as any);
    mockQueryCreate.mockResolvedValue({ id: "query-1" });
    mockFetcher.fetchCrimes.mockResolvedValue([]);

    const res = await request(app)
      .post("/query")
      .send({ text: "burglaries in Camden" });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(mockSchema.decideSchemaOp).not.toHaveBeenCalled();
    expect(mockSchema.applySchemaOp).not.toHaveBeenCalled();
  });

  it("returns 500 when parseIntent throws", async () => {
    mockIntent.parseIntent.mockRejectedValue(new Error("LLM unavailable"));

    const res = await request(app).post("/query").send({ text: "some query" });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("LLM unavailable");
  });

  it("returns 500 when fetchCrimes throws", async () => {
    mockIntent.parseIntent.mockResolvedValue(mockPlan as any);
    mockQueryCreate.mockResolvedValue({ id: "query-1" });
    mockFetcher.fetchCrimes.mockRejectedValue(new Error("Network Error"));

    const res = await request(app).post("/query").send({ text: "some query" });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Network Error");
  });
});

describe("GET /query/:id", () => {
  it("returns 404 when query does not exist", async () => {
    mockQueryFindUnique.mockResolvedValue(null);

    const res = await request(app).get("/query/nonexistent-id");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });

  it("returns the query with results", async () => {
    mockQueryFindUnique.mockResolvedValue({
      id: "query-1",
      text: "burglaries in Camden",
      category: "burglary",
      date: "2024-01",
      results: mockCrimes,
    });

    const res = await request(app).get("/query/query-1");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("query-1");
    expect(res.body.results).toHaveLength(1);
  });

  it("returns 500 when prisma throws", async () => {
    mockQueryFindUnique.mockRejectedValue(new Error("DB connection lost"));

    const res = await request(app).get("/query/query-1");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("DB connection lost");
  });
});
