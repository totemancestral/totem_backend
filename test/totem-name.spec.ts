import { describe, it, expect } from "vitest";
import { normalizeTotemTitle, containsAnimalName } from "../src/totem/totem-name";

describe("normalizeTotemTitle", () => {
  it("compacte les espaces multiples", () => {
    expect(normalizeTotemTitle("  Le   Grand    Lion  ")).toBe("Le Grand Lion");
  });

  it("supprime le prefixe animal duplique", () => {
    expect(normalizeTotemTitle("Lion Lion le fier", "Lion")).toBe("Lion le fier");
  });

  it("repare les titres connus (dindon)", () => {
    expect(normalizeTotemTitle("Le Dindon veille")).toBe("Le Dindon la veille");
  });
});

describe("containsAnimalName", () => {
  it("detecte le nom d'animal comme mot entier", () => {
    expect(containsAnimalName("Le Lion rugit", "Lion")).toBe(true);
  });

  it("ne matche pas un sous-mot", () => {
    expect(containsAnimalName("Le Lionceau joue", "Lion")).toBe(false);
  });

  it("renvoie false pour un nom d'animal vide", () => {
    expect(containsAnimalName("rien", "")).toBe(false);
  });
});
