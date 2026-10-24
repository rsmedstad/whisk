import { describe, expect, test } from "bun:test";
import { sniffImageType } from "../functions/lib/image-sniff";
import { safeFetch } from "../functions/lib/ssrf";

const buf = (bytes: number[]) => new Uint8Array(bytes).buffer as ArrayBuffer;

describe("sniffImageType", () => {
  test("detects jpeg, png, webp, heic", () => {
    expect(sniffImageType(buf([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    const webp = [..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0)));
    expect(sniffImageType(buf(webp))).toBe("image/webp");
    const heic = [0, 0, 0, 24].concat([..."ftypheic"].map((c) => c.charCodeAt(0)));
    expect(sniffImageType(buf(heic))).toBe("image/heic");
  });
  test("rejects non-images", () => {
    expect(sniffImageType(buf([...("<html>").split("").map((c) => c.charCodeAt(0))]))).toBeNull();
  });
});

describe("safeFetch", () => {
  test("blocks internal hosts and redirects to them", async () => {
    await expect(safeFetch("http://169.254.169.254/")).rejects.toThrow();
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/x" } })) as unknown as typeof fetch;
    try {
      await expect(safeFetch("https://example.com/")).rejects.toThrow();
    } finally {
      globalThis.fetch = orig;
    }
  });
});
