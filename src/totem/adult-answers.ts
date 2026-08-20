import { z } from "zod";
import type { QuestionnaireAnswer } from "./totem.types";

const questionIds = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10"] as const;
const questionIdSchema = z.enum(questionIds);
const contextIdSchema = z.enum(["sexe"]);
const choicePattern = /^[ABCD](?:\s*\|\s*.*)?$/i;

export const adultAnswerSchema = z.object({
  questionId: questionIdSchema,
  answer: z.string().min(1).max(4000),
});

const contextAnswerSchema = z.object({
  questionId: contextIdSchema,
  answer: z.string().min(1).max(80),
});

export const adultAnswersSchema = z
  .array(z.union([adultAnswerSchema, contextAnswerSchema]))
  .superRefine((answers, ctx) => {
    const questionnaireAnswers = answers.filter((answer) => questionIdSchema.safeParse(answer.questionId).success);
    const ids = questionnaireAnswers.map((answer) => answer.questionId);
    const uniqueIds = new Set(ids);

    if (questionnaireAnswers.length !== questionIds.length || uniqueIds.size !== questionIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "adult_answers_must_contain_q1_to_q10_once",
      });
      return;
    }

    for (const questionId of questionIds) {
      const answer = questionnaireAnswers.find((item) => item.questionId === questionId)?.answer.trim() ?? "";
      if (questionId === "q6" && answer.toLowerCase() === "skipped") continue;
      if (!choicePattern.test(answer)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${questionId}_must_start_with_choice_or_be_skipped`,
        });
      }
    }
  });

export function extractAdultAnswers(value: unknown): QuestionnaireAnswer[] | null {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value) && "answers" in value
      ? (value as { answers?: unknown }).answers
      : value;
  return normalizeAdultAnswers(candidate);
}

export function isCompleteAdultAnswers(value: unknown): boolean {
  return extractAdultAnswers(value) !== null;
}

export function normalizeAdultAnswers(value: unknown): QuestionnaireAnswer[] | null {
  const parsed = adultAnswersSchema.safeParse(value);
  if (!parsed.success) return null;

  const questionnaireAnswers = parsed.data
    .filter((answer) => questionIdSchema.safeParse(answer.questionId).success)
    .sort(
      (left, right) =>
        questionIds.indexOf(left.questionId as (typeof questionIds)[number]) -
        questionIds.indexOf(right.questionId as (typeof questionIds)[number]),
    );
  const contextAnswers = parsed.data.filter(
    (answer) => !questionIdSchema.safeParse(answer.questionId).success,
  );

  return [...questionnaireAnswers, ...contextAnswers];
}

export function isAdultQuestionnaireAnswer(value: unknown): value is QuestionnaireAnswer {
  return adultAnswerSchema.safeParse(value).success;
}
