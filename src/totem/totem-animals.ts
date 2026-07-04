import { QuestionnaireAnswer } from "./totem.types";

type Choice = "A" | "B" | "C" | "D";
type Dimension = "F" | "E" | "T" | "A";
type Scores = Record<Dimension, number>;

export type TotemAnimal = {
  name: string;
  slug: string;
  people: string;
  region: string;
  quality: string;
};

const dimensions: Dimension[] = ["F", "E", "T", "A"];
const zeroScores: Scores = { F: 0, E: 0, T: 0, A: 0 };

export const TOTEM_ANIMALS: TotemAnimal[] = [
  { slug: "lion", name: "Lion", people: "Yoruba", region: "Nigeria", quality: "Leadership" },
  { slug: "lionne", name: "Lionne", people: "Maasai", region: "Kenya / Tanzanie", quality: "Protection" },
  { slug: "rhinoceros", name: "Rhinoceros", people: "Zulu", region: "Afrique du Sud", quality: "Determination" },
  { slug: "crocodile", name: "Crocodile", people: "Mande", region: "Mali / Guinee", quality: "Gardien" },
  { slug: "serpent", name: "Serpent", people: "Fon", region: "Benin", quality: "Transformation" },
  { slug: "dauphin", name: "Dauphin", people: "Serer", region: "Senegal", quality: "Joie" },
  { slug: "elephant", name: "Elephant", people: "Akan", region: "Ghana", quality: "Memoire" },
  { slug: "baobab", name: "Baobab", people: "Wolof", region: "Senegal", quality: "Ancestralite" },
  { slug: "zebre", name: "Zebre", people: "Ndebele", region: "Afrique du Sud", quality: "Equilibre" },
  { slug: "perroquet", name: "Perroquet", people: "Ashanti", region: "Ghana", quality: "Parole" },
  { slug: "aigle", name: "Aigle", people: "Dogon", region: "Mali", quality: "Vision" },
  { slug: "leopard", name: "Leopard", people: "Yoruba", region: "Nigeria", quality: "Grace" },
];

const animalsBySlug = Object.fromEntries(TOTEM_ANIMALS.map((animal) => [animal.slug, animal]));

const scoring: Record<number, Record<Choice, Scores>> = {
  1: {
    A: { F: 3, E: 0, T: 0, A: 0 },
    B: { F: 0, E: 3, T: 0, A: 0 },
    C: { F: 0, E: 0, T: 3, A: 0 },
    D: { F: 0, E: 0, T: 0, A: 3 },
  },
  2: {
    A: { F: 3, E: 0, T: 1, A: 0 },
    B: { F: 1, E: 1, T: 0, A: 2 },
    C: { F: 0, E: 2, T: 2, A: 0 },
    D: { F: 0, E: 2, T: 0, A: 2 },
  },
  3: {
    A: { F: 6, E: 0, T: 2, A: 0 },
    B: { F: 0, E: 4, T: 0, A: 4 },
    C: { F: 0, E: 2, T: 6, A: 0 },
    D: { F: 2, E: 0, T: 0, A: 6 },
  },
  4: {
    A: { F: 3, E: 0, T: 1, A: 0 },
    B: { F: 0, E: 2, T: 0, A: 2 },
    C: { F: 1, E: 0, T: 3, A: 0 },
    D: { F: 0, E: 3, T: 0, A: 1 },
  },
  5: {
    A: { F: 2, E: 0, T: 1, A: 1 },
    B: { F: 3, E: 0, T: 0, A: 0 },
    C: { F: 0, E: 1, T: 2, A: 1 },
    D: { F: 0, E: 3, T: 0, A: 1 },
  },
  6: {
    A: { F: 1.5, E: 0, T: 0, A: 1.5 },
    B: { F: 0, E: 1.5, T: 1.5, A: 0 },
    C: { F: 1.5, E: 0, T: 1.5, A: 0 },
    D: { F: 0.5, E: 0.5, T: 0.5, A: 0.5 },
  },
  7: {
    A: { F: 6, E: 0, T: 2, A: 0 },
    B: { F: 2, E: 0, T: 0, A: 6 },
    C: { F: 2, E: 2, T: 4, A: 0 },
    D: { F: 0, E: 6, T: 0, A: 2 },
  },
  8: {
    A: { F: 2, E: 0, T: 3, A: 0 },
    B: { F: 2, E: 0, T: 2, A: 1 },
    C: { F: 0, E: 2, T: 2, A: 1 },
    D: { F: 0, E: 2, T: 0, A: 3 },
  },
  9: {
    A: { F: 0, E: 3, T: 0, A: 0 },
    B: { F: 0, E: 0, T: 0, A: 3 },
    C: { F: 3, E: 0, T: 0, A: 0 },
    D: { F: 0, E: 0, T: 3, A: 0 },
  },
  10: {
    A: { F: 6, E: 0, T: 2, A: 0 },
    B: { F: 0, E: 6, T: 0, A: 2 },
    C: { F: 0, E: 0, T: 6, A: 0 },
    D: { F: 2, E: 0, T: 0, A: 6 },
  },
};

