import { QuestionnaireAnswer, TotemStoryPage, TotemTextPayload } from "./totem.types";

type Locale = "fr" | "en";
type Choice = "A" | "B" | "C" | "D";
type Dimension = "F" | "E" | "T" | "A";
type Scores = Record<Dimension, number>;

type ParsedAnswer = {
  choice?: Choice;
  field?: string;
  skipped?: boolean;
};

type AdultArchetype = {
  id: string;
  french: string;
  english: string;
  people: string;
  region: string;
  quality: string;
  clanFr: string;
  clanEn: string;
};

export type AdultV3Context = {
  firstName: string;
  language: Locale;
  seed: string;
  orderNumber: number;
  season: string;
  hour: string;
  answers: Record<string, ParsedAnswer>;
  scores: Scores;
  dominant: Dimension;
  secondary: Dimension;
  archetype: AdultArchetype;
  prenomA: string;
  prenomB: string;
  title: string;
  nomComplet: string;
  workTitleFr: string;
  workTitleEn: string;
  narrativeVariant: "A" | "B" | "C" | "D";
  visualFrame: 1 | 2 | 3 | 4 | 5;
  imagePrompt: string;
};

const dimensions: Dimension[] = ["F", "E", "T", "A"];
const zeroScores: Scores = { F: 0, E: 0, T: 0, A: 0 };

const adultScoring: Record<number, Record<Choice, Scores>> = {
  1: {
    A: { F: 3, E: 0, T: 0, A: 0 },
    B: { F: 0, E: 3, T: 0, A: 0 },
    C: { F: 0, E: 0, T: 3, A: 0 },
    D: { F: 0, E: 0, T: 0, A: 3 },
  },
  2: {
    A: { F: 3, E: 0, T: 1, A: 0 },
    B: { F: 1, E: 1, T: 0, A: 2 },
    C: { F: 0, E: 2, T: 2, A: 0 },
    D: { F: 0, E: 2, T: 0, A: 2 },
  },
  3: {
    A: { F: 6, E: 0, T: 2, A: 0 },
    B: { F: 0, E: 4, T: 0, A: 4 },
    C: { F: 0, E: 2, T: 6, A: 0 },
    D: { F: 2, E: 0, T: 0, A: 6 },
  },
  4: {
    A: { F: 3, E: 0, T: 1, A: 0 },
    B: { F: 0, E: 2, T: 0, A: 2 },
    C: { F: 1, E: 0, T: 3, A: 0 },
    D: { F: 0, E: 3, T: 0, A: 1 },
  },
  5: {
    A: { F: 2, E: 0, T: 1, A: 1 },
    B: { F: 3, E: 0, T: 0, A: 0 },
    C: { F: 0, E: 1, T: 2, A: 1 },
    D: { F: 0, E: 3, T: 0, A: 1 },
  },
  6: {
    A: { F: 1.5, E: 0, T: 0, A: 1.5 },
    B: { F: 0, E: 1.5, T: 1.5, A: 0 },
    C: { F: 1.5, E: 0, T: 1.5, A: 0 },
    D: { F: 0.5, E: 0.5, T: 0.5, A: 0.5 },
  },
  7: {
    A: { F: 6, E: 0, T: 2, A: 0 },
    B: { F: 2, E: 0, T: 0, A: 6 },
    C: { F: 2, E: 2, T: 4, A: 0 },
    D: { F: 0, E: 6, T: 0, A: 2 },
  },
  8: {
    A: { F: 2, E: 0, T: 3, A: 0 },
    B: { F: 2, E: 0, T: 2, A: 1 },
    C: { F: 0, E: 2, T: 2, A: 1 },
    D: { F: 0, E: 2, T: 0, A: 3 },
  },
  9: {
    A: { F: 0, E: 3, T: 0, A: 0 },
    B: { F: 0, E: 0, T: 0, A: 3 },
    C: { F: 3, E: 0, T: 0, A: 0 },
    D: { F: 0, E: 0, T: 3, A: 0 },
  },
  10: {
    A: { F: 6, E: 0, T: 2, A: 0 },
    B: { F: 0, E: 6, T: 0, A: 2 },
    C: { F: 0, E: 0, T: 6, A: 0 },
    D: { F: 2, E: 0, T: 0, A: 6 },
  },
};

