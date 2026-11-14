import { describe, expect, it } from "vitest";
import { between } from "../src/lib/position.js";

describe("between", () => {
  it("a key after another sorts after it", () => {
    const first = between(null, null);
    expect(first < between(first, null)).toBe(true);
  });

  it("50 inserts at the top stay sorted", () => {
    const keys = [between(null, null)];
    for (let i = 0; i < 50; i++) keys.unshift(between(null, keys[0]));
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(51);
  });

  it("between(a, b) is strictly between", () => {
    const a = between(null, null);
    const b = between(a, null);
    const mid = between(a, b);
    expect(a < mid && mid < b).toBe(true);
  });
});
