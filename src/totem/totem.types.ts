export type QuestionnaireAnswer = {
  questionId: string;
  answer: string;
};

export type CheckoutMetadata = {
  userId: string;
  email?: string;
  prenom?: string;
  locale?: string;
  offer?: "origine" | "ancestral" | "famille";
  checkoutSessionId?: string;
  answers: QuestionnaireAnswer[];
};

export type TotemTextPayload = {
  archetypeId: string;
  ancestralName: string;
  parchmentText: string;
  audioMessage: string;
  imagePrompt: string;
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