const archetypes: Record<string, AdultArchetype> = {
  lion: {
    id: "lion",
    french: "Lion",
    english: "Lion",
    people: "Yoruba",
    region: "Nigeria",
    quality: "Leadership",
    clanFr: "Clan du Lion",
    clanEn: "Clan of the Lion",
  },
  lionne: {
    id: "lionne",
    french: "Lionne",
    english: "Lioness",
    people: "Maasai",
    region: "Kenya / Tanzanie",
    quality: "Protection",
    clanFr: "Clan de la Lionne",
    clanEn: "Clan of the Lioness",
  },
  rhinoceros: {
    id: "rhinoceros",
    french: "Rhinoceros",
    english: "Rhinoceros",
    people: "Zulu",
    region: "Afrique du Sud",
    quality: "Determination",
    clanFr: "Clan du Rhinoceros",
    clanEn: "Clan of the Rhinoceros",
  },
  crocodile: {
    id: "crocodile",
    french: "Crocodile",
    english: "Crocodile",
    people: "Mande",
    region: "Mali / Guinee",
    quality: "Gardien",
    clanFr: "Clan du Crocodile",
    clanEn: "Clan of the Crocodile",
  },
  serpent: {
    id: "serpent",
    french: "Serpent",
    english: "Serpent",
    people: "Fon",
    region: "Benin",
    quality: "Transformation",
    clanFr: "Clan du Serpent",
    clanEn: "Clan of the Serpent",
  },
  dauphin: {
    id: "dauphin",
    french: "Dauphin",
    english: "Dolphin",
    people: "Serer",
    region: "Senegal",
    quality: "Joie",
    clanFr: "Clan du Dauphin",
    clanEn: "Clan of the Dolphin",
  },
  elephant: {
    id: "elephant",
    french: "Elephant",
    english: "Elephant",
    people: "Akan",
    region: "Ghana",
    quality: "Memoire",
    clanFr: "Clan de l'Elephant",
    clanEn: "Clan of the Elephant",
  },
  baobab: {
    id: "baobab",
    french: "Baobab",
    english: "Baobab",
    people: "Wolof",
    region: "Senegal",
    quality: "Ancestralite",
    clanFr: "Clan du Baobab",
    clanEn: "Clan of the Baobab",
  },
  zebre: {
    id: "zebre",
    french: "Zebre",
    english: "Zebra",
    people: "Ndebele",
    region: "Afrique du Sud",
    quality: "Equilibre",
    clanFr: "Clan du Zebre",
    clanEn: "Clan of the Zebra",
  },
  perroquet: {
    id: "perroquet",
    french: "Perroquet",
    english: "Parrot",
    people: "Ashanti",
    region: "Ghana",
    quality: "Parole",
    clanFr: "Clan du Perroquet",
    clanEn: "Clan of the Parrot",
  },
  aigle: {
    id: "aigle",
    french: "Aigle",
    english: "Eagle",
    people: "Dogon",
    region: "Mali",
    quality: "Vision",
    clanFr: "Clan de l'Aigle",
    clanEn: "Clan of the Eagle",
  },
  leopard: {
    id: "leopard",
    french: "Leopard",
    english: "Leopard",
    people: "Yoruba",
    region: "Nigeria",
    quality: "Grace",
    clanFr: "Clan du Leopard",
    clanEn: "Clan of the Leopard",
  },
};

const attribution: Record<Dimension, Record<Dimension, string>> = {
  F: { A: "lion", T: "lionne", E: "rhinoceros", F: "lion" },
  E: { T: "crocodile", A: "serpent", F: "dauphin", E: "serpent" },
  T: { F: "elephant", E: "baobab", A: "zebre", T: "elephant" },
  A: { E: "perroquet", F: "aigle", T: "zebre", A: "aigle" },
};

