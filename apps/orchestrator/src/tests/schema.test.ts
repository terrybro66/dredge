import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: function MockAnthropic() {
      return { messages: { create: mockCreate } };
    },
  };
});

vi.mock("../db", () => ({
  prisma: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    schemaVersion: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { prisma } from "../db";
import { decideSchemaOp, applySchemaOp } from "../schema";

function mockLLMResponse(json: object) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify(json) }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("decideSchemaOp", () => {
  it("returns USE_EXISTING when no new keys", async () => {
    const op = await decideSchemaOp({ id: "1", category: "burglary" });
    expect(op.type).toBe("USE_EXISTING");
  });

  it("does NOT call LLM when no new keys", async () => {
    await decideSchemaOp({ category: "burglary" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("calls LLM when new keys are present", async () => {
    mockLLMResponse({
      type: "ADD_COLUMN",
      column: "outcome_status",
      sqlType: "TEXT",
      sql: 'ALTER TABLE "CrimeResult" ADD COLUMN IF NOT EXISTS "outcome_status" TEXT;',
    });
    await decideSchemaOp({ outcome_status: "Under investigation" });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("returns ADD_COLUMN op with correct shape", async () => {
    const expectedOp = {
      type: "ADD_COLUMN",
      column: "outcome_status",
      sqlType: "TEXT",
      sql: 'ALTER TABLE "CrimeResult" ADD COLUMN IF NOT EXISTS "outcome_status" TEXT;',
    };
    mockLLMResponse(expectedOp);
    const op = await decideSchemaOp({ outcome_status: "Under investigation" });
    expect(op).toEqual(expectedOp);
  });

  it("throws on malformed LLM response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "not valid json {{" }],
    });
    await expect(decideSchemaOp({ someNewKey: "value" })).rejects.toThrow();
  });
});

describe("applySchemaOp", () => {
  it("does nothing on USE_EXISTING", async () => {
    await applySchemaOp({ type: "USE_EXISTING" }, "test");
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.schemaVersion.create).not.toHaveBeenCalled();
  });

  it("runs correct sql on ADD_COLUMN", async () => {
    const sql =
      'ALTER TABLE "CrimeResult" ADD COLUMN IF NOT EXISTS "outcome_status" TEXT;';
    await applySchemaOp(
      { type: "ADD_COLUMN", column: "outcome_status", sqlType: "TEXT", sql },
      "test",
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(sql);
  });

  it("rejects unsafe sql", async () => {
    const badSql = "DROP TABLE CrimeResult;";
    await expect(
      applySchemaOp(
        { type: "ADD_COLUMN", column: "x", sqlType: "TEXT", sql: badSql },
        "test",
      ),
    ).rejects.toThrow("Unsafe or malformed SQL rejected");
  });

  it("writes a SchemaVersion record after applying", async () => {
    const sql =
      'ALTER TABLE "CrimeResult" ADD COLUMN IF NOT EXISTS "outcome_status" TEXT;';
    await applySchemaOp(
      { type: "ADD_COLUMN", column: "outcome_status", sqlType: "TEXT", sql },
      "pipeline",
    );
    expect(prisma.schemaVersion.create).toHaveBeenCalledWith({
      data: { triggeredBy: "pipeline", sql },
    });
  });
});