const attribution: Record<Dimension, Record<Dimension, string>> = {
  F: { A: "lion", T: "lionne", E: "rhinoceros", F: "lion" },
  E: { T: "crocodile", A: "serpent", F: "dauphin", E: "serpent" },
  T: { F: "elephant", E: "baobab", A: "zebre", T: "elephant" },
  A: { E: "perroquet", F: "aigle", T: "zebre", A: "aigle" },
};

export function selectTotemAnimal(answers: QuestionnaireAnswer[]): TotemAnimal {
  const scored = scoreAdultAnswers(answers);
  if (scored) return scored;

  const signature = answers
    .map(
      (answer) =>
        `${normalizeSignaturePart(answer.questionId)}:${normalizeSignaturePart(answer.answer)}`,
    )
    .join("|")
    .trim();
  const hash = hashTotemSignature(signature || "totem-ancestral");

  return TOTEM_ANIMALS[hash % TOTEM_ANIMALS.length] ?? TOTEM_ANIMALS[0]!;
}

export function allowedTotemAnimalNames(): string {
  return TOTEM_ANIMALS.map((animal) => animal.name).join(", ");
}

function scoreAdultAnswers(answers: QuestionnaireAnswer[]): TotemAnimal | null {
  const byQuestion = new Map<number, Choice>();
  for (const answer of answers) {
    const question = Number(answer.questionId.replace(/^q/i, ""));
    const choice = parseChoice(answer.answer);
    if (question >= 1 && question <= 10 && choice) byQuestion.set(question, choice);
  }

  if (byQuestion.size < 10) return null;

  const scores: Scores = { ...zeroScores };
  for (let question = 1; question <= 10; question += 1) {
    const choice = byQuestion.get(question);
    if (!choice) continue;
    const questionScores = scoring[question]?.[choice];
    if (!questionScores) continue;
    for (const dimension of dimensions) {
      scores[dimension] += questionScores[dimension];
    }
  }

  const allEqual = dimensions.every((dimension) => scores[dimension] === scores.F);
  if (allEqual) return animalsBySlug.baobab ?? TOTEM_ANIMALS[0]!;

  const sorted = sortDimensions(scores);
  const first = sorted[0]!;
  const second = sorted[1]!;
  let dominant = first.dimension;

  if (first.score === second.score) {
    const tied = sorted.filter((item) => item.score === first.score).map((item) => item.dimension);
    dominant =
      dominantFromQuestion(byQuestion, 7, tied) ??
      dominantFromQuestion(byQuestion, 3, tied) ??
      dominant;
  } else if (first.score - second.score < 3) {
    dominant = dominantFromQuestion(byQuestion, 5) ?? dominant;
  }

  const secondary = sortDimensions(scores).find((item) => item.dimension !== dominant)?.dimension ?? dominant;
  const slug = attribution[dominant]?.[secondary] ?? attribution[dominant]?.[dominant] ?? "baobab";

  return animalsBySlug[slug] ?? animalsBySlug.baobab ?? TOTEM_ANIMALS[0]!;
}

function parseChoice(answer: string): Choice | null {
  const match = answer.trim().match(/^([ABCD])(?:\b|\s|\|)/i);
  const value = match?.[1]?.toUpperCase();
  return value === "A" || value === "B" || value === "C" || value === "D" ? value : null;
}

function dominantFromQuestion(
  byQuestion: Map<number, Choice>,
  question: number,
  allowed?: Dimension[],
): Dimension | null {
  const choice = byQuestion.get(question);
  if (!choice) return null;
  const questionScores = scoring[question]?.[choice];
  if (!questionScores) return null;
  const dimension = sortDimensions(questionScores)[0]?.dimension;
  if (!dimension) return null;
  if (allowed && !allowed.includes(dimension)) return null;
  return dimension;
}

function sortDimensions(scores: Scores) {
  return dimensions
    .map((dimension) => ({ dimension, score: scores[dimension] }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return dimensions.indexOf(left.dimension) - dimensions.indexOf(right.dimension);
    });
}

function normalizeSignaturePart(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function hashTotemSignature(value: string): number {
  let hash = 2166136261;
  for (const [index, char] of Array.from(value).entries()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
    hash ^= index + value.length;
  }
  return hash >>> 0;
}
