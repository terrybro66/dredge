import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock OpenAI ───────────────────────────────────────────────────────────────

vi.mock("openai", () => {
  function MockOpenAI() {
    return { chat: { completions: { create: mockLlm } } };
  }
  return { default: MockOpenAI };
});

const mockLlm = vi.fn();

// ── Mock Prisma ───────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();
const mockExecuteRawUnsafe = vi.fn();
const mockSchemaVersionCreate = vi.fn();

const mockPrisma = {
  $queryRaw: mockQueryRaw,
  $executeRawUnsafe: mockExecuteRawUnsafe,
  schemaVersion: { create: mockSchemaVersionCreate },
} as any;

// ── Imports ───────────────────────────────────────────────────────────────────

import { decideSchemaOp, applySchemaOp } from "../schema";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeColumns(...names: string[]) {
  return names.map((column_name) => ({ column_name, data_type: "text" }));
}

function makeLlmResponse(op: object) {
  return {
    choices: [{ message: { content: JSON.stringify(op) } }],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQueryRaw.mockReset();
  mockExecuteRawUnsafe.mockReset();
  mockSchemaVersionCreate.mockReset();
  mockLlm.mockReset();
});

describe("decideSchemaOp", () => {
  it("returns USE_EXISTING when no new keys are present", async () => {
    mockQueryRaw.mockResolvedValue(
      makeColumns("id", "category", "month", "street"),
    );

    const result = await decideSchemaOp(mockPrisma, {
      id: 1,
      category: "burglary",
      month: "2024-01",
      street: "High Street",
    });

    expect(result).toEqual({ op: "USE_EXISTING" });
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it("returns ADD_COLUMN when a new key is found", async () => {
    mockQueryRaw.mockResolvedValue(makeColumns("id", "category", "month"));

    mockLlm.mockResolvedValue(
      makeLlmResponse({
        op: "ADD_COLUMN",
        table: "crime_results",
        column: "outcome_category",
        type: "text",
      }),
    );

    const result = await decideSchemaOp(mockPrisma, {
      id: 1,
      category: "burglary",
      month: "2024-01",
      outcome_category: "Under investigation",
    });

    expect(result).toEqual({
      op: "ADD_COLUMN",
      table: "crime_results",
      column: "outcome_category",
      type: "text",
    });

    expect(mockLlm).toHaveBeenCalledOnce();
  });

  it("does not call LLM when all keys already exist", async () => {
    mockQueryRaw.mockResolvedValue(
      makeColumns("id", "category", "month", "outcome_category"),
    );

    await decideSchemaOp(mockPrisma, {
      id: 1,
      category: "burglary",
      month: "2024-01",
      outcome_category: "Under investigation",
    });

    expect(mockLlm).not.toHaveBeenCalled();
  });

  it("throws when LLM returns an disallowed postgres type", async () => {
    mockQueryRaw.mockResolvedValue(makeColumns("id"));

    mockLlm.mockResolvedValue(
      makeLlmResponse({
        op: "ADD_COLUMN",
        table: "crime_results",
        column: "bad_col",
        type: "varchar(255)", // not in allowed list
      }),
    );

    await expect(
      decideSchemaOp(mockPrisma, { id: 1, bad_col: "value" }),
    ).rejects.toThrow("disallowed type");
  });

  it("throws when LLM returns invalid JSON", async () => {
    mockQueryRaw.mockResolvedValue(makeColumns("id"));

    mockLlm.mockResolvedValue({
      choices: [{ message: { content: "not json at all" } }],
    });

    await expect(
      decideSchemaOp(mockPrisma, { id: 1, new_col: "value" }),
    ).rejects.toThrow("invalid JSON");
  });
});

describe("applySchemaOp", () => {
  it("does nothing for USE_EXISTING", async () => {
    await applySchemaOp(mockPrisma, { op: "USE_EXISTING" }, "query-123");

    expect(mockExecuteRawUnsafe).not.toHaveBeenCalled();
    expect(mockSchemaVersionCreate).not.toHaveBeenCalled();
  });

  it("executes ALTER TABLE and writes SchemaVersion for ADD_COLUMN", async () => {
    mockExecuteRawUnsafe.mockResolvedValue(undefined);
    mockSchemaVersionCreate.mockResolvedValue({});

    await applySchemaOp(
      mockPrisma,
      {
        op: "ADD_COLUMN",
        table: "crime_results",
        column: "outcome_category",
        type: "text",
      },
      "query-123",
    );

    expect(mockExecuteRawUnsafe).toHaveBeenCalledWith(
      'ALTER TABLE "crime_results" ADD COLUMN "outcome_category" text',
    );

    expect(mockSchemaVersionCreate).toHaveBeenCalledWith({
      data: {
        table_name: "crime_results",
        column_name: "outcome_category",
        column_type: "text",
        triggered_by: "query-123",
      },
    });
  });

  it("rejects SQL with dangerous column names", async () => {
    await expect(
      applySchemaOp(
        mockPrisma,
        {
          op: "ADD_COLUMN",
          table: "crime_results",
          column: "col; DROP TABLE users--",
          type: "text",
        },
        "query-123",
      ),
    ).rejects.toThrow("Unsafe ALTER TABLE SQL rejected");

    expect(mockExecuteRawUnsafe).not.toHaveBeenCalled();
  });

  it("rejects SQL with dangerous type names", async () => {
    await expect(
      applySchemaOp(
        mockPrisma,
        {
          op: "ADD_COLUMN",
          table: "crime_results",
          column: "safe_col",
          type: "text; DROP TABLE users--",
        },
        "query-123",
      ),
    ).rejects.toThrow("Unsafe ALTER TABLE SQL rejected");

    expect(mockExecuteRawUnsafe).not.toHaveBeenCalled();
  });
});