const prenomsA = [
  "Kwame",
  "Kofi",
  "Ama",
  "Abena",
  "Yaw",
  "Akua",
  "Kojo",
  "Adwoa",
  "Seun",
  "Temi",
  "Yemi",
  "Bisi",
  "Femi",
  "Kemi",
  "Sola",
  "Tobi",
  "Emeka",
  "Chidi",
  "Ngozi",
  "Amara",
  "Amani",
  "Baraka",
  "Dalila",
  "Farida",
  "Jabari",
  "Kamau",
  "Lulu",
  "Makena",
  "Nia",
  "Rafiki",
  "Lomba",
  "Maka",
  "Nkosi",
  "Sangi",
  "Zola",
  "Bayo",
  "Dayo",
  "Kani",
  "Lewa",
  "Mora",
];

const prenomsB = [
  "Aicha",
  "Fatou",
  "Ibrahim",
  "Kadija",
  "Lamine",
  "Mariama",
  "Oumar",
  "Rokhaya",
  "Samba",
  "Tidiane",
  "Ayasha",
  "Bongi",
  "Chanda",
  "Dineo",
  "Enoch",
  "Fumani",
  "Gugu",
  "Hawa",
  "Imani",
  "Jomo",
  "Kais",
  "Lola",
  "Manu",
  "Nala",
  "Oba",
  "Pita",
  "Rami",
  "Soro",
  "Tara",
  "Ugo",
  "Vusi",
  "Wata",
  "Xola",
  "Yara",
  "Zara",
  "Akou",
  "Baki",
  "Cela",
  "Dara",
  "Elan",
];

const titleSeries = {
  air: [
    "Qui vit dans l'Eclair",
    "Des Vents du Nord",
    "Qui traverse les Orages",
    "Des Sommets Silencieux",
    "Qui voit la Nuit",
    "Des Horizons Perdus",
    "Ne dans la Tempete",
    "Qui porte le Soleil",
    "Des Falaises Anciennes",
    "Qui chante au Vent",
  ],
  fire: [
    "Du Feu Originel",
    "Qui rugit sans bruit",
    "Des Plaines Brulantes",
    "Ne dans les Braises",
    "Qui garde la Flamme",
    "Des Terres Rouges",
    "Qui marche dans les Cendres",
    "Du Premier Matin",
    "Qui dompte les Eclairs",
    "Des Royaumes Oublies",
  ],
  shadow: [
    "Des Ombres Profondes",
    "Qui frappe dans le Silence",
    "Des Nuits Sans Lune",
    "Ne entre Deux Mondes",
    "Qui disparait au Lever",
    "Des Forets Interdites",
    "Qui connait les Secrets",
    "Des Passages Caches",
    "Ne dans le Mystere",
    "Qui attend l'Heure Juste",
  ],
  earth: [
    "Qui porte la Memoire",
    "Des Terres Immemoriales",
    "Qui ne recule jamais",
    "Des Racines Profondes",
    "Qui connait le Chemin",
    "Des Ancetres Debout",
    "Qui traverse les Siecles",
    "Des Plaines Eternelles",
    "Qui garde les Vivants",
    "Des Temps Premiers",
  ],
  water: [
    "Qui lit les Eaux",
    "Des Profondeurs Anciennes",
    "Qui connait la Verite",
    "Des Rivieres Sacrees",
    "Ne sous la Terre",
    "Qui parle aux Ombres",
    "Des Sources Cachees",
    "Qui transforme tout",
    "Des Eaux Premieres",
    "Qui n'oublie rien",
  ],
  grace: [
    "Qui danse dans l'Aube",
    "Des Marais Royaux",
    "Ne dans la Brume",
    "Qui apporte la Paix",
    "Des Lagons Silencieux",
    "Qui marche sans bruit",
    "Des Matins Calmes",
    "Qui sait attendre",
    "Des Rives Benies",
    "Ne sous les Etoiles",
  ],
  universal: [
    "Du Premier Souffle",
    "Ne avant les Noms",
    "Qui connait l'Origine",
    "Des Temps Oublies",
    "Qui porta la Lumiere",
    "Des Nuits Fondatrices",
    "Ne quand tout commencait",
    "Qui traversa les Ages",
    "Des Memoires Vivantes",
    "Ne pour se souvenir",
  ],
} as const;

const titleSeriesByArchetype: Record<string, keyof typeof titleSeries> = {
  lion: "fire",
  lionne: "fire",
  rhinoceros: "earth",
  crocodile: "water",
  serpent: "water",
  dauphin: "water",
  elephant: "earth",
  baobab: "universal",
  zebre: "grace",
  perroquet: "air",
  aigle: "air",
  leopard: "shadow",
};

