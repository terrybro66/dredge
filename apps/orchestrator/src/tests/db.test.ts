import { describe, it, expect, beforeEach, vi } from "vitest";

describe("db singleton", () => {
  beforeEach(() => {
    // Clear module cache so we can re-import cleanly
    vi.resetModules();
  });

  it("prisma instance is defined", async () => {
    const { prisma } = await import("../db");
    expect(prisma).toBeDefined();
  });

  it("returns the same instance on multiple imports (singleton check)", async () => {
    const { prisma: instanceA } = await import("../db");
    const { prisma: instanceB } = await import("../db");
    expect(instanceA).toBe(instanceB);
  });
});
