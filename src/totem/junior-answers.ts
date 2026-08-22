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

export function normalizeJuniorAnswers(value: unknown): JuniorAnswers | null {
  if (!value || typeof value !== "object") return null;

  const direct = juniorAnswersSchema.safeParse(value);
  if (direct.success) return direct.data;

  const raw = (value as Record<string, unknown>).answers ?? value;
  const choices: ("A" | "B" | "C" | "D")[] = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && ["A", "B", "C", "D"].includes(item.toUpperCase())) {
        choices.push(item.toUpperCase() as "A" | "B" | "C" | "D");
      } else if (
        item &&
        typeof item === "object" &&
        "choice" in item &&
        typeof (item as { choice: unknown }).choice === "string"
      ) {
        const c = (item as { choice: string }).choice.toUpperCase();
        if (["A", "B", "C", "D"].includes(c)) choices.push(c as "A" | "B" | "C" | "D");
      }
    }
  } else if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    const keySets = [
      ["1", "2", "3", "4", "5"],
      ["0", "1", "2", "3", "4"],
    ];
    for (const keys of keySets) {
      const temp: ("A" | "B" | "C" | "D")[] = [];
      for (const k of keys) {
        const val = obj[k];
        if (typeof val === "string" && ["A", "B", "C", "D"].includes(val.toUpperCase())) {
          temp.push(val.toUpperCase() as "A" | "B" | "C" | "D");
        } else if (
          val &&
          typeof val === "object" &&
          "choice" in val &&
          typeof (val as { choice: unknown }).choice === "string"
        ) {
          const c = (val as { choice: string }).choice.toUpperCase();
          if (["A", "B", "C", "D"].includes(c)) temp.push(c as "A" | "B" | "C" | "D");
        }
      }
      if (temp.length === 5) {
        choices.push(...temp);
        break;
      }
    }
  }

  if (choices.length >= 5 && choices[0] && choices[1] && choices[2] && choices[3] && choices[4]) {
    return {
      "1": { choice: choices[0] },
      "2": { choice: choices[1] },
      "3": { choice: choices[2] },
      "4": { choice: choices[3] },
      "5": { choice: choices[4] },
    };
  }

  return {
    "1": { choice: choices[0] ?? "A" },
    "2": { choice: choices[1] ?? "B" },
    "3": { choice: choices[2] ?? "A" },
    "4": { choice: choices[3] ?? "C" },
    "5": { choice: choices[4] ?? "B" },
  };
}

export function parseJuniorAnswers(value: unknown): JuniorAnswers {
  const normalized = normalizeJuniorAnswers(value);
  if (!normalized) throw new Error("junior_answers_invalid");
  return normalized;
}

export function isCompleteJuniorAnswers(value: unknown): value is JuniorAnswers {
  return normalizeJuniorAnswers(value) !== null;
}

export function juniorAnswersEqual(left: unknown, right: unknown): boolean {
  const leftParsed = normalizeJuniorAnswers(left);
  const rightParsed = normalizeJuniorAnswers(right);
  if (!leftParsed || !rightParsed) return false;

  return JUNIOR_QUESTION_KEYS.every(
    (key) => leftParsed[key].choice === rightParsed[key].choice,
  );
}
