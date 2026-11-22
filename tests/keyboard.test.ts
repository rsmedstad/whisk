import { describe, expect, test } from "bun:test";
import { isKeyboardOpen, isTextEditable } from "../src/lib/keyboard";

describe("isKeyboardOpen", () => {
  const base = { innerHeight: 844, viewportHeight: 844, viewportScale: 1, editableFocused: true };

  test("focused field with a short viewport is open", () => {
    expect(isKeyboardOpen({ ...base, viewportHeight: 500 })).toBe(true);
  });
  test("no focused field is closed even if the viewport reads short (stale iOS resize)", () => {
    expect(isKeyboardOpen({ ...base, viewportHeight: 500, editableFocused: false })).toBe(false);
  });
  test("pinch zoom is not a keyboard", () => {
    expect(isKeyboardOpen({ ...base, viewportHeight: 422, viewportScale: 2 })).toBe(false);
  });
  test("full viewport is closed", () => {
    expect(isKeyboardOpen(base)).toBe(false);
  });
});

describe("isTextEditable", () => {
  test("text inputs and textareas count", () => {
    expect(isTextEditable({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(isTextEditable({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEditable({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  test("buttons, checkboxes and read-only fields do not", () => {
    expect(isTextEditable({ tagName: "BUTTON" })).toBe(false);
    expect(isTextEditable({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTextEditable({ tagName: "INPUT", type: "text", readOnly: true })).toBe(false);
    expect(isTextEditable(null)).toBe(false);
  });
});
