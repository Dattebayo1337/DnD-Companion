import { z } from "zod";
import {
  characterSchema,
  customSheetSchema,
  skillAbilities,
  type CharacterData,
} from "@/entities/character";
import type { Content, EditionId } from "@/entities/content";
import {
  classRules,
  deriveCharacter,
  validateCharacter,
} from "./rules/character";

export const MAX_CHARACTER_FILE = 8 * 1024 * 1024;
const nativeFile = z
  .object({
    format: z.literal("dnd-companion-character"),
    version: z.literal(1),
    data: characterSchema,
  })
  .strict();
export const sheetFile = z
  .object({
    format: z.literal("dnd-companion-sheet"),
    version: z.literal(1),
    sheet: customSheetSchema,
  })
  .strict();
export const exportCharacter = (data: CharacterData) => ({
  format: "dnd-companion-character",
  version: 1,
  data,
});
export const exportSheet = (sheet: CharacterData["customSheet"]) => ({
  format: "dnd-companion-sheet",
  version: 1,
  sheet,
});
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const value = (v: unknown) => obj(v).value ?? v;
const str = (v: unknown) =>
  typeof value(v) === "string" ? (value(v) as string) : "";
const num = (v: unknown, fallback = 0) => {
  const x = value(v);
  return (typeof x === "number" ||
    (typeof x === "string" && x.trim() !== "")) &&
    Number.isFinite(Number(x))
    ? Number(x)
    : fallback;
};
const normalize = (v: string) =>
  v
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]/gu, "");
function readJson(text: string): unknown {
  if (new TextEncoder().encode(text).length > MAX_CHARACTER_FILE)
    throw Error("Файл превышает 8 МБ.");
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw Error("Файл содержит неверный JSON.");
  }
}
// ProseMirror text only: no HTML rendering or execution of imported expressions.
function plain(v: unknown, depth = 0): string {
  if (depth > 30) return "";
  if (typeof v === "string") return v;
  const o = obj(v);
  if (typeof o.text === "string") return o.text;
  if (Array.isArray(o.content))
    return o.content
      .map((x) => plain(x, depth + 1))
      .join(o.type === "doc" ? "\n" : "");
  if (o.value !== undefined) return plain(o.value, depth + 1);
  if (o.data !== undefined) return plain(o.data, depth + 1);
  return "";
}
export function parseSheetFile(text: string) {
  return sheetFile.parse(readJson(text)).sheet;
}

