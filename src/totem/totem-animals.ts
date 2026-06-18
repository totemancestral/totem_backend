import { QuestionnaireAnswer } from "./totem.types";

export type TotemAnimal = { name: string; slug: string };

export const TOTEM_ANIMALS: TotemAnimal[] = [
  "Elephant",
  "Lion",
  "Python",
  "Crocodile",
  "Serpent",
  "Rhinoceros",
  "Aigle",
  "Perroquet",
  "Zebre",
  "Leopard",
  "Panthere",
  "Guepard",
  "Hyene",
  "Buffle",
  "Hippopotame",
  "Girafe",
  "Gorille",
  "Chimpanze",
  "Babouin",
  "Singe vert",
  "Mandrill",
  "Antilope",
  "Gazelle",
  "Impala",
  "Oryx",
  "Koudou",
  "Phacochere",
  "Pangolin",
  "Tortue",
  "Cameleon",
  "Varane",
  "Gecko",
  "Cobra",
  "Vipere",
  "Boa",
  "Mamba noir",
  "Rose flamboyante",
  "Autruche",
  "Calao",
  "Marabout",
  "Pelican",
  "Heron",
  "Ibis",
  "Faucon",
  "Vautour",
  "Hibou",
  "Chouette",
  "Corbeau",
  "Colombe",
  "Paon",
  "Grue couronnee",
  "Abeille",
  "Fourmi",
  "Termite",
  "Scarabee",
  "Papillon",
  "Libellule",
  "Moustique",
  "Scorpion",
  "Araignee",
  "Crabe",
  "Crevette",
  "Chat poisson",
  "Tilapia",
  "Carpe",
  "Requin",
  "Baleine",
  "Lamantin",
  "Phoque moine",
  "Chacal",
  "Renard du desert",
  "Fennec",
  "Lycaon",
  "Civette",
  "Genette",
  "Mangouste",
  "Suricate",
  "Loutre",
  "Ecureuil",
  "Rat palmiste",
  "Lievre",
  "Porc-epic",
  "Herisson",
  "Chauve-souris",
  "Ane",
  "Cheval",
  "Dromadaire",
  "Chameau",
  "Taureau",
  "Vache",
  "Belier",
  "Bouc",
  "Chevre",
  "Coq",
  "Poule",
  "Pintade",
  "Canard",
  "Oie",
  "Chat sauvage",
].map((name) => ({ name, slug: slugifyAnimal(name) }));

export function selectTotemAnimal(answers: QuestionnaireAnswer[]): TotemAnimal {
  const signature = answers
    .map((answer) => `${answer.questionId}:${answer.answer}`)
    .join("|")
    .trim();
  let hash = 2166136261;
  const input = signature || "totem-ancestral";

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return TOTEM_ANIMALS[Math.abs(hash) % TOTEM_ANIMALS.length] ?? TOTEM_ANIMALS[0]!;
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