const questionLabels = [
  "L'element naturel",
  "Le moment vivant",
  "Le regard des autres",
  "La reaction a l'epreuve",
  "L'heure de l'ame",
  "L'origine ancestrale",
  "La colere sacree",
  "La trace dans le monde",
  "Le symbole interieur",
  "Le regard de l'ancetre",
];

export function buildAdultV3Context(input: {
  orderId: string;
  customerName?: string | null;
  locale?: string | null;
  answers: QuestionnaireAnswer[];
  now?: Date;
}): AdultV3Context {
  const language: Locale = input.locale?.startsWith("en") ? "en" : "fr";
  const now = input.now ?? new Date();
  const answers = parseAnswers(input.answers);
  const scored = scoreAnswers(answers);
  const archetype = scored.archetype;
  const seed = input.orderId;
  const series = titleSeries[titleSeriesByArchetype[archetype.id] ?? "universal"];
  const prenomA = pickSeeded(prenomsA, seed, "prenom-a");
  const prenomB = pickSeeded(prenomsB, seed, "prenom-b");
  const title = pickSeeded(series, seed, "title");
  const context: Omit<AdultV3Context, "imagePrompt"> = {
    firstName: input.customerName?.trim() || "Voyageur",
    language,
    seed,
    orderNumber: (numericSeed(seed) % 999999) + 1,
    season: getSeason(now, language),
    hour: getHourPeriod(now, language),
    answers,
    scores: scored.scores,
    dominant: scored.dominant,
    secondary: scored.secondary,
    archetype,
    prenomA,
    prenomB,
    title,
    nomComplet: `${prenomA}-${prenomB}, ${title}`,
    workTitleFr: `La ${archetype.quality} du ${archetype.french}`,
    workTitleEn: `The ${archetype.english}'s ${archetype.quality}`,
    narrativeVariant: pickSeeded(["A", "B", "C", "D"] as const, seed, "variant"),
    visualFrame: pickSeeded([1, 2, 3, 4, 5] as const, seed, "visual-frame"),
  };

  return {
    ...context,
    imagePrompt: buildV3ImagePrompt(context),
  };
}

