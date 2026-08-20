import { QuestionnaireAnswer } from "./totem.types";
import { scoreAdultFeta, type ChoiceLetter } from "./feta-scoring";

export type TotemAnimal = {
  name: string;
  slug: string;
  people: string;
  region: string;
  quality: string;
};

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
  const record: Record<string, { choice: ChoiceLetter }> = {};
  for (const answer of answers) {
    const question = Number(answer.questionId.replace(/^q/i, ""));
    const choice = parseChoice(answer.answer);
    if (question >= 1 && question <= 10 && choice) {
      record[String(question)] = { choice };
    }
  }

  if (Object.keys(record).length < 10) return null;

  const scored = scoreAdultFeta(record);
  return animalsBySlug[scored.archetypeId] ?? animalsBySlug.baobab ?? TOTEM_ANIMALS[0]!;
}

function parseChoice(answer: string): ChoiceLetter | null {
  const match = answer.trim().match(/^([ABCD])(?:\b|\s|\|)/i);
  const value = match?.[1]?.toUpperCase();
  return value === "A" || value === "B" || value === "C" || value === "D" ? value : null;
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
