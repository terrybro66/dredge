import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  function MockOpenAI() {
    return { chat: { completions: { create: mockCreate } } };
  }
  return { default: MockOpenAI };
});

import { parseIntent } from "../intent";

beforeEach(() => {
  mockCreate.mockReset();
});

describe("parseIntent", () => {
  it("parses a burglary query correctly", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              category: "burglary",
              date: "2024-01",
              poly: "52.2,0.1:52.3,0.2:52.3,0.3:52.2,0.3",
              viz_hint: "map",
            }),
          },
        },
      ],
    });

    const result = await parseIntent(
      "Show me burglaries in Cambridge last month",
    );

    expect(result).toEqual({
      category: "burglary",
      date: "2024-01",
      poly: "52.2,0.1:52.3,0.2:52.3,0.3:52.2,0.3",
      viz_hint: "map",
    });

    expect(mockCreate).toHaveBeenCalledWith({
      model: "deepseek-chat",
      max_tokens: 256,
      messages: [
        {
          role: "system",
          content: expect.stringContaining("Available crime categories"),
        },
        { role: "user", content: "Show me burglaries in Cambridge last month" },
      ],
    });
  });

  it("parses an all-crime query with table viz", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              category: "all-crime",
              date: "2024-02",
              poly: "51.5,-0.1:51.6,-0.1:51.6,0.0:51.5,0.0",
              viz_hint: "table",
            }),
          },
        },
      ],
    });

    const result = await parseIntent("List all crimes in London February 2024");

    expect(result).toEqual({
      category: "all-crime",
      date: "2024-02",
      poly: "51.5,-0.1:51.6,-0.1:51.6,0.0:51.5,0.0",
      viz_hint: "table",
    });
  });

  it("throws error for invalid JSON response", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Invalid JSON response" } }],
    });

    await expect(parseIntent("some query")).rejects.toThrow(
      "Failed to parse intent",
    );
  });

  it("throws error for missing required fields", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              category: "burglary",
            }),
          },
        },
      ],
    });

    await expect(parseIntent("some query")).rejects.toThrow(
      "Missing required fields",
    );
  });

  it("throws error for invalid viz_hint", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              category: "burglary",
              date: "2024-01",
              poly: "52.2,0.1:52.3,0.2",
              viz_hint: "invalid",
            }),
          },
        },
      ],
    });

    await expect(parseIntent("some query")).rejects.toThrow("Invalid viz_hint");
  });
});