export function buildAdultV3GenerationPrompt(context: AdultV3Context): string {
  return `Tu es le moteur artistique V3 de TOTEM ANCESTRAL.

Tu executes la chaine A1, A2, A3, A4 et A5 dans une seule reponse JSON stricte. TOTEM ANCESTRAL est une experience artistique et symbolique : ce n'est pas de la genealogie, ni de la science, ni de la divination. C'est une fable.

DONNEES COMMUNES :
Prenom : ${context.firstName}
Langue : ${context.language}
Numero mondial : ${context.orderNumber}
Saison : ${context.season} · Heure : ${context.hour}
Seed : ${context.seed}
Scores FETA : F=${context.scores.F} / E=${context.scores.E} / T=${context.scores.T} / A=${context.scores.A}
Dominante : ${context.dominant} · Secondaire : ${context.secondary}

ARCHETYPE DETERMINE PAR LA MATRICE :
${context.archetype.french} · ${context.archetype.english} · ${context.archetype.people} (${context.archetype.region}) · ${context.archetype.quality}

NOM ANCESTRAL PRE-TIRE :
Composante A : ${context.prenomA}
Composante B : ${context.prenomB}
Titre poetique : ${context.title}
Nom complet attendu : ${context.nomComplet}

REPONSES AU PARCOURS GRIOT :
${formatAnswers(context.answers)}

MISSION :
1. A1 : valider l'archetype impose par les scores FETA et le nom ancestral compose.
2. A2 : composer le Parchemin Ancestral en ${context.language}, 1500-1800 caracteres espaces compris, 5 mouvements separes par doubles sauts de ligne. Variante narrative : ${context.narrativeVariant}. Le nom "${context.nomComplet}" doit apparaitre au moins une fois.
3. A3 : composer le script audio de 130-160 mots, phrases courtes, pauses avec "..." ou retours a la ligne.
4. A4 : produire un prompt image en anglais pour le generateur d'images (OpenAI gpt-image), 80-120 mots, purement descriptif, SANS parametres de type --ar/--stylize/--v/--seed, selon ce prompt de base : ${context.imagePrompt}
5. A5 : produire les textes de partage LinkedIn/Instagram, WhatsApp et message Clan.

REGLES STRICTES :
- Ne jamais presenter l'oeuvre comme une verite ethnique ou scientifique.
- Conditionnel doux pour l'ancetre : "il aurait vecu", jamais "tu es" pour l'ancetre.
- Pas d'emojis, pas de texte marketing dans le parchemin, pas de cliches.
- Image : portrait ancestral puissant, visage coupe en deux, moitie gauche visage realiste du totem, moitie droite masque Ngil Fang stylise, cadrage vertical 3:4, portrait rapproche centre, en langage naturel sans parametres techniques.

REPONSE JSON STRICTE, sans Markdown ni texte avant/apres :
{
  "a1": {
    "archetype": "${context.archetype.id}",
    "archetype_french": "${context.archetype.french}",
    "archetype_english": "${context.archetype.english}",
    "people": "${context.archetype.people}",
    "region": "${context.archetype.region}",
    "nom_complet": "${context.nomComplet}",
    "titre_valide": true,
    "work_title_fr": "${context.workTitleFr}",
    "work_title_en": "${context.workTitleEn}",
    "reasoning_brief": "Attribution determinee par la matrice FETA adulte."
  },
  "a2": {
    "parchment_text": "Texte complet, 5 mouvements separes par \\n\\n",
    "opening": "Mouvement 1 isole",
    "portrait": "Mouvement 2 isole",
    "trial": "Mouvement 3 isole",
    "transmission": "Mouvement 4 isole",
    "passage": "Mouvement 5 isole",
    "character_count": 1650,
    "narrative_variant_used": "${context.narrativeVariant}"
  },
  "a3": {
    "audio_script": "Script complet",
    "word_count": 145,
    "estimated_duration_seconds": 88
  },
  "a4": {
    "image_prompt": "${context.imagePrompt}",
    "personality_keywords": ["kw1", "kw2", "kw3"],
    "visual_elements": "Elements visuels uniques",
    "visual_frame_used": ${context.visualFrame}
  },
  "a5": {
    "caption_linkedin": "Caption LinkedIn/Instagram",
    "message_whatsapp": "Message WhatsApp",
    "message_clan": "Message d'accueil Clan"
  }
}`;
}

export function normalizeAdultV3Response(
  raw: unknown,
  context: AdultV3Context,
): TotemTextPayload {
  const root = isRecord(raw) ? raw : {};
  const a1 = readRecord(root.a1) ?? root;
  const a2 = readRecord(root.a2) ?? root;
  const a3 = readRecord(root.a3) ?? root;
  const a4 = readRecord(root.a4) ?? root;
  const a5 = readRecord(root.a5) ?? {};
  const ancestralName = readString(a1.nom_complet) || context.nomComplet;
  const parchmentText = readString(a2.parchment_text) || buildFallbackParchment(context);
  const audioMessage = readString(a3.audio_script) || buildAudioFallback(context, parchmentText);
  const imagePrompt =
    readString(a4.image_prompt) || readString(a4.midjourney_prompt) || context.imagePrompt;
  const storyPages = buildStoryPagesFromMovements(a2, parchmentText, imagePrompt);

  return {
    archetypeId: readString(a1.archetype) || context.archetype.id,
    ancestralName,
    parchmentText,
    audioMessage,
    imagePrompt,
    storyPages,
    shareMessages: {
      captionLinkedin: readString(a5.caption_linkedin) || fallbackShare(context).captionLinkedin,
      messageWhatsapp: readString(a5.message_whatsapp) || fallbackShare(context).messageWhatsapp,
      messageClan: readString(a5.message_clan) || fallbackShare(context).messageClan,
    },
    workTitleFr: readString(a1.work_title_fr) || context.workTitleFr,
    workTitleEn: readString(a1.work_title_en) || context.workTitleEn,
    people: readString(a1.people) || context.archetype.people,
    region: readString(a1.region) || context.archetype.region,
    scores: context.scores,
    dominant: context.dominant,
    secondary: context.secondary,
    narrativeVariant: context.narrativeVariant,
    visualFrame: context.visualFrame,
  };
}

