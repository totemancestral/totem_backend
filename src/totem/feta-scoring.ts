/**
 * Source de vérité du scoring FETA (matrices + attribution).
 *
 * Copie synchronisée : totem-project/src/lib/feta-scoring.ts (source de vérité)
 * Toute évolution INTENTIONNELLE doit être répliquée dans les deux fichiers
 * et dans les golden tests (tests/golden-scoring.test.ts et
 * totem_backend/test/golden-scoring.spec.ts).
 */

export type ChoiceLetter = "A" | "B" | "C" | "D";
export type FetaDimension = "F" | "E" | "T" | "A";
export type FetaScores = Record<FetaDimension, number>;

export type AdultArchetypeId =
  | "lion"
  | "lionne"
  | "rhinoceros"
  | "crocodile"
  | "serpent"
  | "dauphin"
  | "elephant"
  | "baobab"
  | "zebre"
  | "perroquet"
  | "aigle"
  | "leopard";

export type JuniorTotemId =
  | "kwame_aigle"
  | "amara_lionne"
  | "zara_leopard"
  | "kemi_serpent"
  | "seun_elephant"
  | "aida_panthere"
  | "kofi_buffle"
  | "nala_grue"
  | "bakari_crocodile"
  | "fatou_faucon"
  | "dayo_lion"
  | "imani_tortue";

export type AdultFetaResult = {
  scores: FetaScores;
  dominant: FetaDimension;
  secondary: FetaDimension;
  archetypeId: AdultArchetypeId;
};

export type JuniorFetaResult = {
  scores: FetaScores;
  dominant: FetaDimension;
  secondary: FetaDimension;
  totemId: JuniorTotemId;
};

const ZERO_SCORES: FetaScores = { F: 0, E: 0, T: 0, A: 0 };
const DIMENSIONS: FetaDimension[] = ["F", "E", "T", "A"];

