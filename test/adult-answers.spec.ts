import { describe, expect, it } from "vitest";
import {
  extractAdultAnswers,
  isCompleteAdultAnswers,
  normalizeAdultAnswers,
  adultCheckoutAnswersSchema,
} from "../src/totem/adult-answers";

function answers() {
  return Array.from({ length: 10 }, (_, index) => ({
    questionId: `q${index + 1}`,
    answer: index === 5 ? "skipped" : "A | nuance",
  }));
}

describe("adult answer contract", () => {
  it("accepts four answers for payment but not for generation", () => {
    const firstFour = answers().slice(0, 4);
    expect(adultCheckoutAnswersSchema.safeParse(firstFour).success).toBe(true);
    expect(isCompleteAdultAnswers({ answers: firstFour })).toBe(false);
    expect(adultCheckoutAnswersSchema.safeParse(answers()).success).toBe(true);
  });

  it("does not count gender or duplicate answers towards the four-question gate", () => {
    const firstThree = answers().slice(0, 3);
    expect(adultCheckoutAnswersSchema.safeParse([...firstThree, { questionId: "sexe", answer: "femme" }]).success).toBe(false);
    expect(adultCheckoutAnswersSchema.safeParse([...firstThree, firstThree[0]]).success).toBe(false);
    expect(adultCheckoutAnswersSchema.safeParse([...firstThree, { questionId: "q5", answer: "A" }]).success).toBe(false);
  });

  it("requires an actual choice in the first four answers", () => {
    expect(adultCheckoutAnswersSchema.safeParse(answers().slice(0, 4).map((a) => a.questionId === "q4" ? { ...a, answer: "free text only" } : a)).success).toBe(false);
  });
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