export function buildAdultV3FallbackPayload(context: AdultV3Context): TotemTextPayload {
  return normalizeAdultV3Response({}, context);
}

function parseAnswers(answers: QuestionnaireAnswer[]): Record<string, ParsedAnswer> {
  const result: Record<string, ParsedAnswer> = {};
  for (const answer of answers) {
    const question = Number(answer.questionId.replace(/^q/i, ""));
    if (!Number.isInteger(question) || question < 1 || question > 10) continue;
    const raw = answer.answer.trim();
    if (raw.toLowerCase() === "skipped") {
      result[String(question)] = { skipped: true };
      continue;
    }
    const choice = parseChoice(raw);
    const field = raw.includes("|") ? raw.split("|").slice(1).join("|").trim() : "";
    result[String(question)] = {
      ...(choice ? { choice } : {}),
      ...(field ? { field } : {}),
    };
  }
  return result;
}

function scoreAnswers(answers: Record<string, ParsedAnswer>) {
  const scores: Scores = { ...zeroScores };

  for (let question = 1; question <= 10; question += 1) {
    const choice = answers[String(question)]?.choice;
    if (!choice) continue;
    const score = adultScoring[question]?.[choice];
    if (!score) continue;
    for (const dimension of dimensions) scores[dimension] += score[dimension];
  }

  const allEqual = dimensions.every((dimension) => scores[dimension] === scores.F);
  if (allEqual) {
    return {
      scores,
      dominant: "T" as const,
      secondary: "E" as const,
      archetype: archetypes.baobab ?? Object.values(archetypes)[0]!,
    };
  }

  const sorted = sortDimensions(scores);
  const first = sorted[0]!;
  const second = sorted[1]!;
  let dominant = first.dimension;

  if (first.score === second.score) {
    const tied = sorted.filter((item) => item.score === first.score).map((item) => item.dimension);
    dominant =
      dominantFromQuestion(answers, 7, tied) ??
      dominantFromQuestion(answers, 3, tied) ??
      dominant;
  } else if (first.score - second.score < 3) {
    dominant = dominantFromQuestion(answers, 5) ?? dominant;
  }

  const secondary = sortDimensions(scores).find((item) => item.dimension !== dominant)?.dimension ?? dominant;
  const archetypeId = attribution[dominant]?.[secondary] ?? attribution[dominant]?.[dominant] ?? "baobab";

  return {
    scores,
    dominant,
    secondary,
    archetype: archetypes[archetypeId] ?? archetypes.baobab ?? Object.values(archetypes)[0]!,
  };
}

function buildV3ImagePrompt(context: Omit<AdultV3Context, "imagePrompt">): string {
  const frame = visualFrameDescription(context.visualFrame);
  const keywords = personalityKeywords(context.answers).join(", ");
  const leftFace = animalLeftFace(context.archetype.id);

  return [
    "Portrait ancestral puissant, visage coupe en deux",
    `moitie gauche ${leftFace}`,
    "moitie droite masque Ngil Fang traditionnel africain stylise avec yeux blancs et motifs geometriques",
    "fusion harmonieuse au milieu du visage",
    "peau avec cicatrices rituelles dorees",
    "ambiance sombre mystique",
    "eclairage dramatique cinematographique",
    "style artistique premium africain",
    "tres detaille, haute resolution, 8k",
    keywords ? `personality keywords: ${keywords}` : "",
    `composition: ${frame}`,
    "sans texte, sans logo, sans watermark, cadrage vertical 3:4",
  ]
    .filter(Boolean)
    .join(", ");
}

function animalLeftFace(archetypeId: string): string {
  const labels: Record<string, string> = {
    lion: "visage de lion realiste avec criniere noire et regard percant",
    lionne: "visage de lionne realiste avec regard protecteur et traits royaux",
    rhinoceros: "visage de rhinoceros realiste avec corne sculpturale et peau minerale",
    crocodile: "visage de crocodile realiste avec ecailles profondes et regard ancien",
    serpent: "visage de serpent realiste avec ecailles vert sombre et regard hypnotique",
    dauphin: "visage de dauphin realiste avec peau bleutee et regard lumineux",
    elephant: "visage d'elephant realiste avec defenses sculpturales et regard ancestral",
    baobab: "visage anthropomorphe de baobab realiste avec ecorce massive et racines sculptees",
    zebre: "visage de zebre realiste avec rayures nettes et regard calme",
    perroquet: "visage de perroquet realiste avec plumage vert et or et regard vif",
    aigle: "visage d'aigle realiste avec bec royal et regard percant",
    leopard: "visage de leopard realiste avec taches sombres et regard precis",
  };
  return labels[archetypeId] ?? `visage realiste du totem ${archetypeId}`;
}

