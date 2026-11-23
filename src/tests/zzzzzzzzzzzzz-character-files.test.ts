import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { characterSheetTemplate } from "../domain/paper-sheet";
import { parseDataset, importDataset } from "../imports/pipeline";
import { characterSchema, customSheetSchema } from "../entities/character";
import { classRules } from "../domain/rules/character";
import {
  parseCharacterFile,
  exportCharacter,
  exportSheet,
  parseSheetFile,
} from "../domain/character-files";
import { characterCommand } from "../services/characters/service";
const dataset = parseDataset(
  readFileSync("data/srd/references-2024.json", "utf8"),
);
const entries = dataset.entries;
const find = (category: string) =>
  entries.find(
    (e) => e.kind === "Reference" && e.reference.category === category,
  )!;
const rule = Object.values(classRules).find(
  (c) => c.edition === "5e_2024" && c.name === "Fighter",
)!;
const hero = () =>
  characterSchema.parse({
    name: "Тест JSON",
    edition: "5e_2024",
    method: "Manual",
    speciesRaceId: find("SpeciesRace").id,
    backgroundId: find("Background").id,
    abilities: { STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 },
    classes: [{ classId: rule.id, level: 1, hpRolls: [10] }],
    hp: 1,
    tempHp: 3,
    customSheet: {
      title: "Мои правила",
      blocks: [
        {
          id: randomUUID(),
          title: "Заряды",
          kind: "resource",
          value: 1,
          max: 3,
        },
      ],
    },
  });

