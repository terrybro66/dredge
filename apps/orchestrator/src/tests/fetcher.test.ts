import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("axios", () => {
  const mockGet = vi.fn();
  return { default: { get: mockGet } };
});

import axios from "axios";
import { fetchCrimes } from "../fetcher";
import type { QueryPlan } from "../intent";

const mockGet = axios.get as ReturnType<typeof vi.fn>;

const basePlan: QueryPlan = {
  category: "burglary",
  date: "2024-01",
  poly: "52.2,0.1:52.3,0.2:52.3,0.3:52.2,0.3",
  viz_hint: "map",
};

const mockCrimes = [
  {
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
  },
  {
    category: "burglary",
    location: {
      latitude: "52.2200",
      longitude: "0.1300",
      street: { id: 2, name: "On or near Market Street" },
    },
    month: "2024-01",
    outcome_status: null,
    persistent_id: "def456",
    context: "",
    id: 1002,
    location_type: "Force",
    location_subtype: "",
  },
];

beforeEach(() => {
  mockGet.mockReset();
});

describe("fetchCrimes", () => {
  it("calls the correct URL with correct params", async () => {
    mockGet.mockResolvedValue({ data: mockCrimes });

    await fetchCrimes(basePlan);

    expect(mockGet).toHaveBeenCalledWith(
      "https://data.police.uk/api/crimes-street/burglary",
      {
        params: {
          date: "2024-01",
          poly: "52.2,0.1:52.3,0.2:52.3,0.3:52.2,0.3",
        },
      },
    );
  });

  it("returns the crime array from the response", async () => {
    mockGet.mockResolvedValue({ data: mockCrimes });

    const result = await fetchCrimes(basePlan);

    expect(result).toHaveLength(2);
    expect(result[0].category).toBe("burglary");
    expect(result[0].persistent_id).toBe("abc123");
    expect(result[1].outcome_status).toBeNull();
  });

  it("returns an empty array when no crimes are found", async () => {
    mockGet.mockResolvedValue({ data: [] });

    const result = await fetchCrimes(basePlan);

    expect(result).toEqual([]);
  });

  it("uses the correct category slug in the URL", async () => {
    mockGet.mockResolvedValue({ data: [] });

    await fetchCrimes({ ...basePlan, category: "all-crime" });

    expect(mockGet).toHaveBeenCalledWith(
      "https://data.police.uk/api/crimes-street/all-crime",
      expect.any(Object),
    );
  });

  it("throws when polygon exceeds 100 points", async () => {
    const bigPoly = Array.from(
      { length: 101 },
      (_, i) => `52.${i},0.${i}`,
    ).join(":");

    await expect(fetchCrimes({ ...basePlan, poly: bigPoly })).rejects.toThrow(
      "exceeding the API limit of 100",
    );

    expect(mockGet).not.toHaveBeenCalled();
  });

  it("propagates axios errors", async () => {
    mockGet.mockRejectedValue(new Error("Network Error"));

    await expect(fetchCrimes(basePlan)).rejects.toThrow("Network Error");
  });
});
