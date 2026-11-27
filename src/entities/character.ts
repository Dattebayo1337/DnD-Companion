import { z } from "zod";
import { abilities, damages, editionSchema } from "./content";
export const skillAbilities = {
  Acrobatics: "DEX",
  AnimalHandling: "WIS",
  Arcana: "INT",
  Athletics: "STR",
  Deception: "CHA",
  History: "INT",
  Insight: "WIS",
  Intimidation: "CHA",
  Investigation: "INT",
  Medicine: "WIS",
  Nature: "INT",
  Perception: "WIS",
  Performance: "CHA",
  Persuasion: "CHA",
  Religion: "INT",
  SleightOfHand: "DEX",
  Stealth: "DEX",
  Survival: "WIS",
} as const;
export const skillLabels: Record<keyof typeof skillAbilities, string> = {
  Acrobatics: "Акробатика",
  AnimalHandling: "Уход за животными",
  Arcana: "Магия",
  Athletics: "Атлетика",
  Deception: "Обман",
  History: "История",
  Insight: "Проницательность",
  Intimidation: "Запугивание",
  Investigation: "Анализ",
  Medicine: "Медицина",
  Nature: "Природа",
  Perception: "Внимательность",
  Performance: "Выступление",
  Persuasion: "Убеждение",
  Religion: "Религия",
  SleightOfHand: "Ловкость рук",
  Stealth: "Скрытность",
  Survival: "Выживание",
};
const scores = z
  .object({
    STR: z.number().int().min(1).max(30),
    DEX: z.number().int().min(1).max(30),
    CON: z.number().int().min(1).max(30),
    INT: z.number().int().min(1).max(30),
    WIS: z.number().int().min(1).max(30),
    CHA: z.number().int().min(1).max(30),
  })
  .strict();
const uuid = z.string().uuid(),
  count = z.number().int().min(0).max(1000000),
  text = z.string().max(20000);
export const customSheetSchema = z
  .object({
    title: z.string().trim().max(120).default("Мой лист"),
    columns: z.union([z.literal(1), z.literal(2)]).default(2),
    standalone: z.boolean().optional(),
    blocks: z
      .array(
        z
          .object({
            id: uuid,
            title: z.string().trim().min(1).max(120),
            kind: z.enum(["text", "number", "checkbox", "resource"]),
            text: text.default(""),
            value: z.number().finite().min(-1000000).max(1000000).default(0),
            max: z.number().int().min(0).max(1000000).default(1),
            checked: z.boolean().default(false),
            wide: z.boolean().default(false),
            group: z.string().max(60).optional(),
            caption: z.string().max(120).optional(),
          })
          .strict(),
      )
      .max(120)
      .default([]),
  })
  .strict()
  .superRefine((sheet, ctx) => {
    if (new Set(sheet.blocks.map((b) => b.id)).size !== sheet.blocks.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Идентификаторы блоков должны быть уникальны.",
      });
    for (const block of sheet.blocks)
      if (
        block.kind === "resource" &&
        (!Number.isInteger(block.value) ||
          block.value < 0 ||
          block.value > block.max)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Счётчик должен быть целым числом от 0 до максимума.",
        });
  });
