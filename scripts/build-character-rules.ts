import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { verifySources } from "./srd-source";
import { contentSchema } from "../src/entities/content";
import { reviewedEntry } from "./bundled-catalog";
verifySources();
const tables = (s: string) =>
  [...s.matchAll(/(^\|.*\n(?:\|.*\n?)+)/gm)].map((m) =>
    m[1]
      .trim()
      .split("\n")
      .map((l) =>
        l
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim()),
      ),
  );
const n = (s: string | undefined) => Number(s?.match(/\d+/)?.[0] ?? 0);
const classes: Record<string, unknown> = {},
  armor: Record<string, unknown> = {};
for (const year of [2014, 2024]) {
  const data = JSON.parse(
    readFileSync(`data/srd/references-${year}.json`, "utf8"),
  );
  for (const e of data.entries) {
    if (e.reference.category === "Class") {
      const ts = tables(e.descriptionOriginal);
      const core = ts[0];
      const pt = ts.find(
        (t) => t[0][0] === "Level" && t.some((r) => r[0] === "20"),
      )!;
      const get = (label: string) =>
        core.find((r) => r[0] === label)?.[1] ?? "";
      const ability = (s: string) =>
        [
          "Strength",
          "Dexterity",
          "Constitution",
          "Intelligence",
          "Wisdom",
          "Charisma",
        ].flatMap((a, i) =>
          s.includes(a) ? [["STR", "DEX", "CON", "INT", "WIS", "CHA"][i]] : [],
        );
      classes[e.id] = {
        id: e.id,
        name: e.nameOriginal,
        nameRu: e.nameRu,
        edition: e.edition,
        hitDie: Number(get("Hit Point Die").match(/[dD](\d+)/)?.[1] ?? 0),
        saves: ability(get("Saving Throw Proficiencies")),
        skillChoices: get("Skill Proficiencies"),
        rows: pt
          .slice(2)
          .filter((r) => /^\d+$/.test(r[0]))
          .map((r) => ({
            level: n(r[0]),
            slots: Array.from({ length: 9 }, (_, i) => {
              const index = pt[0].indexOf(String(i + 1));
              return index < 0 ? 0 : n(r[index]);
            }),
            values: Object.fromEntries(pt[0].map((h, i) => [h, r[i]])),
          })),
      };
    }
    if (e.reference.category === "Armor") {
      const t = tables(e.descriptionOriginal)[0],
        row = t?.[2];
      if (!row) continue;
      const ac = row[t[0].indexOf("Armor Class (AC)")];
      armor[e.id] = {
        nameRu: e.nameRu,
        base: n(ac),
        dex: ac.includes("Dex"),
        maxDex: /max[^\d]*2/i.test(ac) ? 2 : null,
        shield: /Shield/i.test(e.nameOriginal),
      };
    }
  }
  const options = JSON.parse(readFileSync(`data/dndsu/options-${year}.json`, "utf8"));
  const artificer = reviewedEntry(contentSchema.parse(options.entries.find(
    (entry: { nameOriginal: string }) => entry.nameOriginal === "Artificer",
  )));
  if (artificer.kind !== "Reference" || artificer.reference.progression.length !== 20)
    throw new Error("Таблица развития изобретателя неполна");
  classes[artificer.id] = {
    id: artificer.id, name: artificer.nameOriginal, nameRu: artificer.nameRu,
    edition: artificer.edition, hitDie: 8, saves: ["CON", "INT"],
    skillChoices: "Choose 2: Arcana, History, Investigation, Medicine, Nature, Perception, or Sleight of Hand",
    rows: artificer.reference.progression.map(row => ({
      level: row.level,
      slots: Array.from({ length: 9 }, (_, index) => row.spellSlots[index] ?? 0),
      values: { "Class Features": row.featuresRu, Resources: row.resourcesRu },
    })),
  };
}
mkdirSync("data/rules", { recursive: true });
writeFileSync(
  "data/rules/character-rules.json",
  JSON.stringify({ classes, armor }, null, 2) + "\n",
);
console.log(
  "Character rules",
  Object.keys(classes).length,
  Object.keys(armor).length,
);
