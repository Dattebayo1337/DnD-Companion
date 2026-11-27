import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkEditorialCoverage, checkReferenceCoverage } from "../../scripts/reference-coverage";
import { libraryFiles, reviewedEntry } from "../../scripts/bundled-catalog";
import { readingContent } from "../domain/reading-content";
import { parseDataset } from "../imports/pipeline";

test("Полный режим показывает именованные эффекты, правила обеих мелодий и две таблицы подкидыша", () => {
  const sets = ["srd/spells", "srd/monsters", "srd/references", "phb/backgrounds",
    "phb/subclasses", "phb/feats", "dndsu/supplement", "dndsu/options"];
  const entries = [...sets.flatMap(s => [2014, 2024].map(y => `data/${s}-${y}.json`)), ...libraryFiles()]
    .flatMap(path => parseDataset(readFileSync(path, "utf8")).entries).map(reviewedEntry);
  const report = checkEditorialCoverage(entries);
  assert.equal(report.namedOptions, 1231);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.missingShortCards, []);
  const read = (name: string) => {
    const card = entries.find(e => e.nameOriginal.toLowerCase() === name && e.edition === "5e_2014");
    assert.ok(card);
    return readingContent(card);
  };
  const bow = read("bow of melodies");
  const precision = bow.features.find(f => f.nameRu === "Мелодия точности");
  assert.match(precision?.descriptionRu ?? "", /\+1.*\+2/);
  assert.match(bow.features.find(f => f.nameRu === "Мелодия реверберации")?.descriptionRu ?? "", /звуком.*Харизмы/);
  assert.match(read("cartomancer").features.find(f => f.nameRu === "Туз в рукаве")?.descriptionRu ?? "", /8 часов.*бонусным действием/);
  const foundling = read("giant foundling");
  for (const title of ["Как герой оказался у великанов", "Черта характера подкидыша"]) {
    const table = foundling.features.find(f => f.nameRu === title);
    assert.deepEqual(Array.from(table?.descriptionRu.matchAll(/^\| ([1-6]) \|/gm) ?? [], m => m[1]),
      ["1", "2", "3", "4", "5", "6"]);
  }
  const altered = entries.find(e => e.nameOriginal.toLowerCase() === "bow of melodies");
  assert.ok(altered?.kind === "Reference");
  altered.reference.features = altered.reference.features.filter(f => f.nameRu !== "Мелодия точности");
  assert.ok(checkEditorialCoverage(entries).missing.some(f => f.id === altered.id && f.option === "Мелодия точности"));
});

test("Сверка обнаруживает переставленных духов и неверную кость в именованном ударе", () => {
  const entries = ["data/dndsu/options-2024.json", "data/dndsu/library/2014-feat-01.json",
    "data/dndsu/library/2014-magicitem-01.json"].flatMap(p => parseDataset(readFileSync(p, "utf8")).entries);
  const before = checkReferenceCoverage(entries).cases;
  assert.deepEqual(before.map(c => c.matched), [12, 6, 22]);
  for (const entry of entries) {
    if (entry.kind !== "Reference") continue;
    const spirits = entry.reference.features.find(f => f.nameRu === "Замогильные духи");
    if (spirits) spirits.descriptionRu = spirits.descriptionRu.replace("| 1 | Возлюбленный |", "| 2 | Возлюбленный |");
    const fire = entry.reference.features.find(f => f.nameRu === "Огненный удар");
    if (fire) fire.descriptionRu = fire.descriptionRu.replace("1к10", "1к6");
  }
  const after = checkReferenceCoverage(entries).cases;
  assert.deepEqual(after.map(c => c.missing), [["Возлюбленный"], ["Огненный удар"], []]);
});

test("Сверка различает таблицы заклинаний Глаза и Руки Векны", () => {
  const entries = parseDataset(readFileSync("data/dndsu/library/2024-magicitem-01.json", "utf8")).entries;
  const eye = entries.find(e => e.nameRu === "Глаз и рука Векны");
  assert.ok(eye && eye.kind === "Reference");
  const checked = () => checkReferenceCoverage([eye]).tables.filter(t => t.id === eye.id);
  assert.equal(checked().length, 2);
  assert.ok(checked().every(t => t.passed));
  const table = eye.reference.features.find(f => f.nameRu === "Заклинания Глаза Векны");
  assert.ok(table);
  table.descriptionRu = table.descriptionRu.replace("| Дезинтеграция | 4 |", "| Дезинтеграция | 1 |");
  assert.deepEqual(checked().filter(t => !t.passed).map(t => t.feature), ["Заклинания Глаза Векны"]);
});
