import { describe, it, expect } from "vitest";
import { selectTotemAnimal } from "../src/totem/totem-animals";

/**
 * Test « golden » backend : verrouille l'attribution scoring -> animal totem
 * pour des vecteurs de réponses fixes. Miroir du golden frontend
 * (totem-project/tests/golden-scoring.test.ts) : les deux repos partagent la
 * même taxonomie (ex. vecteur tout-A -> "lionne"). Toute divergence involontaire
 * de la matrice de scoring fera échouer ce test.
 */

const vec = (answers: string[]) =>
  answers.map((answer, i) => ({ questionId: `q${i + 1}`, answer }));

describe("golden — selectTotemAnimal", () => {
  it("vecteur tout-A -> lionne (aligné avec l'archétype frontend)", () => {
    const animal = selectTotemAnimal(
      vec(["A", "A", "A", "A", "A", "A", "A", "A", "A", "A"]),
    );
    expect(animal.slug).toBe("lionne");
  });

  it("vecteur D/C/B/A -> crocodile", () => {
    const animal = selectTotemAnimal(
      vec(["D", "C", "B", "A", "D", "C", "B", "A", "D", "C"]),
    );
    expect(animal.slug).toBe("crocodile");
  });
});
