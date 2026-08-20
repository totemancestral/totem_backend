import { describe, expect, it } from "vitest";
import {
  extractAdultAnswers,
  isCompleteAdultAnswers,
  normalizeAdultAnswers,
} from "../src/totem/adult-answers";

function answers() {
  return Array.from({ length: 10 }, (_, index) => ({
    questionId: `q${index + 1}`,
    answer: index === 5 ? "skipped" : "A | nuance",
  }));
}

describe("adult answer contract", () => {
  it("accepts a permutation and normalizes q1..q10", () => {
    const value = [...answers()].reverse();
    expect(normalizeAdultAnswers(value)?.map((answer) => answer.questionId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `q${index + 1}`),
    );
  });

  it("accepts q6 skipped and ignores sexe as context", () => {
    const value = [...answers(), { questionId: "sexe", answer: "femme" }];
    expect(isCompleteAdultAnswers(value)).toBe(true);
    expect(extractAdultAnswers({ answers: value })).toEqual([
      ...answers(),
      { questionId: "sexe", answer: "femme" },
    ]);
  });

  it("rejects duplicates and missing questions", () => {
    const duplicate = [...answers().slice(0, 9), { questionId: "q1", answer: "A" }];
    const missing = answers().filter((answer) => answer.questionId !== "q6");
    expect(isCompleteAdultAnswers(duplicate)).toBe(false);
    expect(isCompleteAdultAnswers(missing)).toBe(false);
  });

  it("rejects a missing choice outside q6", () => {
    const value = answers().map((answer) =>
      answer.questionId === "q5" ? { ...answer, answer: "nuance only" } : answer,
    );
    expect(isCompleteAdultAnswers(value)).toBe(false);
  });
});