function buildStoryPagesFromMovements(
  a2: Record<string, unknown>,
  parchmentText: string,
  imagePrompt: string,
): TotemStoryPage[] {
  const movementKeys = ["opening", "portrait", "trial", "transmission", "passage"] as const;
  const titles = ["L'Ouverture", "Le Portrait", "L'Epreuve", "La Transmission", "Le Passage"];
  const movementTexts = movementKeys
    .map((key) => readString(a2[key]))
    .filter((value) => value.trim().length > 0);
  const texts =
    movementTexts.length > 0
      ? movementTexts
      : parchmentText
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean);

  return texts.slice(0, 5).map((text, index) => ({
    page: index + 1,
    title: titles[index] ?? `Mouvement ${index + 1}`,
    text,
    imagePrompt: `${imagePrompt}, visual detail for this movement: ${text.slice(0, 280)}`,
  }));
}

function buildFallbackParchment(context: AdultV3Context): string {
  if (context.language === "en") {
    return [
      `At the hour of ${context.hour}, a figure of the ${context.archetype.english} would have stood near an old threshold of ${context.archetype.region}.`,
      `${context.nomComplet} carries a quiet sign: ${context.archetype.quality.toLowerCase()}, held without display and offered only when the road demands it.`,
      `An imagined ancestor would have learned to keep watch, to read the hour, and to let silence become a form of strength.`,
      `${context.firstName}, receive this as an artwork: a name, a passage, and a lamp placed before the next step.`,
    ].join("\n\n");
  }

  return [
    `A l'heure du ${context.hour}, une figure du ${context.archetype.french} aurait veille pres d'un seuil ancien de ${context.archetype.region}.`,
    `${context.nomComplet} porte un signe discret : ${context.archetype.quality.toLowerCase()}, tenu sans fracas et offert lorsque le chemin l'exige.`,
    `Un ancetre imagine aurait appris a garder le passage, a lire l'heure juste, et a faire du silence une force attentive.`,
    `${context.firstName}, recois ceci comme une oeuvre : un nom, un passage, et une lampe posee devant le prochain pas.`,
  ].join("\n\n");
}

function buildAudioFallback(context: AdultV3Context, parchmentText: string): string {
  const passage = parchmentText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .at(-1);

  if (context.language === "en") {
    return `${context.firstName}, listen...\n\nA name has been placed before you: ${context.nomComplet}. It is not proof, but a lamp. In this fable, the ${context.archetype.english} walks near the old memory of ${context.archetype.people} lands.\n\nCarry ${context.archetype.quality.toLowerCase()} without noise. Let it guide your hand when the road narrows.\n\n${passage ?? "Walk with a quiet heart, and leave behind what does not deserve your strength."}`;
  }

  return `${context.firstName}, ecoute...\n\nUn nom a ete pose devant toi : ${context.nomComplet}. Ce n'est pas une preuve, c'est une lampe. Dans cette fable, le ${context.archetype.french} marche pres de l'ancienne memoire ${context.archetype.people}.\n\nPorte ${context.archetype.quality.toLowerCase()} sans bruit. Laisse ce signe guider ta main quand la route se resserre.\n\n${passage ?? "Marche avec le coeur calme, et laisse derriere toi ce qui ne merite pas ta force."}`;
}

