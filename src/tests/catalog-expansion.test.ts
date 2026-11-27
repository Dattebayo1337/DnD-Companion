import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contentSchema, type Content } from "../entities/content";
import { libraryFiles, reviewedEntry } from "../../scripts/bundled-catalog";
import { parseDataset } from "../imports/pipeline";

function entries(path: string) {
  return parseDataset(readFileSync(path, "utf8")).entries;
}

test("Каталог сохраняет разницу между редакциями и особыми блоками без ПО", () => {
  const library = libraryFiles().flatMap(entries);
  const find = (year: number, name: string) =>
    library.find(
      (e) =>
        e.edition === `5e_${year}` && e.nameOriginal.toLowerCase() === name,
    )!;
  for (const year of [2014, 2024]) {
    const toll = find(year, "toll the dead");
    assert.ok(toll.kind === "Spell" && toll.spell.level === 0);
    assert.match(toll.descriptionRu, /1к12/);
    const beholder = find(year, "beholder");
    assert.equal(beholder.kind, "Monster");
    if (beholder.kind === "Monster") {
      assert.equal(
        beholder.monster.actions.filter((a) => /^\d+\./.test(a.nameRu)).length,
        10,
      );
      assert.equal(beholder.monster.challengeRating, 13);
    }
  }
  assert.match(find(2014, "blade ward").descriptionRu, /сопротивление/);
  assert.match(find(2024, "blade ward").descriptionRu, /1к4/);
  const messenger = library.find(
    e => e.kind === "Monster" && e.nameOriginal === "Paper Bird",
  );
  assert.ok(messenger?.kind === "Monster");
  assert.ok(messenger.monster.traits.some(f => /Восприятие/.test(f.descriptionRu)));
  assert.ok(messenger.monster.actions.some(f =>
    /Рукопашная атака/i.test(f.descriptionRu) && /1 \(рубящий\)/.test(f.descriptionRu),
  ));
  const boon = find(2024, "boon of poison mastery");
  assert.ok(boon.kind === "Reference" && boon.reference.features.some(f =>
    /максимум каждой кости/.test(f.descriptionRu),
  ));
  const staff = find(2024, "diamond staff");
  assert.ok(staff.kind === "Reference" && staff.reference.properties.some(p =>
    p.nameRu.includes("зарядов") && p.valueRu.includes("8 — Лабиринт"),
  ));
  const drake = find(2014, "drake companion");
  assert.ok(
    drake.kind === "Reference" &&
      drake.reference.category === "BestiaryProfile",
  );
});

test("Дополнения к старым карточкам требуют точного совпадения исходной версии", () => {
  const source = entries("data/dndsu/options-2014.json").find(
    (e) => e.nameOriginal === "Artificer",
  )!;
  const updated = reviewedEntry(source);
  assert.notEqual(updated, source);
  assert.equal(updated.contentVersion, source.contentVersion + 1);
  assert.ok(
    updated.kind === "Reference" && updated.reference.progression.length === 20,
  );
  const changed: Content = contentSchema.parse({
    ...source,
    descriptionRu: "Другое описание.",
  });
  assert.throws(() => reviewedEntry(changed), /сверка/);
});
