export type QuestionnaireAnswer = {
  questionId: string;
  answer: string;
};

export type TotemOffer = "origine" | "ancestral" | "famille" | "junior";

export type TotemStoryPage = {
  page: number;
  title: string;
  text: string;
  imagePrompt: string;
};

export type CheckoutMetadata = {
  userId: string;
  email?: string;
  prenom?: string;
  locale?: string;
  offer?: TotemOffer;
  orderId?: string;
  checkoutSessionId?: string;
  externalCommandId?: string;
  answers: QuestionnaireAnswer[];
  questionnaireVersion?: string;
  indicators?: Record<string, boolean>;
};

export type TotemTextPayload = {
  archetypeId: string;
  ancestralName: string;
  parchmentText: string;
  audioMessage: string;
  imagePrompt: string;
  storyPages: TotemStoryPage[];
  shareMessages?: {
    captionLinkedin: string;
    messageWhatsapp: string;
    messageClan: string;
  };
  workTitleFr?: string;
  workTitleEn?: string;
  people?: string;
  region?: string;
  scores?: Record<"F" | "E" | "T" | "A", number>;
  dominant?: "F" | "E" | "T" | "A";
  secondary?: "F" | "E" | "T" | "A";
  narrativeVariant?: "A" | "B" | "C" | "D";
  visualFrame?: 1 | 2 | 3 | 4 | 5;
};

export type GeneratedArtefact = {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
};

export type TotemJobPayload = {
  orderId: string;
};

export type StoredArtefact = {
  key: string;
  url: string;
};