test("Editable paper template preserves values, supports deleting core stats and survives JSON/save roundtrip", () => {
  const original = hero();
  const sheet = characterSheetTemplate(original, entries);
  assert.equal(sheet.standalone, true);
  assert.equal(sheet.blocks.find((b) => b.title === "Сила")?.value, 15);
  assert.equal(
    sheet.blocks.find((b) => b.title === "Текущие хиты")?.value,
    original.hp,
  );
  sheet.blocks = sheet.blocks.filter((b) => b.title !== "Сила");
  sheet.blocks.push({
    id: randomUUID(),
    title: "Удача",
    kind: "number",
    value: 7,
    max: 1,
    text: "",
    checked: false,
    wide: false,
    group: "Характеристики",
  });
  const modified = characterSchema.parse({ ...original, customSheet: sheet });
  const roundtrip = parseCharacterFile(
    JSON.stringify(exportCharacter(modified)),
    entries,
    "5e_2024",
  ).data;
  assert.equal(
    roundtrip.customSheet.blocks.some((b) => b.title === "Сила"),
    false,
  );
  assert.equal(
    roundtrip.customSheet.blocks.find((b) => b.title === "Удача")?.value,
    7,
  );
  assert.deepEqual(parseSheetFile(JSON.stringify(exportSheet(sheet))), sheet);
  assert.equal(original.abilities.STR, 15);
  assert.equal(
    customSheetSchema.safeParse({
      ...sheet,
      blocks: Array.from({ length: 121 }, () => ({
        ...sheet.blocks[0],
        id: randomUUID(),
      })),
    }).success,
    false,
  );
});
test("Character JSON and old export roundtrip; reject incompatible references, editions and versions", () => {
  const data = hero();
  assert.deepEqual(
    parseCharacterFile(
      JSON.stringify(exportCharacter(data)),
      entries,
      "5e_2024",
    ).data,
    data,
  );
  assert.deepEqual(
    parseCharacterFile(
      JSON.stringify({
        id: randomUUID(),
        version: 12,
        data,
        ownerId: "foreign",
      }),
      entries,
      "5e_2024",
    ).data,
    data,
  );
  assert.throws(() =>
    parseCharacterFile(
      JSON.stringify({ ...exportCharacter(data), version: 99 }),
      entries,
      "5e_2024",
    ),
  );
  assert.throws(
    () =>
      parseCharacterFile(
        JSON.stringify(exportCharacter(data)),
        entries,
        "5e_2014",
      ),
    /Переключите/,
  );
  assert.throws(
    () =>
      parseCharacterFile(
        JSON.stringify({
          ...data,
          classes: [{ ...data.classes[0], classId: randomUUID() }],
        }),
        entries,
        "5e_2024",
      ),
    /класса|редакции/,
  );
  assert.throws(
    () => parseCharacterFile("[]", entries, "5e_2024"),
    /Поддерживаются/,
  );
});
test("Custom sheet templates validate duplicate IDs and resource bounds", () => {
  const sheet = hero().customSheet;
  assert.deepEqual(parseSheetFile(JSON.stringify(exportSheet(sheet))), sheet);
  assert.equal(
    customSheetSchema.safeParse({
      ...sheet,
      blocks: [sheet.blocks[0], sheet.blocks[0]],
    }).success,
    false,
  );
  assert.equal(
    customSheetSchema.safeParse({
      ...sheet,
      blocks: [{ ...sheet.blocks[0], value: 4 }],
    }).success,
    false,
  );
  assert.equal(
    customSheetSchema.safeParse({
      ...sheet,
      blocks: [{ ...sheet.blocks[0], kind: "script" }],
    }).success,
    false,
  );
});
test("LSS v2 conversion preserves base HP, skills, plain text and original; unknown mappings require explicit choice", () => {
  const input = {
    jsonType: "character",
    version: "2",
    edition: "2024",
    data: JSON.stringify({
      name: { value: "Герой LSS" },
      info: {
        charClass: { value: "Fighter" },
        race: { value: "Missing race", id: find("SpeciesRace").nameOriginal },
        background: { value: "Missing background" },
        level: { value: 3 },
      },
      stats: {
        str: { score: 15 },
        dex: { score: 12 },
        con: { score: 14 },
        int: { score: 10 },
        wis: { score: 10 },
        cha: { score: 8 },
      },
      vitality: {
        "hp-current": { value: 7 },
        "hp-max": { value: 30 },
        "hp-temp": { value: 4 },
        ac: { value: "12+[DEX]" },
      },
      skills: { athletics: { isProf: true } },
      text: {
        notes: {
          value: {
            data: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "<script>text only</script>" },
                  ],
                },
              ],
            },
          },
        },
      },
      resources: { r: { name: "Ки", max: 3, current: 2 } },
    }),
  };
  const text = JSON.stringify(input);
  assert.throws(
    () => parseCharacterFile(text, entries, "5e_2024"),
    /сопоставить/,
  );
  // An old internal race ID must not override a custom visible race name.
  assert.throws(
    () =>
      parseCharacterFile(text, entries, "5e_2024", {
        backgroundId: find("Background").id,
      }),
    /вид \/ раса «Missing race»/,
  );
  const result = parseCharacterFile(text, entries, "5e_2024", {
    speciesRaceId: find("SpeciesRace").id,
    backgroundId: find("Background").id,
  });
  assert.equal(result.data.hp, 7);
  assert.equal(result.data.tempHp, 4);
  assert.equal(result.data.skills.Athletics, 1);
  assert.equal(result.data.importSource?.json, text);
  assert.equal(result.data.adjustments.ac, null);
  assert.ok(result.warnings.length);
  assert.ok(
    result.data.customSheet.blocks.some(
      (b) => b.text === "<script>text only</script>",
    ),
  );
  assert.equal(
    parseCharacterFile(
      JSON.stringify(exportCharacter(result.data)),
      entries,
      "5e_2024",
    ).data.importSource?.json,
    text,
  );
});
test("Import creates a new record preserving HP and custom fields, never mutates the source", async () => {
  await importDataset(dataset);
  const original = await characterCommand({ action: "create", data: hero() });
  const imported = await characterCommand({
    action: "import",
    data: { ...original.data, hp: 1, tempHp: 4 },
  });
  assert.notEqual(original.id, imported.id);
  assert.equal(imported.data.hp, 1);
  assert.equal(imported.data.tempHp, 4);
  assert.deepEqual(imported.data.customSheet, original.data.customSheet);
  await assert.rejects(
    characterCommand({
      action: "import",
      data: { ...hero(), ownerId: "another-owner" },
    }),
  );
  const saved = await characterCommand({
    action: "save",
    id: imported.id,
    version: imported.version,
    data: {
      ...imported.data,
      customSheet: {
        ...characterSheetTemplate(imported.data, entries),
        title: "Изменённый лист",
      },
    },
  });
  assert.equal(saved.data.customSheet.title, "Изменённый лист");
  assert.equal(saved.data.customSheet.standalone, true);
  assert.ok(saved.data.customSheet.blocks.length > 40);
});
