import { QuestionnaireAnswer } from "./totem.types";

export type TotemAnimal = { name: string; slug: string };

export const TOTEM_ANIMALS: TotemAnimal[] = [
  "Éléphant",
  "Lion",
  "Python",
  "Crocodile",
  "Serpent",
  "Rhinocéros",
  "Aigle",
  "Perroquet",
  "Zèbre",
  "Léopard",
  "Panthère",
  "Guépard",
  "Hyène",
  "Buffle",
  "Hippopotame",
  "Girafe",
  "Gorille",
  "Chimpanzé",
  "Babouin",
  "Singe vert",
  "Mandrill",
  "Antilope",
  "Gazelle",
  "Impala",
  "Oryx",
  "Koudou",
  "Phacochère",
  "Pangolin",
  "Tortue",
  "Caméléon",
  "Varane",
  "Gecko",
  "Cobra",
  "Vipère",
  "Boa",
  "Mamba noir",
  "Rose flamboyante",
  "Autruche",
  "Calao",
  "Marabout",
  "Pélican",
  "Héron",
  "Ibis",
  "Faucon",
  "Vautour",
  "Hibou",
  "Chouette",
  "Corbeau",
  "Colombe",
  "Paon",
  "Grue couronnée",
  "Abeille",
  "Fourmi",
  "Termite",
  "Scarabée",
  "Papillon",
  "Libellule",
  "Moustique",
  "Scorpion",
  "Araignée",
  "Crabe",
  "Crevette",
  "Chat de poisson",
  "Tilapia",
  "Carpe",
  "Requin",
  "Baleine",
  "Lamantin",
  "Phoque moine",
  "Chacal",
  "Renard du désert",
  "Fennec",
  "Lycaon",
  "Civette",
  "Genette",
  "Mangouste",
  "Suricate",
  "Loutre",
  "Écureuil",
  "Rat palmiste",
  "Lièvre",
  "Porc-épic",
  "Hérisson",
  "Chauve-souris",
  "Âne",
  "Cheval",
  "Dromadaire",
  "Chameau",
  "Taureau",
  "Vache",
  "Bélier",
  "Bouc",
  "Chèvre",
  "Coq",
  "Poule",
  "Pintade",
  "Canard",
  "Oie",
  "Chat sauvage",
].map((name) => ({ name, slug: slugifyAnimal(name) }));

export function selectTotemAnimal(answers: QuestionnaireAnswer[]): TotemAnimal {
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

function slugifyAnimal(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
