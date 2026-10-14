import { describe, expect, test } from "bun:test";
import { detectSavePlatform } from "../src/lib/platform";

describe("detectSavePlatform", () => {
  test("iPhone UA is ios", () => {
    expect(detectSavePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
  });
  test("Android UA is android", () => {
    expect(detectSavePlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
  });
  test("desktop Chrome is desktop", () => {
    expect(detectSavePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131")).toBe("desktop");
  });
});
