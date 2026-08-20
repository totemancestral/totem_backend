import { describe, it, expect } from "vitest";
import { selectTotemAnimal } from "../src/totem/totem-animals";
import { scoreAdultFeta, scoreJuniorFeta } from "../src/totem/feta-scoring";

/**
 * Golden tests identiques à totem-project/tests/golden-scoring.test.ts.
 * Source de vérité : totem-project/src/lib/feta-scoring.ts (copie dans src/totem/feta-scoring.ts).
 */

const vec = (choices: string[]) =>
  Object.fromEntries(choices.map((choice, index) => [String(index + 1), { choice }]));

const backendVec = (answers: string[]) =>
  answers.map((answer, i) => ({ questionId: `q${i + 1}`, answer }));

describe("golden — scoreAdultFeta", () => {
  it("vecteur tout-A -> Lionne (F dominant, T secondaire)", () => {
    const r = scoreAdultFeta(vec(["A", "A", "A", "A", "A", "A", "A", "A", "A", "A"]));
    expect(r.scores).toEqual({ F: 32.5, E: 3, T: 12, A: 2.5 });
    expect(r.dominant).toBe("F");
    expect(r.secondary).toBe("T");
    expect(r.archetypeId).toBe("lionne");
  });

  it("vecteur A/B/C/D -> Crocodile (E dominant, T secondaire)", () => {
    const r = scoreAdultFeta(vec(["A", "B", "C", "D", "A", "B", "C", "D", "A", "B"]));
    expect(r.scores).toEqual({ F: 8, E: 20.5, T: 12.5, A: 9 });
    expect(r.dominant).toBe("E");
    expect(r.secondary).toBe("T");
    expect(r.archetypeId).toBe("crocodile");
  });

  it("vecteur orienté T -> Elephant (T dominant, F secondaire)", () => {
    const r = scoreAdultFeta(vec(["D", "D", "C", "C", "B", "B", "A", "A", "D", "C"]));
    expect(r.scores).toEqual({ F: 12, E: 5.5, T: 24.5, A: 5 });
    expect(r.dominant).toBe("T");
    expect(r.secondary).toBe("F");
    expect(r.archetypeId).toBe("elephant");
  });
});

describe("golden — scoreJuniorFeta", () => {
  it("vecteur A/B/C/D/A -> kwame_aigle (A dominant, F secondaire)", () => {
    const r = scoreJuniorFeta(vec(["A", "B", "C", "D", "A"]));
    expect(r.scores).toEqual({ F: 8, E: 1, T: 2, A: 10 });
    expect(r.dominant).toBe("A");
    expect(r.secondary).toBe("F");
    expect(r.totemId).toBe("kwame_aigle");
  });

  it("vecteur D/C/B/A/D -> kemi_serpent (E dominant, A secondaire)", () => {
    const r = scoreJuniorFeta(vec(["D", "C", "B", "A", "D"]));
    expect(r.scores).toEqual({ F: 3, E: 8, T: 4, A: 5 });
    expect(r.dominant).toBe("E");
    expect(r.secondary).toBe("A");
    expect(r.totemId).toBe("kemi_serpent");
  });
});

describe("golden — selectTotemAnimal (pipeline)", () => {
  it("vecteur tout-A -> lionne", () => {
    expect(selectTotemAnimal(backendVec(["A", "A", "A", "A", "A", "A", "A", "A", "A", "A"])).slug).toBe(
      "lionne",
    );
  });

  it("vecteur A/B/C/D -> crocodile", () => {
    expect(selectTotemAnimal(backendVec(["A", "B", "C", "D", "A", "B", "C", "D", "A", "B"])).slug).toBe(
      "crocodile",
    );
  });
});
