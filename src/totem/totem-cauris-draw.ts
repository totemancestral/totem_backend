import {
  CAURIS_SERIE_BY_ARCHETYPE,
  CAURIS_SERIES,
  CaurisCouche,
  CaurisSerieId,
  caurisCode,
} from "./totem-cauris";

export const CAURIS_ANTI_REPEAT_WINDOW = 8;

export type CaurisPastReading = {
  imageCode: string;
  paroleCode: string;
  gesteCode: string;
};

export type CaurisDraw = {
  serie: CaurisSerieId;
  imageCode: string;
  paroleCode: string;
  gesteCode: string;
  image: string;
  parole: string;
  geste: string;
};

const LAYER_CODE_KEY: Record<CaurisCouche, keyof CaurisPastReading> = {
  image: "imageCode",
  parole: "paroleCode",
  geste: "gesteCode",
};

const LAYER_TEXT_KEY: Record<CaurisCouche, "images" | "paroles" | "gestes"> = {
  image: "images",
  parole: "paroles",
  geste: "gestes",
};

export function caurisSerieForArchetype(archetypeId: string): CaurisSerieId | null {
  return CAURIS_SERIE_BY_ARCHETYPE[archetypeId] ?? null;
}

export function drawCauris(input: {
  archetypeId: string;
  pastReadings: CaurisPastReading[];
  random?: () => number;
}): CaurisDraw | null {
  const serie = caurisSerieForArchetype(input.archetypeId);
  if (!serie) return null;

  const random = input.random ?? Math.random;
  const recent = input.pastReadings.slice(0, CAURIS_ANTI_REPEAT_WINDOW);
  const content = CAURIS_SERIES[serie];

  const pick = (couche: CaurisCouche) => {
    const key = LAYER_CODE_KEY[couche];
    const excluded = new Set(recent.map((reading) => reading[key]));
    const texts = content[LAYER_TEXT_KEY[couche]];
    const indexes = texts.map((_, index) => index).filter((index) => !excluded.has(caurisCode(serie, couche, index)));
    const pool = indexes.length > 0 ? indexes : texts.map((_, index) => index);
    const index = pool[Math.floor(random() * pool.length)] ?? pool[0]!;
    return { code: caurisCode(serie, couche, index), text: texts[index]! };
  };

  const image = pick("image");
  const parole = pick("parole");
  const geste = pick("geste");

  return {
    serie,
    imageCode: image.code,
    paroleCode: parole.code,
    gesteCode: geste.code,
    image: image.text,
    parole: parole.text,
    geste: geste.text,
  };
}

export function caurisRestitution(draw: CaurisDraw, ancestralName: string) {
  return {
    header: `Pour toi, ${ancestralName} :`,
    image: draw.image,
    parole: draw.parole,
    geste: draw.geste,
  };
}

// Reconstitue les anciennes lectures à partir de leurs codes enregistrés.
export function restoreCaurisDraw(reading: CaurisPastReading & { serie: string }): CaurisDraw | null {
  if (!(reading.serie in CAURIS_SERIES)) return null;
  const serie = reading.serie as CaurisSerieId;
  const text = (layer: CaurisCouche) => {
    const values = CAURIS_SERIES[serie][LAYER_TEXT_KEY[layer]];
    const index = values.findIndex((_, i) => caurisCode(serie, layer, i) === reading[LAYER_CODE_KEY[layer]]);
    return index < 0 ? null : values[index]!;
  };
  const image = text("image"), parole = text("parole"), geste = text("geste");
  if (image === null || parole === null || geste === null) return null;
  return { ...reading, serie, image, parole, geste };
}

// Semaine calendaire (lundi 00:00 a dimanche 23:59, Europe/Paris) : deux tirages
// de la meme semaine ont la meme cle, la semaine suivante en a une autre.
export function parisWeekKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const year = value("year");
  const month = value("month");
  const day = value("day");

  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  return new Date(Date.UTC(year, month - 1, day - mondayOffset)).toISOString().slice(0, 10);
}

export function canDrawThisWeek(lastDrawAt: Date | null, now: Date): boolean {
  if (!lastDrawAt) return true;
  return parisWeekKey(lastDrawAt) !== parisWeekKey(now);
}

function parisOffsetMinutes(date: Date): number {
  const timeZoneName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;

  const match = timeZoneName?.match(/GMT([+-]\d+)(?::(\d+))?/);
  const hours = match ? Number(match[1]) : 1;
  const minutes = match?.[2] ? Number(match[2]) : 0;
  return hours * 60 + (hours < 0 ? -minutes : minutes);
}

// Prochain lundi 00:00 Europe/Paris, en instant UTC correct (tient compte du
// changement d'heure). Utilise pour afficher au client la date de disponibilite
// du prochain tirage.
export function nextParisWeekStart(date: Date): Date {
  const parts = parisWeekKey(date).split("-").map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const day = parts[2]!;
  const guess = new Date(Date.UTC(year, month - 1, day + 7, 0, 0, 0));
  const offsetMinutes = parisOffsetMinutes(guess);
  return new Date(guess.getTime() - offsetMinutes * 60_000);
}
