import { z } from "zod";
import { CheckoutMetadata, QuestionnaireAnswer, TotemTextPayload } from "./totem.types";

const answerSchema = z.object({
  questionId: z.string().min(1).max(80),
  answer: z.string().min(1).max(4000),
});

const answersArraySchema = z.array(answerSchema).length(10);

const compactAnswersSchema = z.array(z.string().min(1).max(4000)).length(10);

const metadataSchema = z
  .object({
    userId: z.string().min(1).max(120),
    email: z.string().email().optional(),
    prenom: z.string().min(1).max(120).optional(),
    locale: z.string().min(2).max(12).optional(),
    offre: z.enum(["origine", "ancestral", "famille"]).optional(),
    offer: z.enum(["origine", "ancestral", "famille"]).optional(),
    checkoutSessionId: z.string().min(1).max(120).optional(),
    answers: z.string().optional(),
  })
  .passthrough();

export const checkoutSessionSchema = z.object({
  id: z.string().min(1),
  object: z.literal("checkout.session"),
  payment_status: z.string().min(1),
  metadata: z.record(z.string()).nullable().optional(),
  customer_email: z.string().email().nullable().optional(),
  customer_details: z
    .object({
      email: z.string().email().nullable().optional(),
      name: z.string().nullable().optional(),
      address: z
        .object({
          country: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  amount_total: z.number().int().nullable().optional(),
  currency: z.string().nullable().optional(),
  payment_intent: z
    .union([z.string(), z.object({ id: z.string() })])
    .nullable()
    .optional(),
});

export type CheckoutSessionPayload = z.infer<typeof checkoutSessionSchema>;

export const paymentIntentSchema = z.object({
  id: z.string().min(1),
  object: z.literal("payment_intent"),
  status: z.string().min(1),
  metadata: z.record(z.string()).nullable().optional(),
  amount: z.number().int().optional(),
  amount_received: z.number().int().optional(),
  currency: z.string().nullable().optional(),
});

export type PaymentIntentPayload = z.infer<typeof paymentIntentSchema>;

export const textPayloadSchema = z
  .object({
    archetype_id: z.string().min(1).optional(),
    archetypeId: z.string().min(1).optional(),
    nom_ancestral: z.string().min(1).optional(),
    ancestralName: z.string().min(1).optional(),
    texte_parchemin: z.string().min(1).optional(),
    parchmentText: z.string().min(1).optional(),
    message_audio: z.string().min(1).optional(),
    audioMessage: z.string().min(1).optional(),
    prompt_image: z.string().min(1).optional(),
    imagePrompt: z.string().min(1).optional(),
  })
  .transform(
    (value): TotemTextPayload => ({
      archetypeId: value.archetypeId ?? value.archetype_id ?? "",
      ancestralName: value.ancestralName ?? value.nom_ancestral ?? "",
      parchmentText: value.parchmentText ?? value.texte_parchemin ?? "",
      audioMessage: value.audioMessage ?? value.message_audio ?? "",
      imagePrompt: value.imagePrompt ?? value.prompt_image ?? "",
    }),
  )
  .pipe(
    z.object({
      archetypeId: z.string().min(1),
      ancestralName: z.string().min(1),
      parchmentText: z.string().min(1),
      audioMessage: z.string().min(1),
      imagePrompt: z.string().min(1),
    }),
  );

export function parseCheckoutMetadata(
  rawMetadata: Record<string, string> | null | undefined,
  fallbackEmail?: string,
): CheckoutMetadata {
  const metadata = metadataSchema.parse(rawMetadata ?? {});
  const answers = parseAnswers(metadata);

  return {
    userId: metadata.userId,
    email: metadata.email ?? fallbackEmail,
    prenom: metadata.prenom,
    locale: metadata.locale,
    offer: metadata.offer ?? metadata.offre,
    checkoutSessionId: metadata.checkoutSessionId,
    answers,
  };
}

function parseAnswers(metadata: Record<string, unknown>): QuestionnaireAnswer[] {
  if (typeof metadata.answers === "string") {
    const parsed = JSON.parse(metadata.answers) as unknown;
    const compact = compactAnswersSchema.safeParse(parsed);

    if (compact.success) {
      return compact.data.map((answer, index) => ({
        questionId: `q${index + 1}`,
        answer,
      }));
    }

    return answersArraySchema.parse(parsed);
  }

  const answers = Array.from({ length: 10 }, (_, index) => {
    const key = `q${index + 1}`;
    const answer = metadata[key];

    return {
      questionId: key,
      answer,
    };
  });

  return answersArraySchema.parse(answers);
}