export type CustomSheet = z.infer<typeof customSheetSchema>;
export const characterSchema = z
  .object({
    effects: z
      .array(
        z
          .object({
            id: uuid,
            source: z.string().trim().min(1).max(120),
            target: z.enum([
              "ac",
              "speed",
              "speedOverride",
              "resource",
              "saves",
              "skills",
              "advantage",
              "disadvantage",
              "resistance",
              "immunity",
              "vulnerability",
            ]),
            specific: z.string().max(160).optional(),
            bonus: z.number().int().min(-100).max(100),
            duration: z.discriminatedUnion("kind", [
              z.object({ kind: z.literal("manual") }),
              z.object({
                kind: z.literal("rounds"),
                remaining: z.number().int().min(1).max(100),
              }),
              z.object({ kind: z.literal("rest") }),
              z.object({ kind: z.literal("concentration"), spellId: uuid }),
              z.object({ kind: z.literal("equipment"), itemId: uuid }),
              z.object({ kind: z.literal("condition"), conditionId: uuid }),
            ]),
          })
          .strict()
          .refine(
            (effect) =>
              effect.target === "speedOverride"
                ? effect.bonus >= 0
                : effect.bonus !== 0,
            "Укажите допустимое значение эффекта.",
          )
          .refine(
            (effect) =>
              effect.target === "resource"
                ? Boolean(effect.specific?.trim())
                : ["advantage", "disadvantage"].includes(effect.target)
                  ? ["attack", "skills", "saves"].includes(
                      effect.specific ?? "",
                    )
                  : ["resistance", "immunity", "vulnerability"].includes(
                        effect.target,
                      )
                    ? damages.some((type) => type === effect.specific)
                    : effect.specific === undefined ||
                      (effect.target === "saves" &&
                        abilities.some(
                          (ability) => ability === effect.specific,
                        )) ||
                      (effect.target === "skills" &&
                        Object.hasOwn(skillAbilities, effect.specific)),
            "Поправка должна указывать подходящий навык или спасбросок.",
          ),
      )
      .max(30)
      .refine(
        (effects) =>
          new Set(effects.map((effect) => effect.id)).size === effects.length,
        "Повторяющиеся идентификаторы эффектов.",
      )
      .default([]),
    name: z.string().trim().min(1).max(120),
    customSheet: customSheetSchema.default({}),
    importSource: z
      .object({ format: z.literal("lss-v2"), json: z.string().max(1048576) })
      .strict()
      .optional(),
    edition: editionSchema,
    speciesRaceId: uuid,
    backgroundId: uuid,
    method: z.enum(["Standard", "PointBuy", "Manual", "Roll"]),
    abilities: scores,
    abilityBonuses: z
      .record(z.enum(abilities), z.number().int().min(0).max(20))
      .default({}),
    classes: z
      .array(
        z
          .object({
            classId: uuid,
            subclassId: uuid.nullable().default(null),
            level: z.number().int().min(1).max(20),
            hpRolls: z.array(z.number().int().min(1).max(12)).min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    skills: z
      .record(
        z.enum(
          Object.keys(skillAbilities) as [
            keyof typeof skillAbilities,
            ...(keyof typeof skillAbilities)[],
          ],
        ),
        z.number().int().min(0).max(2),
      )
      .default({}),
    extraSaves: z.array(z.enum(abilities)).max(6).default([]),
    alignment: text.default(""),
    experience: count.default(0),
    hp: count.default(0),
    tempHp: count.default(0),
    spentHitDice: z.record(uuid, count).default({}),
    slotsSpent: z.array(count).length(9).default(Array(9).fill(0)),
    pactSpent: count.default(0),
    resourcesUsed: z.record(z.string().max(160), count).default({}),
    inventory: z
      .array(
        z
          .object({
            id: uuid,
            contentId: uuid,
            quantity: z.number().int().min(1).max(10000),
            equipped: z.boolean().default(false),
            attuned: z.boolean().default(false),
          })
          .strict(),
      )
      .max(500)
      .default([]),
    spells: z
      .array(
        z
          .object({
            spellId: uuid,
            classId: uuid,
            status: z.enum(["Known", "Prepared", "Always"]),
          })
          .strict(),
      )
      .max(1000)
      .default([]),
    featIds: z.array(uuid).max(100).default([]),
    conditionIds: z.array(uuid).max(30).default([]),
    concentrationId: uuid.nullable().default(null),
    exhaustion: z.number().int().min(0).max(6).default(0),
    currency: z
      .object({
        CP: count.default(0),
        SP: count.default(0),
        EP: count.default(0),
        GP: count.default(0),
        PP: count.default(0),
      })
      .strict()
      .default({}),
    languages: text.default(""),
    proficiencies: text.default(""),
    notes: text.default(""),
    adjustments: z
      .object({
        maxHp: z.number().int().min(-1000).max(1000).default(0),
        ac: z.number().int().min(0).max(100).nullable().default(null),
        initiative: z.number().int().min(-50).max(50).default(0),
        speed: z.number().int().min(0).max(1000).default(30),
      })
      .strict()
      .default({}),
    deathSaves: z
      .object({
        success: z.number().int().min(0).max(3),
        failure: z.number().int().min(0).max(3),
      })
      .strict()
      .default({ success: 0, failure: 0 }),
  })
  .strict();
export type CharacterData = z.infer<typeof characterSchema>;
export type CharacterRecord = {
  id: string;
  version: number;
  data: CharacterData;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};
