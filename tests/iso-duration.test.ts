import { describe, expect, test } from "bun:test";
import { parseDurationToMin } from "../functions/api/discover/feed";
import { parseDuration } from "../functions/api/import/url";

const CASES: [string, number][] = [
  ["PT1500S", 25],
  ["PT3000S", 50],
  ["PT1H30M", 90],
  ["PT45S", 1],
];

describe("parseDuration (import/url)", () => {
  test.each(CASES)("%s → %i minutes", (iso, minutes) => {
    expect(parseDuration(iso)).toBe(minutes);
  });
});

describe("parseDurationToMin (discover/feed)", () => {
  test.each(CASES)("%s → %i minutes", (iso, minutes) => {
    expect(parseDurationToMin(iso)).toBe(minutes);
  });
});
