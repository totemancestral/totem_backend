export function normalizeTotemTitle(rawTitle: string, animalName?: string): string {
  const title = rawTitle.trim().replace(/\s+/g, " ");
  const knownRepair = repairKnownTitle(title);
  if (knownRepair) return knownRepair;

  const animal = animalName?.trim();
  if (!animal) return title;

  const withoutDuplicatePrefix = removeDuplicateAnimalPrefix(title, animal);
  return repairKnownTitle(withoutDuplicatePrefix) ?? withoutDuplicatePrefix;
}

export function containsAnimalName(value: string, animalName: string): boolean {
  const normalizedValue = normalizeForCompare(value);
  const normalizedAnimal = normalizeForCompare(animalName);

  if (!normalizedAnimal) return false;

  return new RegExp(`(^|\\s)${escapeRegExp(normalizedAnimal)}($|\\s)`, "i").test(
    normalizedValue,
  );
}

function removeDuplicateAnimalPrefix(title: string, animalName: string): string {
  const normalizedTitle = normalizeForCompare(title);
  const normalizedAnimal = normalizeForCompare(animalName);

  if (!normalizedTitle.startsWith(`${normalizedAnimal} `)) {
    return title;
  }

  const remainder = title.slice(animalName.length).trim();
  return containsAnimalName(remainder, animalName) ? remainder : title;
}

function repairKnownTitle(title: string): string | null {
  const key = normalizeForCompare(title);
  const dindonRepairs = new Set([
    "dindon veille",
    "dindon dindon veille",
    "le dindon veille",
    "le dindon dindon veille",
  ]);

  if (dindonRepairs.has(key)) {
    return "Le Dindon la veille";
  }

  return null;
}

function normalizeForCompare(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
