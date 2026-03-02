import { describe, expect, it } from "vitest";

import { getNestedValue } from "../core/utils.js";

describe("getNestedValue", () => {
  it("accesses simple array index", () => {
    expect(getNestedValue(["a", "b", "c"], [0])).toBe("a");
  });

  it("accesses deep nested path", () => {
    const data = [null, null, null, null, null, [null, null, [[null, ["target"]]]]];
    expect(getNestedValue(data, [5, 2, 0, 1, 0])).toBe("target");
  });

  it("uses fallback when path resolves to undefined", () => {
    expect(getNestedValue(["a"], [5], "fallback")).toBe("fallback");
  });

  it("uses fallback when intermediate is null", () => {
    expect(getNestedValue([null], [0, 1], "fallback")).toBe("fallback");
  });

  it("supports string key access on object", () => {
    expect(getNestedValue({ a: { b: 7 } }, ["a", "b"])).toBe(7);
  });

  it("returns root data for empty path", () => {
    const root = { a: 1 };
    expect(getNestedValue(root, [])).toBe(root);
  });

  it("uses fallback when intermediate is a non-object", () => {
    expect(getNestedValue([42], [0, "x"], "fallback")).toBe("fallback");
  });

  it("returns null (not fallback) when final resolved value is null", () => {
    expect(getNestedValue([null, "a", "b"], [0], "fallback")).toBeNull();
    expect(getNestedValue([["x", null]], [0, 1], "fallback")).toBeNull();
  });
});