export const ADULT_SCORING: Record<number, Record<ChoiceLetter, FetaScores>> = {
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

export const ADULT_ATTRIBUTION: Record<
  FetaDimension,
  Record<FetaDimension, AdultArchetypeId>
> = {
  F: { A: "lion", T: "lionne", E: "rhinoceros", F: "lion" },
  E: { T: "crocodile", A: "serpent", F: "dauphin", E: "serpent" },
  T: { F: "elephant", E: "baobab", A: "zebre", T: "elephant" },
  A: { E: "perroquet", F: "aigle", T: "zebre", A: "aigle" },
};

export const JUNIOR_SCORING: Record<number, Record<ChoiceLetter, FetaScores>> = {
  1: {
    A: { F: 3, E: 0, T: 0, A: 1 },
    B: { F: 0, E: 3, T: 1, A: 0 },
    C: { F: 0, E: 1, T: 0, A: 3 },
    D: { F: 2, E: 0, T: 0, A: 2 },
  },
  2: {
    A: { F: 0, E: 1, T: 3, A: 0 },
    B: { F: 1, E: 0, T: 1, A: 3 },
    C: { F: 0, E: 3, T: 0, A: 1 },
    D: { F: 2, E: 0, T: 1, A: 2 },
  },
  3: {
    A: { F: 0, E: 2, T: 0, A: 2 },
    B: { F: 1, E: 0, T: 3, A: 0 },
    C: { F: 0, E: 0, T: 1, A: 3 },
    D: { F: 3, E: 1, T: 0, A: 0 },
  },
  4: {
    A: { F: 0, E: 2, T: 1, A: 1 },
    B: { F: 2, E: 0, T: 2, A: 0 },
    C: { F: 0, E: 1, T: 0, A: 3 },
    D: { F: 3, E: 1, T: 0, A: 0 },
  },
  5: {
    A: { F: 1, E: 0, T: 0, A: 3 },
    B: { F: 3, E: 0, T: 1, A: 0 },
    C: { F: 0, E: 0, T: 3, A: 1 },
    D: { F: 0, E: 3, T: 0, A: 1 },
  },
};

export const JUNIOR_ATTRIBUTION: Record<
  FetaDimension,
  Record<FetaDimension, JuniorTotemId>
> = {
  F: { A: "dayo_lion", E: "zara_leopard", T: "kofi_buffle", F: "amara_lionne" },
  E: { A: "kemi_serpent", T: "bakari_crocodile", F: "aida_panthere", E: "imani_tortue" },
  T: { F: "seun_elephant", A: "nala_grue", E: "imani_tortue", T: "seun_elephant" },
  A: { F: "kwame_aigle", E: "fatou_faucon", T: "kwame_aigle", A: "fatou_faucon" },
};

export function scoreAdultFeta(answers: Record<string, unknown>): AdultFetaResult {
  const scores: FetaScores = { ...ZERO_SCORES };

  for (let question = 1; question <= 10; question += 1) {
    const choice = getChoice(answers[String(question)]);
    if (!choice) continue;
    const score = ADULT_SCORING[question]?.[choice];
    if (!score) continue;
    for (const dimension of DIMENSIONS) {
      scores[dimension] += score[dimension];
    }
  }

  const allEqual = DIMENSIONS.every((dimension) => scores[dimension] === scores.F);
  if (allEqual) {
    return { scores, dominant: "T", secondary: "E", archetypeId: "baobab" };
  }

  const sorted = sortDimensions(scores);
  let dominant = sorted[0]!.dimension;

  if (sorted[0]!.score === sorted[1]!.score) {
    const tied = sorted
      .filter((item) => item.score === sorted[0]!.score)
      .map((item) => item.dimension);
    dominant =
      dominantFromQuestion(answers, 7, tied) ??
      dominantFromQuestion(answers, 3, tied) ??
      sorted[0]!.dimension;
  } else if (sorted[0]!.score - sorted[1]!.score < 3) {
    dominant = dominantFromQuestion(answers, 5) ?? sorted[0]!.dimension;
  }

  const secondary =
    sortDimensions(scores).find((item) => item.dimension !== dominant)?.dimension ?? dominant;
  const archetypeId =
    ADULT_ATTRIBUTION[dominant][secondary] ?? ADULT_ATTRIBUTION[dominant][dominant];

  return { scores, dominant, secondary, archetypeId };
}

export function scoreJuniorFeta(answers: Record<string, unknown>): JuniorFetaResult {
  const scores: FetaScores = { ...ZERO_SCORES };

  for (let question = 1; question <= 5; question += 1) {
    const choice = getChoice(answers[String(question)]);
    if (!choice) continue;
    const score = JUNIOR_SCORING[question]?.[choice];
    if (!score) continue;
    for (const dimension of DIMENSIONS) {
      scores[dimension] += score[dimension];
    }
  }

  const sorted = sortDimensions(scores);
  const dominant = sorted[0]!.dimension;
  const secondary = sorted.find((item) => item.dimension !== dominant)?.dimension ?? dominant;

  return {
    scores,
    dominant,
    secondary,
    totemId: JUNIOR_ATTRIBUTION[dominant][secondary] ?? JUNIOR_ATTRIBUTION[dominant][dominant],
  };
}

function getChoice(value: unknown): ChoiceLetter | null {
  if (!value || typeof value !== "object") return null;
  const answer = value as { choice?: string; skipped?: boolean };
  if (answer.skipped) return null;
  const choice = answer.choice;
  return choice === "A" || choice === "B" || choice === "C" || choice === "D" ? choice : null;
}

function dominantFromQuestion(
  answers: Record<string, unknown>,
  question: number,
  allowed?: FetaDimension[],
): FetaDimension | null {
  const choice = getChoice(answers[String(question)]);
  if (!choice) return null;
  const scores = ADULT_SCORING[question]?.[choice];
  if (!scores) return null;
  const dimension = sortDimensions(scores)[0]!.dimension;
  if (allowed && !allowed.includes(dimension)) return null;
  return dimension;
}

function sortDimensions(scores: FetaScores) {
  return DIMENSIONS.map((dimension) => ({ dimension, score: scores[dimension] })).sort(
    (left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return DIMENSIONS.indexOf(left.dimension) - DIMENSIONS.indexOf(right.dimension);
    },
  );
}
