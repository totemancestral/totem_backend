import type { JuniorTotemId } from "./feta-scoring";

// Editorial descriptions belong to the revealed animal, never to a fixed sample.
const profiles: Record<JuniorTotemId, [string, string, string, string, string[], string[]]> = {
  zara_leopard: ["Léopard", "Leopard", "du Léopard", "tu frappes juste, au bon moment.", ["Précision", "Mystère", "Tranchant", "Silence"], ["Precision", "Mystery", "Sharpness", "Silence"]],
  dayo_lion: ["Lion", "Lion", "du Lion", "ton énergie éclaire le chemin.", ["Intensité", "Courage", "Énergie", "Initiative"], ["Intensity", "Courage", "Energy", "Initiative"]],
  amara_lionne: ["Lionne", "Lioness", "de la Lionne", "ta présence protège ceux qui t’entourent.", ["Protection", "Courage", "Solidarité", "Vigilance"], ["Protection", "Courage", "Solidarity", "Vigilance"]],
  kofi_buffle: ["Buffle", "Buffalo", "du Buffle", "tu avances avec force et constance.", ["Endurance", "Force", "Constance", "Ancrage"], ["Endurance", "Strength", "Consistency", "Grounding"]],
  kemi_serpent: ["Serpent royal", "Royal snake", "du Serpent", "ta sagesse ouvre de nouveaux chemins.", ["Sagesse", "Intuition", "Adaptation", "Renouveau"], ["Wisdom", "Intuition", "Adaptability", "Renewal"]],
  bakari_crocodile: ["Crocodile", "Crocodile", "du Crocodile", "tu sais attendre le moment juste.", ["Longévité", "Patience", "Résistance", "Vigilance"], ["Longevity", "Patience", "Resilience", "Vigilance"]],
  aida_panthere: ["Panthère", "Panther", "de la Panthère", "ta présence discrète révèle ta force.", ["Mystère", "Discrétion", "Intuition", "Agilité"], ["Mystery", "Discretion", "Intuition", "Agility"]],
  imani_tortue: ["Tortue", "Tortoise", "de la Tortue", "chaque pas te rapproche de ton horizon.", ["Patience", "Persévérance", "Calme", "Stabilité"], ["Patience", "Perseverance", "Calm", "Stability"]],
  seun_elephant: ["Éléphant", "Elephant", "de l’Éléphant", "tu gardes les liens et la mémoire vivants.", ["Mémoire", "Loyauté", "Protection", "Transmission"], ["Memory", "Loyalty", "Protection", "Transmission"]],
  nala_grue: ["Grue", "Crane", "de la Grue", "ta grâce crée l’équilibre autour de toi.", ["Grâce", "Équilibre", "Harmonie", "Attention"], ["Grace", "Balance", "Harmony", "Attention"]],
  kwame_aigle: ["Aigle", "Eagle", "de l’Aigle", "ta vision porte au-delà de l’horizon.", ["Vision", "Clarté", "Hauteur", "Discernement"], ["Vision", "Clarity", "Perspective", "Discernment"]],
  fatou_faucon: ["Faucon", "Falcon", "du Faucon", "ta liberté donne des ailes à tes élans.", ["Liberté", "Élan", "Rapidité", "Audace"], ["Freedom", "Drive", "Speed", "Boldness"]],
};
const welcomes: Record<JuniorTotemId, string> = {
  zara_leopard: "you strike true, at the right moment.", dayo_lion: "your energy lights the way.",
  amara_lionne: "your presence protects those around you.", kofi_buffle: "you move forward with strength and consistency.",
  kemi_serpent: "your wisdom opens new paths.", bakari_crocodile: "you know how to wait for the right moment.",
  aida_panthere: "your quiet presence reveals your strength.", imani_tortue: "each step brings you closer to your horizon.",
  seun_elephant: "you keep bonds and memories alive.", nala_grue: "your grace brings balance around you.",
  kwame_aigle: "your vision reaches beyond the horizon.", fatou_faucon: "your freedom gives wings to your ambitions.",
};

export function juniorDetails(id: JuniorTotemId, locale?: string | null) {
  const [fr, en, clan, welcome, attributesFr, attributesEn] = profiles[id];
  return locale === "en" ? { animal: en, clanWelcome: `Welcome to the Clan of the ${en} - ${welcomes[id]}`, secondaryAttributes: attributesEn }
    : { animal: fr, clanWelcome: `Bienvenue dans le Clan ${clan} - ${welcome}`, secondaryAttributes: attributesFr };
}

export const juniorSerialNumber = (orderId: string) => `JNR-${orderId.toUpperCase()}`;