export function parseCharacterFile(
  text: string,
  entries: Content[],
  edition: EditionId,
  overrides: {
    classId?: string;
    speciesRaceId?: string;
    backgroundId?: string;
  } = {},
) {
  const root = obj(readJson(text));
  const warnings: string[] = [];
  let data: CharacterData;
  let format: "native" | "lss-v2" = "native";
  if (root.format === "dnd-companion-character")
    data = nativeFile.parse(root).data;
  else if (root.jsonType === "character" && root.version === "2") {
    format = "lss-v2";
    if (new TextEncoder().encode(text).length > 1024 * 1024)
      throw Error("Исходный LSS JSON превышает 1 МБ.");
    if (typeof root.data !== "string")
      throw Error("В LSS v2 поле data должно содержать JSON-строку.");
    const lss = obj(readJson(root.data)),
      info = obj(lss.info),
      vitality = obj(lss.vitality);
    const importedEdition = root.edition === undefined ? "2024" : root.edition;
    if (!["2014", "2024"].includes(importedEdition as string))
      throw Error("Неизвестная редакция LSS.");
    if (`5e_${importedEdition}` !== edition)
      throw Error(
        `Переключите редакцию приложения на ${importedEdition} и повторите импорт.`,
      );
    const resolve = (category: string, field: unknown, override?: string) => {
      const candidates = entries.filter(
        (e) =>
          e.edition === edition &&
          e.kind === "Reference" &&
          e.reference.category === category,
      );
      if (override) return candidates.find((e) => e.id === override)?.id;
      // A user-edited visible name must not silently fall back to a stale ID.
      const label = str(field).trim();
      const keys = [label || str(obj(field).id)].filter(Boolean).map(normalize);
      const matches = candidates.filter((e) =>
        [e.nameRu, e.nameOriginal].some(
          (n) => n && keys.includes(normalize(n)),
        ),
      );
      return matches.length === 1 ? matches[0].id : undefined;
    };
    const classId = resolve("Class", info.charClass, overrides.classId);
    const speciesRaceId = resolve(
      "SpeciesRace",
      info.race,
      overrides.speciesRaceId,
    );
    const backgroundId = resolve(
      "Background",
      info.background,
      overrides.backgroundId,
    );
    if (!classId || !classRules[classId] || !speciesRaceId || !backgroundId)
      throw Error(
        "Не удалось сопоставить: " +
          [
            !classId || !classRules[classId]
              ? `класс «${str(info.charClass)}»`
              : "",
            !speciesRaceId ? `вид / раса «${str(info.race)}»` : "",
            !backgroundId ? `предыстория «${str(info.background)}»` : "",
          ]
            .filter(Boolean)
            .join(", ") +
          `. Редакция ${importedEdition}. Выберите соответствия под файлом. Если нужного варианта нет, потребуется совместимая запись справочника; другая раса изменит персонажа.`,
      );
    const level = num(info.level, 1),
      rule = classRules[classId];
    if (!Number.isInteger(level) || level < 1 || level > 20)
      throw Error("Уровень LSS должен быть от 1 до 20.");
    const abilities = Object.fromEntries(
      ["STR", "DEX", "CON", "INT", "WIS", "CHA"].map((a) => [
        a,
        num(obj(obj(lss.stats)[a.toLowerCase()]).score, 10),
      ]),
    );
    const blocks: CharacterData["customSheet"]["blocks"] = [];
    const addText = (title: string, text: string) => {
      if (text.trim())
        blocks.push({
          id: crypto.randomUUID(),
          title,
          kind: "text",
          text,
          value: 0,
          max: 1,
          checked: false,
          wide: true,
        });
    };
    const labels: Record<string, string> = {
      traits: "Умения LSS",
      equipment: "Снаряжение LSS",
      personality: "Характер",
      ideals: "Идеалы",
      bonds: "Привязанности",
      flaws: "Слабости",
      backstory: "Предыстория",
      notes: "Заметки",
    };
    for (const [key, field] of Object.entries(obj(lss.text)))
      addText(labels[key] ?? key, plain(field));
    addText(
      "Происхождение LSS",
      Object.entries(info)
        .map(([k, v]) => `${k}: ${str(v) || num(v)}`)
        .join("\n"),
    );
    addText(
      "Внешность LSS",
      Object.entries(obj(lss.subInfo))
        .map(([k, v]) => `${k}: ${str(v)}`)
        .join("\n"),
    );
    addText(
      "Оружие LSS",
      (Array.isArray(lss.weaponsList) ? lss.weaponsList : [])
        .map((v) => {
          const w = obj(v);
          return `${str(w.name)}: ${str(w.dmg)} ${str(w.dmgType)} ${str(w.notes)}`;
        })
        .join("\n"),
    );
    for (const r of Object.values(obj(lss.resources))) {
      const o = obj(r);
      const max = num(o.max),
        current = num(o.current);
      if (
        Number.isInteger(max) &&
        max >= 0 &&
        Number.isInteger(current) &&
        current >= 0 &&
        current <= max
      )
        blocks.push({
          id: crypto.randomUUID(),
          title: str(o.name) || "Ресурс LSS",
          kind: "resource",
          text: "",
          value: current,
          max,
          checked: false,
          wide: false,
        });
    }
    data = characterSchema.parse({
      name: str(lss.name) || "Импортированный герой",
      edition,
      speciesRaceId,
      backgroundId,
      method: "Manual",
      abilities,
      classes: [
        {
          classId,
          level,
          subclassId: null,
          hpRolls: Array.from({ length: level }, (_, i) =>
            i === 0 ? rule.hitDie : Math.floor(rule.hitDie / 2) + 1,
          ),
        },
      ],
      skills: Object.fromEntries(
        Object.keys(skillAbilities).map((k) => {
          const match = Object.entries(obj(lss.skills)).find(
            ([name]) => normalize(name) === normalize(k),
          );
          const skill = obj(match?.[1]);
          return [
            k,
            skill.isExpert === true ? 2 : skill.isProf === true ? 1 : 0,
          ];
        }),
      ),
      extraSaves: Object.entries(obj(lss.saves))
        .filter(([, v]) => obj(v).isProf === true)
        .map(([k]) => k.toUpperCase()),
      alignment: str(info.alignment),
      experience: num(info.experience),
      hp: num(vitality["hp-current"]),
      tempHp: num(vitality["hp-temp"]),
      adjustments: {
        speed: num(vitality.speed, 30),
        ac:
          typeof value(vitality.ac) === "number" ||
          /^\d+$/.test(str(vitality.ac))
            ? num(vitality.ac)
            : null,
      },
      currency: Object.fromEntries(
        ["CP", "SP", "EP", "GP", "PP"].map((k) => [
          k,
          num(obj(lss.coins)[k.toLowerCase()]),
        ]),
      ),
      deathSaves: {
        success: num(vitality.deathSuccesses),
        failure: num(vitality.deathFails),
      },
      exhaustion: num(lss.exhaustion),
      customSheet: { title: "Лист из LSS", columns: 2, blocks },
      importSource: { format: "lss-v2", json: text },
    });
    const targetHp = num(vitality["hp-max"], deriveCharacter(data).maxHp);
    data.adjustments.maxHp = targetHp - deriveCharacter(data).maxHp;
    data = characterSchema.parse(data);
    warnings.push(
      "Перенесены базовые значения. Эффекты, формулы, бонусы, мультикласс, автоматические ресурсы и связи заклинаний LSS не вычисляются. Сверьте итоговые показатели с исходным листом.",
    );
    warnings.push(
      "Снаряжение и оружие перенесены текстом; подкласс и заклинания выберите из справочников. Исходный JSON сохранён отдельно и доступен для скачивания владельцу.",
    );
    if (Array.isArray(lss.bonuses) && lss.bonuses.length)
      warnings.push(
        "В исходнике есть бонусы LSS: они не применены автоматически, включая возможные бонусы к максимуму хитов.",
      );
  } else if (
    root.data &&
    typeof root.data === "object" &&
    root.id &&
    root.version
  ) {
    // Compatibility with older Companion exports; identity/owner/version never reach create.
    data = characterSchema.parse(root.data);
  } else if (root.name && root.abilities && root.classes)
    data = characterSchema.parse(root);
  else
    throw Error(
      "Поддерживаются JSON D&D Companion и экспорт Long Story Short версии 2.",
    );
  if (data.edition !== edition)
    throw Error(
      `Переключите редакцию приложения на ${data.edition.slice(3)} и повторите импорт.`,
    );
  const issues = validateCharacter(
    data,
    new Map(entries.map((e) => [e.id, e])),
  );
  if (issues.length) throw Error(issues.join("\n"));
  return { data, format, warnings };
}
