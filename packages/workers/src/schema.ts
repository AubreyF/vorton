export const executiveRecommendationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "evidenceRecordIds",
    "alternatives",
    "recommendedAction",
    "confidence",
    "uncertainties",
  ],
  properties: {
    summary: { type: "string", minLength: 1 },
    evidenceRecordIds: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "string", format: "uuid" },
    },
    alternatives: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "expectedOutcome", "risks"],
        properties: {
          title: { type: "string", minLength: 1 },
          description: { type: "string", minLength: 1 },
          expectedOutcome: { type: "string", minLength: 1 },
          risks: {
            type: "array",
            maxItems: 20,
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
    recommendedAction: {
      type: "object",
      additionalProperties: false,
      required: [
        "title",
        "description",
        "capability",
        "mode",
        "externalEffect",
      ],
      properties: {
        title: { type: "string", minLength: 1 },
        description: { type: "string", minLength: 1 },
        capability: { type: "string", minLength: 1 },
        mode: {
          type: "string",
          enum: [
            "observe",
            "diagnose",
            "recommend",
            "modify",
            "approve",
            "publish",
            "verify",
          ],
        },
        externalEffect: { type: "boolean" },
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    uncertainties: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1 },
    },
  },
} as const;