function fallbackShare(context: AdultV3Context) {
  if (context.language === "en") {
    return {
      captionLinkedin: `${context.nomComplet}\nA symbolic fable has named my ancestral totem: ${context.archetype.english}.\nReveal yours: totemancestral.com #RevealYourTotem`,
      messageWhatsapp: `I discovered my ancestral totem: ${context.archetype.english}. Your turn: totemancestral.com`,
      messageClan: `#${context.orderNumber} enters the ${context.archetype.clanEn}; the Clan receives ${context.nomComplet}.`,
    };
  }

  return {
    captionLinkedin: `${context.nomComplet}\nUne fable symbolique m'a donne mon totem ancestral : ${context.archetype.french}.\nRevele le tien : totemancestral.com #RevealYourTotem`,
    messageWhatsapp: `J'ai decouvert mon totem ancestral : ${context.archetype.french}. A ton tour : totemancestral.com`,
    messageClan: `#${context.orderNumber} entre dans le ${context.archetype.clanFr} ; le Clan accueille ${context.nomComplet}.`,
  };
}

function formatAnswers(answers: Record<string, ParsedAnswer>): string {
  return Array.from({ length: 10 }, (_, index) => {
    const question = index + 1;
    const answer = answers[String(question)] ?? {};
    const choice = answer.skipped ? "Question passee" : answer.choice ?? "Non renseigne";
    const field = answer.field?.trim() || "Aucune reponse libre";
    return `Q${question} (${questionLabels[index]}) : "${field}" / Choix : ${choice}`;
  }).join("\n");
}

function personalityKeywords(answers: Record<string, ParsedAnswer>): string[] {
  const words = Object.values(answers)
    .flatMap((answer) =>
      (answer.field ?? "")
        .toLowerCase()
        .replace(/[^a-zA-ZÀ-ÿ\s'-]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 5),
    )
    .slice(0, 5);

  return words.length >= 3 ? words : ["resilient", "intuitive", "rooted"];
}

function visualFrameDescription(frame: 1 | 2 | 3 | 4 | 5): string {
  const frames: Record<1 | 2 | 3 | 4 | 5, string> = {
    1: "frontal majestic subject, direct gaze, centered composition, frontal ceremonial light",
    2: "contemplative three-quarter profile, gaze toward the horizon, warm side light",
    3: "dynamic three-quarter pose, subtle movement, backlit sacred atmosphere",
    4: "slightly high royal angle, subject raising the eyes, solemn sacred mood",
    5: "low-angle portrait, imposing subject, sky or nature behind the figure",
  };
  return frames[frame];
}

function parseChoice(value: string): Choice | null {
  const match = value.trim().match(/^([ABCD])(?:\b|\s|\|)/i);
  const choice = match?.[1]?.toUpperCase();
  return choice === "A" || choice === "B" || choice === "C" || choice === "D" ? choice : null;
}

function dominantFromQuestion(
  answers: Record<string, ParsedAnswer>,
  question: number,
  allowed?: Dimension[],
): Dimension | null {
  const choice = answers[String(question)]?.choice;
  if (!choice) return null;
  const scores = adultScoring[question]?.[choice];
  if (!scores) return null;
  const dimension = sortDimensions(scores)[0]?.dimension;
  if (!dimension) return null;
  if (allowed && !allowed.includes(dimension)) return null;
  return dimension;
}

function sortDimensions(scores: Scores) {
  return dimensions
    .map((dimension) => ({ dimension, score: scores[dimension] }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return dimensions.indexOf(left.dimension) - dimensions.indexOf(right.dimension);
    });
}

function pickSeeded<T>(items: readonly T[], seed: string, salt: string): T {
  return items[hash(`${seed}:${salt}`) % items.length] ?? items[0]!;
}

function numericSeed(seed: string): number {
  return hash(seed) % 2147483647;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result >>> 0);
}

function getSeason(date: Date, locale: Locale): string {
  const month = date.getMonth() + 1;
  const season =
    month >= 3 && month <= 5
      ? "spring"
      : month >= 6 && month <= 8
        ? "summer"
        : month >= 9 && month <= 11
          ? "autumn"
          : "winter";

  if (locale === "en") return season;
  return {
    spring: "printemps",
    summer: "ete",
    autumn: "automne",
    winter: "hiver",
  }[season];
}

function getHourPeriod(date: Date, locale: Locale): string {
  const hour = date.getHours();
  const period =
    hour >= 5 && hour < 12 ? "morning" : hour < 18 ? "afternoon" : hour < 22 ? "evening" : "night";

  if (locale === "en") return period;
  return {
    morning: "matin",
    afternoon: "apres-midi",
    evening: "soir",
    night: "nuit",
  }[period];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
