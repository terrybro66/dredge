import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../intent", () => ({}));

vi.mock("../db", () => {
  const mockCreate = vi.fn().mockResolvedValue({});
  const mockTransaction = vi.fn().mockImplementation((ops) => Promise.all(ops));
  return {
    prisma: {
      $transaction: mockTransaction,
      crimeResult: { create: mockCreate },
    },
  };
});

import { prisma } from "../db";
import { storeResults } from "../store";
import type { QueryPlan } from "../store";

const basePlan: QueryPlan = {
  category: "burglary",
  date: "2024-01",
  poly: "52.2,0.1:52.3,0.2",
  viz_hint: "table",
};

const makeCrime = (overrides = {}) => ({
  category: "burglary",
  location: {
    street: { name: "High Street" },
    latitude: "52.2053",
    longitude: "0.1218",
  },
  month: "2024-01",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("storeResults", () => {
  it("calls prisma.$transaction with correct number of creates", async () => {
    const crimes = [makeCrime(), makeCrime(), makeCrime()];
    await storeResults("query-1", basePlan, crimes);
    expect(prisma.crimeResult.create).toHaveBeenCalledTimes(3);
  });

  it("parses latitude as a float", async () => {
    await storeResults("query-1", basePlan, [makeCrime()]);
    const callData = (prisma.crimeResult.create as any).mock.calls[0][0].data;
    expect(callData.latitude).toBe(52.2053);
    expect(typeof callData.latitude).toBe("number");
  });

  it("parses longitude as a float", async () => {
    await storeResults("query-1", basePlan, [makeCrime()]);
    const callData = (prisma.crimeResult.create as any).mock.calls[0][0].data;
    expect(callData.longitude).toBe(0.1218);
    expect(typeof callData.longitude).toBe("number");
  });

  it("stores the full raw crime object", async () => {
    const crime = makeCrime({ extra_field: "outcome_status" });
    await storeResults("query-1", basePlan, [crime]);
    const callData = (prisma.crimeResult.create as any).mock.calls[0][0].data;
    expect(callData.raw).toMatchObject(crime);
  });

  it("handles an empty crimes array without calling transaction", async () => {
    await storeResults("query-1", basePlan, []);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
