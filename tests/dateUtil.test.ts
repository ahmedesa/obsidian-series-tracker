import { describe, it, expect } from "vitest";
import { formatDurationMinutes } from "../src/dateUtil";

describe("formatDurationMinutes", () => {
  it("formats minutes only", () => {
    expect(formatDurationMinutes(45)).toBe("45m");
  });

  it("formats hours and minutes", () => {
    expect(formatDurationMinutes(90)).toBe("1h 30m");
  });

  it("formats whole hours with no leftover minutes", () => {
    expect(formatDurationMinutes(120)).toBe("2h");
  });

  it("formats days and hours", () => {
    expect(formatDurationMinutes(1500)).toBe("1d 1h");
  });

  it("formats whole days with no leftover hours", () => {
    expect(formatDurationMinutes(24 * 60)).toBe("1d");
  });

  it("returns 0m for zero or negative input", () => {
    expect(formatDurationMinutes(0)).toBe("0m");
    expect(formatDurationMinutes(-5)).toBe("0m");
  });
});
