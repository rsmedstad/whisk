import { describe, expect, test } from "bun:test";
import { ApiRequestError } from "../src/lib/api";

describe("ApiRequestError", () => {
  test("carries code and HTTP status", () => {
    const err = new ApiRequestError("Recipe not found", undefined, 404);
    expect(err.status).toBe(404);
    expect(err.code).toBeUndefined();
    expect(new ApiRequestError("x", "source_blocked").status).toBeUndefined();
  });
});
