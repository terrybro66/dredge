import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ───────────────────────────────────────────────────────────────

vi.mock("@prisma/client", () => {
  const mockCreate = vi.fn();
  const mockTransaction = vi.fn();
  function PrismaClient() {
    return {
      crimeResult: { create: mockCreate },
      $transaction: mockTransaction,
    };
  }
  PrismaClient._mockCreate = mockCreate;
  PrismaClient._mockTransaction = mockTransaction;
  return { PrismaClient };
});

import { PrismaClient } from "@prisma/client";
import { storeResults } from "../store";

const mockCreate = (PrismaClient as any)._mockCreate as ReturnType<
  typeof vi.fn
>;
const mockTransaction = (PrismaClient as any)._mockTransaction as ReturnType<
  typeof vi.fn
>;
import type { QueryPlan } from "../intent";
import type { RawCrime } from "../fetcher";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const plan: QueryPlan = {
  category: "burglary",
  date: "2024-01",
  poly: "52.2,0.1:52.3,0.2:52.3,0.3:52.2,0.3",
  viz_hint: "map",
};

function makeCrime(overrides: Partial<RawCrime> = {}): RawCrime {
  return {
    category: "burglary",
    location: {
      latitude: "52.2100",
      longitude: "0.1200",
      street: { id: 1, name: "On or near High Street" },
    },
    month: "2024-01",
    outcome_status: { category: "Under investigation", date: "2024-02" },
    persistent_id: "abc123",
    context: "",
    id: 1001,
    location_type: "Force",
    location_subtype: "",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockCreate.mockReset();
  mockTransaction.mockReset();
  mockTransaction.mockImplementation((ops: Promise<unknown>[]) =>
    Promise.all(ops),
  );
});

describe("storeResults", () => {
  it("does nothing when crimes array is empty", async () => {
    await storeResults("query-1", plan, []);

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates one row per crime inside a transaction", async () => {
    mockCreate.mockResolvedValue({});

    const crimes = [
      makeCrime({ persistent_id: "a1" }),
      makeCrime({ persistent_id: "a2" }),
    ];

    await storeResults("query-1", plan, crimes);

    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("maps RawCrime fields correctly", async () => {
    mockCreate.mockResolvedValue({});

    await storeResults("query-42", plan, [makeCrime()]);

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        query_id: "query-42",
        persistent_id: "abc123",
        category: "burglary",
        month: "2024-01",
        street: "On or near High Street",
        latitude: 52.21,
        longitude: 0.12,
        outcome_category: "Under investigation",
        outcome_date: "2024-02",
        location_type: "Force",
        context: "",
      },
    });
  });

  it("sets outcome fields to null when outcome_status is null", async () => {
    mockCreate.mockResolvedValue({});

    await storeResults("query-1", plan, [makeCrime({ outcome_status: null })]);

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        outcome_category: null,
        outcome_date: null,
      }),
    });
  });

  it("parses latitude and longitude as floats", async () => {
    mockCreate.mockResolvedValue({});

    await storeResults("query-1", plan, [
      makeCrime({
        location: {
          latitude: "51.5074",
          longitude: "-0.1278",
          street: { id: 1, name: "Test Street" },
        },
      }),
    ]);

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        latitude: 51.5074,
        longitude: -0.1278,
      }),
    });
  });

  it("handles a large batch without error", async () => {
    mockCreate.mockResolvedValue({});

    const crimes = Array.from({ length: 100 }, (_, i) =>
      makeCrime({ persistent_id: `id-${i}` }),
    );

    await storeResults("query-1", plan, crimes);

    expect(mockCreate).toHaveBeenCalledTimes(100);
  });
});
