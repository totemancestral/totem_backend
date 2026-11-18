export type AdultIdentity = {
  animal: string;
  quality: string;
  identityPhrase: string;
  secondaryAttributes: string[];
};

// The Eagle wording follows the supplied card example. Other profiles keep
// their existing animal and quality, with matching editorial descriptions.
const profiles: Record<string, { fr: [string, string, string, string[]]; en: [string, string, string, string[]] }> = {
  aigle: {
    fr: ["Aigle", "Vision", "Avant toi, un ancêtre grimpait les falaises pour lire les étoiles avant tout le monde.", ["Vision", "Élévation", "Messager", "Liberté"]],
    en: ["Eagle", "Vision", "Before you, an ancestor climbed the cliffs to read the stars before everyone else.", ["Vision", "Elevation", "Messenger", "Freedom"]],
  },
  lion: {
    fr: ["Lion", "Leadership", "Avant toi, un ancêtre ouvrait le chemin et rassemblait les siens autour d’un même élan.", ["Leadership", "Courage", "Présence", "Initiative"]],
    en: ["Lion", "Leadership", "Before you, an ancestor opened the way and gathered their people around a shared purpose.", ["Leadership", "Courage", "Presence", "Initiative"]],
  },
  lionne: {
    fr: ["Lionne", "Protection", "Avant toi, un ancêtre veillait sur les siens et faisait de sa force un refuge.", ["Protection", "Vigilance", "Solidarité", "Courage"]],
    en: ["Lioness", "Protection", "Before you, an ancestor watched over their people and made their strength a refuge.", ["Protection", "Vigilance", "Solidarity", "Courage"]],
  },
  rhinoceros: {
    fr: ["Rhinocéros", "Détermination", "Avant toi, un ancêtre avançait avec constance, même lorsque le chemin semblait fermé.", ["Détermination", "Résistance", "Ancrage", "Persévérance"]],
    en: ["Rhinoceros", "Determination", "Before you, an ancestor moved forward steadily, even when the path seemed closed.", ["Determination", "Resilience", "Grounding", "Perseverance"]],
  },
  crocodile: {
    fr: ["Crocodile", "Gardien", "Avant toi, un ancêtre gardait le passage et reconnaissait l’instant juste pour agir.", ["Gardien", "Patience", "Vigilance", "Résistance"]],
    en: ["Crocodile", "Guardian", "Before you, an ancestor guarded the crossing and recognized the right moment to act.", ["Guardian", "Patience", "Vigilance", "Resilience"]],
  },
  serpent: {
    fr: ["Serpent", "Transformation", "Avant toi, un ancêtre savait quitter l’ancien pour laisser une nouvelle voie apparaître.", ["Transformation", "Intuition", "Renouveau", "Adaptation"]],
    en: ["Snake", "Transformation", "Before you, an ancestor knew how to leave the old behind and let a new path emerge.", ["Transformation", "Intuition", "Renewal", "Adaptability"]],
  },
  dauphin: {
    fr: ["Dauphin", "Joie", "Avant toi, un ancêtre rapprochait les êtres et faisait circuler la joie entre les rives.", ["Joie", "Lien", "Élan", "Harmonie"]],
    en: ["Dolphin", "Joy", "Before you, an ancestor brought people together and carried joy between the shores.", ["Joy", "Connection", "Drive", "Harmony"]],
  },
  elephant: {
    fr: ["Éléphant", "Mémoire", "Avant toi, un ancêtre gardait les récits vivants pour que les liens traversent les générations.", ["Mémoire", "Transmission", "Loyauté", "Protection"]],
    en: ["Elephant", "Memory", "Before you, an ancestor kept stories alive so that bonds could cross generations.", ["Memory", "Transmission", "Loyalty", "Protection"]],
  },
  baobab: {
    fr: ["Baobab", "Ancestralité", "Avant toi, un ancêtre offrait son ombre et ses racines à ceux qui cherchaient leur place.", ["Ancestralité", "Enracinement", "Accueil", "Transmission"]],
    en: ["Baobab", "Ancestral heritage", "Before you, an ancestor offered shade and roots to those searching for their place.", ["Ancestral heritage", "Roots", "Welcome", "Transmission"]],
  },
  zebre: {
    fr: ["Zèbre", "Équilibre", "Avant toi, un ancêtre faisait tenir ensemble les différences sans effacer leur singularité.", ["Équilibre", "Singularité", "Harmonie", "Lien"]],
    en: ["Zebra", "Balance", "Before you, an ancestor brought differences together without erasing their individuality.", ["Balance", "Individuality", "Harmony", "Connection"]],
  },
  perroquet: {
    fr: ["Perroquet", "Parole", "Avant toi, un ancêtre portait les mots qui relient, transmettent et réveillent les mémoires.", ["Parole", "Expression", "Transmission", "Écoute"]],
    en: ["Parrot", "Voice", "Before you, an ancestor carried words that connect, pass on knowledge and awaken memories.", ["Voice", "Expression", "Transmission", "Listening"]],
  },
  leopard: {
    fr: ["Léopard", "Grâce", "Avant toi, un ancêtre avançait avec grâce, attentif au silence et au moment juste.", ["Grâce", "Discrétion", "Précision", "Agilité"]],
    en: ["Leopard", "Grace", "Before you, an ancestor moved with grace, attentive to silence and the right moment.", ["Grace", "Discretion", "Precision", "Agility"]],
  },
};

export function adultIdentityFor(archetypeId: string | null | undefined, locale?: string | null): AdultIdentity | null {
  if (!archetypeId || !Object.hasOwn(profiles, archetypeId)) return null;
  const [animal, quality, identityPhrase, secondaryAttributes] = profiles[archetypeId]![locale?.startsWith("en") ? "en" : "fr"];
  return { animal, quality, identityPhrase, secondaryAttributes: [...secondaryAttributes] };
}
