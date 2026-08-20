import { z } from "zod";

export const JUNIOR_QUESTION_KEYS = ["1", "2", "3", "4", "5"] as const;

const juniorAnswerSchema = z.object({
  choice: z.enum(["A", "B", "C", "D"]),
});

export const juniorAnswersSchema = z
  .object({
    "1": juniorAnswerSchema,
    "2": juniorAnswerSchema,
    "3": juniorAnswerSchema,
    "4": juniorAnswerSchema,
    "5": juniorAnswerSchema,
  })
  .strict();

export type JuniorAnswers = z.infer<typeof juniorAnswersSchema>;

export function parseJuniorAnswers(value: unknown): JuniorAnswers {
  return juniorAnswersSchema.parse(value);
}

export function isCompleteJuniorAnswers(value: unknown): value is JuniorAnswers {
  return juniorAnswersSchema.safeParse(value).success;
}

export function juniorAnswersEqual(left: unknown, right: unknown): boolean {
  const leftParsed = juniorAnswersSchema.safeParse(left);
  const rightParsed = juniorAnswersSchema.safeParse(right);
  if (!leftParsed.success || !rightParsed.success) return false;

  return JUNIOR_QUESTION_KEYS.every(
    (key) => leftParsed.data[key].choice === rightParsed.data[key].choice,
  );
}
