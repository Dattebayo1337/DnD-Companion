import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { db } from "../src/database/client";
import { contentInclude, json, toContent } from "../src/database/repository";
import { parseDataset } from "../src/imports/pipeline";

const entries = ["spells-2014", "spells-2024", "monsters-2014"].flatMap(
  (file) =>
    parseDataset(
      readFileSync("data/srd/" + file + ".json", "utf8"),
    ).entries.filter((entry) =>
      entry.kind === "Spell"
        ? entry.contentVersion >= 4
        : entry.id === "3b2fdd2e-18cf-5973-ad1c-b96577b9dc57",
    ),
);
try {
  const updated = await db.$transaction(
    async (tx) => {
      const batch = await tx.importBatch.create({
        data: { name: "Структурирование SRD 2026-11-26", count: 0 },
      });
      let count = 0;
      for (const entry of entries) {
        const row = await tx.content.findUnique({
          where: { id: entry.id },
          include: contentInclude,
        });
        if (!row)
          throw Error("Отсутствует исходная запись " + entry.nameOriginal);
        const current = toContent(row);
        if (isDeepStrictEqual(current, entry)) continue;
        const expected = {
          ...current,
          contentVersion: entry.contentVersion,
          updatedAt: entry.updatedAt,
        };
        if (expected.kind === "Spell" && entry.kind === "Spell") {
          expected.spell = {
            ...expected.spell,
            damageTypes: entry.spell.damageTypes,
            savingThrows: entry.spell.savingThrows,
          };
          if (!entry.spell.damageTypes) delete expected.spell.damageTypes;
          if (!entry.spell.savingThrows) delete expected.spell.savingThrows;
        } else if (expected.kind === "Monster" && entry.kind === "Monster") {
          if (
            expected.monster.actions.length ||
            expected.monster.traits.length !== 1 ||
            expected.monster.traits[0].descriptionRu !==
              entry.monster.traits[0].descriptionRu +
                "\n\n" +
                entry.monster.actions[0].descriptionRu
          )
            throw Error("Исходные действия отличаются: " + entry.nameOriginal);
          expected.monster = {
            ...expected.monster,
            traits: entry.monster.traits,
            actions: entry.monster.actions,
          };
        }
        if (
          current.contentVersion >= entry.contentVersion ||
          !isDeepStrictEqual(expected, entry)
        )
          throw Error(
            "Исходная запись отличается: " +
              entry.nameOriginal +
              " " +
              entry.edition,
          );
        if (entry.kind === "Spell")
          await tx.spell.update({
            where: { contentId: entry.id },
            data: { details: json(entry.spell) },
          });
        if (entry.kind === "Monster")
          await tx.monster.update({
            where: { contentId: entry.id },
            data: { details: json(entry.monster) },
          });
        await tx.content.update({
          where: { id: entry.id },
          data: {
            contentVersion: entry.contentVersion,
            updatedAt: entry.updatedAt,
          },
        });
        await tx.contentRevision.create({
          data: {
            contentId: entry.id,
            contentVersion: entry.contentVersion,
            snapshot: json(entry),
            importBatchId: batch.id,
          },
        });
        count++;
      }
      if (count)
        await tx.importBatch.update({
          where: { id: batch.id },
          data: { count },
        });
      else await tx.importBatch.delete({ where: { id: batch.id } });
      return count;
    },
    { timeout: 60000 },
  );
  console.log({ updated, skipped: entries.length - updated });
} finally {
  await db.$disconnect();
}
