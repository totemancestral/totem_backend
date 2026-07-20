import { describe, it, expect } from "vitest";
import {
  TOTEM_ANIMALS,
  selectTotemAnimal,
  allowedTotemAnimalNames,
} from "../src/totem/totem-animals";

const answers = [
  { questionId: "q1", answer: "A" },
  { questionId: "q2", answer: "B" },
  { questionId: "q3", answer: "C" },
];

describe("TOTEM_ANIMALS", () => {
  it("contient 12 animaux avec des slugs uniques", () => {
    expect(TOTEM_ANIMALS).toHaveLength(12);
    const slugs = new Set(TOTEM_ANIMALS.map((animal) => animal.slug));
    expect(slugs.size).toBe(12);
  });

  it("chaque animal expose les champs attendus", () => {
    for (const animal of TOTEM_ANIMALS) {
      expect(animal.name.length).toBeGreaterThan(0);
      expect(animal.slug.length).toBeGreaterThan(0);
      expect(animal.people.length).toBeGreaterThan(0);
      expect(animal.region.length).toBeGreaterThan(0);
      expect(animal.quality.length).toBeGreaterThan(0);
    }
  });
});

describe("selectTotemAnimal", () => {
  it("retourne un animal issu du catalogue", () => {
    expect(TOTEM_ANIMALS).toContainEqual(selectTotemAnimal(answers));
  });

  it("est deterministe pour une meme entree", () => {
    expect(selectTotemAnimal(answers)).toEqual(selectTotemAnimal(answers));
  });
});

describe("allowedTotemAnimalNames", () => {
  it("liste les noms d'animaux du catalogue", () => {
    const names = allowedTotemAnimalNames();
    expect(typeof names).toBe("string");
    expect(names).toContain("Lion");
  });
});
