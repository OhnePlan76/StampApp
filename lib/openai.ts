import OpenAI from "openai";
import { z } from "zod";

export const stampAnalysisSchema = z.object({
  country: z.string().nullable(),
  era: z.string().nullable(),
  denomination: z.string().nullable(),
  motive: z.string().nullable(),
  usedState: z.string().nullable(),
  condition: z.string().nullable(),
  catalogHint: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  valueClass: z.number().int().min(0).max(5),
  valueMin: z.number().nullable(),
  valueMax: z.number().nullable(),
  needsExpert: z.boolean(),
});

export type StampAnalysis = z.infer<typeof stampAnalysisSchema>;

export const pageAnalysisSchema = z.object({
  objectType: z.enum(["albumseite", "beleg", "einzelmarke", "unbrauchbar"]),
  captureQuality: z.enum(["ok", "grenzwertig", "kritisch"]),
  completeness: z.enum([
    "vollstaendig",
    "vollstaendig_genug",
    "teilweise_abgeschnitten",
    "wesentlich_abgeschnitten",
    "unklar",
  ]),
  qualityFlags: z.array(
    z.enum([
      "unscharf",
      "schief_perspektive",
      "spiegelung_schatten",
      "zu_klein_aufgenommen",
      "rand_abgeschnitten",
      "bereich_fehlt",
      "teilweise_verdeckt",
      "schutzfolie_reflex",
      "ok",
    ]),
  ),
  detectedItems: z.object({
    stampCountEstimate: z.number().int().min(0),
    postmarkCountEstimate: z.number().int().min(0),
    addressVisible: z.boolean(),
    specialCancelLikely: z.boolean(),
    coverOrCardLikely: z.boolean(),
  }),
  recommendedAction: z.enum([
    "akzeptieren",
    "zur_sichtung",
    "neu_fotografieren",
    "einzelmarke_empfehlen",
    "beleg_analysieren",
  ]),
  singleStampExceptionSuggested: z.boolean(),
  summary: z.string(),
});

export type PageAnalysis = z.infer<typeof pageAnalysisSchema>;

const analysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    country: {
      type: ["string", "null"],
      description: "Likely issuing country or area, or null if unclear.",
    },
    era: {
      type: ["string", "null"],
      description: "Approximate period, e.g. 1870s, 1920-1945, post-war.",
    },
    denomination: {
      type: ["string", "null"],
      description: "Visible face value and currency if readable.",
    },
    motive: {
      type: ["string", "null"],
      description: "Main subject or design motif.",
    },
    usedState: {
      type: ["string", "null"],
      description: "mint, used, cancelled, hinged, cover cut, or unclear.",
    },
    condition: {
      type: ["string", "null"],
      description: "Short condition note: faults, perforation, centering, gum.",
    },
    catalogHint: {
      type: ["string", "null"],
      description:
        "Careful catalog hint without claiming a definitive catalog number.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Identification confidence from 0 to 1.",
    },
    valueClass: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "0 mass item, 1 0.10-1 EUR, 2 1-5 EUR, 3 5-25 EUR, 4 25-100 EUR, 5 potentially over 100 EUR or expert review.",
    },
    valueMin: {
      type: ["number", "null"],
      description: "Rough lower retail estimate in EUR, or null.",
    },
    valueMax: {
      type: ["number", "null"],
      description: "Rough upper retail estimate in EUR, or null.",
    },
    needsExpert: {
      type: "boolean",
      description:
        "True for suspected rarity, forgery risk, high value, or uncertain high-impact identification.",
    },
  },
  required: [
    "country",
    "era",
    "denomination",
    "motive",
    "usedState",
    "condition",
    "catalogHint",
    "confidence",
    "valueClass",
    "valueMin",
    "valueMax",
    "needsExpert",
  ],
};

const pageAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    objectType: {
      type: "string",
      enum: ["albumseite", "beleg", "einzelmarke", "unbrauchbar"],
    },
    captureQuality: {
      type: "string",
      enum: ["ok", "grenzwertig", "kritisch"],
    },
    completeness: {
      type: "string",
      enum: [
        "vollstaendig",
        "vollstaendig_genug",
        "teilweise_abgeschnitten",
        "wesentlich_abgeschnitten",
        "unklar",
      ],
    },
    qualityFlags: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "unscharf",
          "schief_perspektive",
          "spiegelung_schatten",
          "zu_klein_aufgenommen",
          "rand_abgeschnitten",
          "bereich_fehlt",
          "teilweise_verdeckt",
          "schutzfolie_reflex",
          "ok",
        ],
      },
    },
    detectedItems: {
      type: "object",
      additionalProperties: false,
      properties: {
        stampCountEstimate: { type: "integer", minimum: 0 },
        postmarkCountEstimate: { type: "integer", minimum: 0 },
        addressVisible: { type: "boolean" },
        specialCancelLikely: { type: "boolean" },
        coverOrCardLikely: { type: "boolean" },
      },
      required: [
        "stampCountEstimate",
        "postmarkCountEstimate",
        "addressVisible",
        "specialCancelLikely",
        "coverOrCardLikely",
      ],
    },
    recommendedAction: {
      type: "string",
      enum: [
        "akzeptieren",
        "zur_sichtung",
        "neu_fotografieren",
        "einzelmarke_empfehlen",
        "beleg_analysieren",
      ],
    },
    singleStampExceptionSuggested: { type: "boolean" },
    summary: {
      type: "string",
      description:
        "Short German summary for the review queue. Mention the concrete reason for the action.",
    },
  },
  required: [
    "objectType",
    "captureQuality",
    "completeness",
    "qualityFlags",
    "detectedItems",
    "recommendedAction",
    "singleStampExceptionSuggested",
    "summary",
  ],
};

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY ist nicht gesetzt.");
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

export async function analyzeStampImageBytes(bytes: Buffer, mimeType: string) {
  const client = getClient();
  const imageBase64 = bytes.toString("base64");
  const model = process.env.OPENAI_VISION_MODEL || "gpt-5.5";

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "You are a cautious philately assistant for triage of large stamp collections. You do not certify authenticity and you avoid definitive catalog-number claims unless clearly visible.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Analyze this single stamp crop for coarse collection triage. Return only the requested JSON fields. Apply valueClass exactly as: 0 = mass item, 1 = 0.10-1 EUR, 2 = 1-5 EUR, 3 = 5-25 EUR, 4 = 25-100 EUR, 5 = potentially over 100 EUR or expert review. Set needsExpert true for valueClass 5, likely forgeries, scarce overprints, rare variants, unclear high-value cases, or serious condition/authenticity questions.",
          },
          {
            type: "input_image",
            image_url: `data:${mimeType};base64,${imageBase64}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "stamp_analysis",
        strict: true,
        schema: analysisJsonSchema,
      },
    },
    max_output_tokens: 1200,
  } as never);

  const outputText = response.output_text;
  const parsed = stampAnalysisSchema.parse(JSON.parse(outputText));

  return {
    data: parsed,
    raw: {
      responseId: response.id,
      model,
      outputText,
      parsed,
      usage: response.usage ?? null,
    },
  };
}

export async function analyzePageImageBytes(
  bytes: Buffer,
  mimeType: string,
  objectType: string,
) {
  const client = getClient();
  const imageBase64 = bytes.toString("base64");
  const model = process.env.OPENAI_VISION_MODEL || "gpt-5.5";
  const expectedObject =
    objectType === "beleg"
      ? "The user marked this image as a full postal cover/card/document. Treat stamps, postmarks, address and document completeness as one cover object."
      : "The user marked this image as an album page. Treat it as a page with multiple stamps unless the image clearly shows a full cover/card/document.";

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "You are a cautious philately intake assistant. Your task is not a final catalog valuation. Triage the uploaded image for a stamp collection workflow and decide the next action.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `${expectedObject}\n\nReturn JSON only. Decide whether this is an album page, a full cover/card/document (beleg), a single stamp exception, or unusable. For covers, evaluate the whole cover: stamps, cancellation/postmark, address visibility, special cancel, and whether the cover is complete enough. For album pages, evaluate page quality, completeness, approximate stamp count, and whether a single-stamp exception is warranted. Choose recommendedAction by workflow: akzeptieren = usable without human review; zur_sichtung = usable but needs PC review; neu_fotografieren = missing/blurred/cut off enough to retake; einzelmarke_empfehlen = only if a small region should be captured separately; beleg_analysieren = full cover/card should follow cover analysis rather than single-stamp flow.`,
          },
          {
            type: "input_image",
            image_url: `data:${mimeType};base64,${imageBase64}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "page_analysis",
        strict: true,
        schema: pageAnalysisJsonSchema,
      },
    },
    max_output_tokens: 1400,
  } as never);

  const outputText = response.output_text;
  const parsed = pageAnalysisSchema.parse(JSON.parse(outputText));

  return {
    data: parsed,
    raw: {
      responseId: response.id,
      model,
      outputText,
      parsed,
      usage: response.usage ?? null,
    },
  };
}
