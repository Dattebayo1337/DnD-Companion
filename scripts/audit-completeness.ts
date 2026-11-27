import { writeFileSync } from "node:fs";
import { db } from "../src/database/client";
import { contentInclude, toContent } from "../src/database/repository";
import { plainText } from "../src/domain/content-summary";
import { readingContent } from "../src/domain/reading-content";
import { hasVerifiedNoActions } from "../src/domain/monster-actions";
import { auditDatabase } from "../src/services/manager";
import { checkEditorialCoverage, checkReferenceCoverage, unresolvedNamedOptions } from "./reference-coverage";

// Presence checks deliberately do not certify completeness against a rulebook.
async function main() {
  const entries = (await db.content.findMany({ include: contentInclude })).map(toContent);
  const byId = new Map(entries.map(e => [e.id, e]));
  const referenceReview = checkReferenceCoverage(entries);
  const editorialReview = checkEditorialCoverage(entries);
  const change = referenceReview.change;
  const mismatches = new Set([
    ...editorialReview.missing.map(r => r.id),
    ...referenceReview.cases.filter(c => c.missing.length || c.unexpected.length).map(c => c.id),
    ...referenceReview.tables.filter(t => !t.passed).map(t => t.id),
  ]);
  const rows = entries.map(e => {
    const reading = readingContent(e);
    const description = plainText(e.descriptionRu);
    const flags: string[] = [];
    const unmatchedOptions = unresolvedNamedOptions(e);
    if (unmatchedOptions.length) flags.push("named-options-review");
    if (mismatches.has(e.id)) flags.push("source-outcome-mismatch");
    if (!plainText(reading.summary.text)) flags.push("empty-summary");
    if (!description) flags.push("empty-description");
    if (e.contentOrigin === "MetadataOnly") flags.push("overview-not-full-rules");
    if (!reading.hasDetails) flags.push("summary-only");
    if (description.length < 80) flags.push("short-text-review");
    if (e.translationStatus !== "Approved") flags.push("not-approved");
    if (e.kind === "Reference") {
      if (e.reference.features.some(f => !plainText(f.nameRu) || !plainText(f.descriptionRu))) flags.push("empty-feature-field");
      if (["Class", "Subclass", "SpeciesRace"].includes(e.reference.category) && !e.reference.features.length)
        flags.push("no-structured-features-review-prose");
      if (e.reference.category === "Class" && new Set(e.reference.progression.map(r => r.level)).size !== 20)
        flags.push("progression-not-20-structured-levels");
      if (e.reference.category === "Subclass") {
        const parent = byId.get(e.reference.parentId ?? "");
        if (!parent || parent.kind !== "Reference" || parent.reference.category !== "Class" || parent.edition !== e.edition)
          flags.push("invalid-parent-class");
      }
    }
    if (e.kind === "Spell") {
      if (!e.spell.durationRu.trim()) flags.push("missing-duration");
      if (!e.spell.classes.length && !e.spell.subclasses.length && !e.spell.accessNoteRu?.trim())
        flags.push("missing-spell-classes");
      if (e.spell.components.includes("M") && !e.spell.materialComponentRu.trim()) flags.push("missing-material-description");
    }
    if (e.kind === "Monster") {
      if (!e.monster.actions.length) {
        if (hasVerifiedNoActions(e.id)) flags.push("verified-no-special-actions");
        else if (e.contentOrigin === "MetadataOnly" && e.tags.includes("В источнике отсутствует раздел действий"))
          flags.push("source-has-no-action-section");
        else flags.push("no-structured-actions-review-prose");
      }
      if ([...e.monster.traits, ...e.monster.actions, ...e.monster.bonusActions, ...e.monster.reactions, ...e.monster.legendaryActions, ...e.monster.lairActions, ...e.monster.regionalEffects].some(f => !plainText(f.descriptionRu))) flags.push("empty-monster-feature");
    }
    return { id: e.id, name: e.nameRu, edition: e.edition, category: e.kind === "Reference" ? e.reference.category : e.kind,
      origin: e.contentOrigin, status: e.translationStatus, summaryChars: plainText(reading.summary.text).length,
      descriptionChars: description.length, hasDetails: reading.hasDetails,
      separateFeatures: reading.features.length, separateProperties: reading.properties.length,
      source: e.source, flags, unmatchedOptions };
  });
  const groups = Object.values(rows.reduce<Record<string, { edition: string; category: string; total: number; approved: number; emptySummary: number; emptyDescription: number; srd: number; overview: number; summaryOnly: number; shortText: number }>>((acc, r) => {
    const key = `${r.edition}/${r.category}`;
    const g = acc[key] ??= { edition: r.edition, category: r.category, total: 0, approved: 0, emptySummary: 0, emptyDescription: 0, srd: 0, overview: 0, summaryOnly: 0, shortText: 0 };
    g.total++; g.approved += Number(r.status === "Approved"); g.emptySummary += Number(!r.summaryChars); g.emptyDescription += Number(!r.descriptionChars);
    g.srd += Number(r.origin === "SRD"); g.overview += Number(r.origin === "MetadataOnly"); g.summaryOnly += Number(!r.hasDetails); g.shortText += Number(r.descriptionChars < 80);
    return acc;
  }, {})).sort((a,b) => a.category.localeCompare(b.category) || a.edition.localeCompare(b.edition));
  const flagCounts: Record<string, number> = {};
  for (const r of rows) for (const flag of r.flags) flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
  const summaryOnlyRows = rows.filter(r => !r.hasDetails);
  const demo = rows.filter(r => r.origin === "Homebrew");
  const categoryNames: Record<string, string> = {
    Armor: "Доспехи", Background: "Предыстории", BestiaryProfile: "Дополнительные блоки бестиария",
    Class: "Классы", Condition: "Состояния", Equipment: "Снаряжение", Feat: "Черты",
    MagicItem: "Магические предметы", Monster: "Монстры", Rule: "Правила", SpeciesRace: "Виды и расы",
    Spell: "Заклинания", Subclass: "Подклассы", Weapon: "Оружие",
  };
  const validation = await auditDatabase();
  const report = { checkedAt: new Date().toISOString(), total: rows.length, groups, flagCounts, referenceReview, editorialReview, validation, rows };
  writeFileSync("data/dndsu/completeness-audit.json", JSON.stringify(report, null, 2) + "\n");
  const quote = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
  writeFileSync("docs/CONTENT_AUDIT.csv", "\uFEFF" + [
    ["ID", "Название", "Редакция", "Категория", "Происхождение", "Статус", "Кратко: символов", "Описание: символов", "Есть подробности", "Замечания", "Именованные варианты для сверки", "Источник"].map(quote).join(";"),
    ...rows.map(r => [r.id,r.name,r.edition,r.category,r.origin,r.status,r.summaryChars,r.descriptionChars,r.hasDetails,r.flags.join(", "),r.unmatchedOptions.join(" · "),r.source].map(quote).join(";")),
  ].join("\n"));
  writeFileSync("docs/CONTENT_AUDIT.md", [
    "# Аудит наполнения справочников", "", `Проверено ${rows.length} записей. ${report.checkedAt}.`, "",
    `Карточек в основном справочнике — ${rows.length - demo.length}. Дополнительно проверено домашних и учебных записей — ${demo.length}. Пустых кратких описаний — ${rows.filter(r => !r.summaryChars).length}, пустых русских текстов — ${rows.filter(r => !r.descriptionChars).length}, карточек без отдельного подробного режима — ${summaryOnlyRows.length}.`, "",
    `На предыдущем этапе каталог вырос с ${change.previousCatalog} до ${change.catalog} карточек. Тогда были добавлены ${change.addedRules} правил и ${change.addedGear} позиций снаряжения, обновлены ${change.modified} существовавших карточек. После этого оставалось проверить ${change.remainingNamed} карточек с именованными свойствами. В текущей базе таких замечаний — ${rows.filter(r => r.unmatchedOptions.length).length}.`, "",
    "Проверка использует данные SQLite и ту же функцию, которая формирует вкладку «Кратко» в приложении. В отчёте отдельно учитываются русский текст SRD, авторские обзоры механик (MetadataOnly), структурированные умения и таблицы. Длина основного текста измеряется отдельно от блоков свойств. Например, у снаряжения цена, масса и вместимость могут быть вынесены в такие блоки.", "",
    "| Категория | Редакция | Всего | Approved | Пустое кратко | Пустой текст | SRD | Обзоры MetadataOnly | Без подробностей | Текст <80 |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...groups.map(g => `| ${categoryNames[g.category] ?? g.category} | ${g.edition.slice(3)} | ${g.total} | ${g.approved} | ${g.emptySummary} | ${g.emptyDescription} | ${g.srd} | ${g.overview} | ${g.summaryOnly} | ${g.shortText} |`), "",
    "## Сверка с источниками", "",
    `В последней редакторской проверке разобраны именованные эффекты из ${editorialReview.namedCards} карточек. В подробном режиме видны ${editorialReview.namedOptions - editorialReview.missing.length} из ${editorialReview.namedOptions} проверенных вариантов. Повторно проверены ${editorialReview.shortReviewed} ранее коротких описаний, расширены ${editorialReview.shortExpanded}. Для ${editorialReview.shortConcise} сохранена краткая формулировка. Среди них простые свойства предметов, определения и черты с числовыми параметрами в отдельных полях.`, "",
    "| Перечень или карточка | Редакция | Сопоставлено | В источнике | Расхождения |",
    "|---|---:|---:|---:|---|",
    ...referenceReview.catalogs.map(c => `| [${c.name}](${c.source}) | ${c.year} | ${c.matched} | ${c.total} | ${c.missing.join(", ") || "0"} |`),
    ...referenceReview.cases.map(c => `| [${c.name}](${c.source}) | ${c.year} | ${c.matched} | ${c.total} | ${[...c.missing, ...c.unexpected].join(", ") || "0"} |`), "",
    "Для перечней проверяются уникальность карточки в нужной редакции и категории, русский текст и краткое описание. Для трёх карточек сопоставляются номер или масть, название результата и признаки его механики в подробном режиме.", "",
    `Проверено дополнительных таблиц — ${referenceReview.tables.filter(t => t.passed).length} из ${referenceReview.tables.length}. Число строк в прошедших проверку таблицах — ${referenceReview.tables.filter(t => t.passed).reduce((n,t)=>n+t.rows,0)}. Проверка сверяет порядок и значения ячеек по сохранённым контрольным суммам. Она охватывает заклинания по уровням и зарядам, варианты предметов, случайные эффекты и рычаги аппаратов. Названия, источники и результаты каждой проверки доступны в JSON.`, "",
    ...referenceReview.tables.filter(t => !t.passed).map(t => `- [${t.name}](${t.source}) — ${t.feature || "таблица в основном тексте"}`),
    "У аппарата Квалиша 2024 урон клешни и урон от глубины сверены с описанием издателя. Клешня наносит 7 (2к6) дробящего урона, давление глубже 900 футов наносит 2к6 в минуту. [Правила предмета у издателя](https://www.dndbeyond.com/magic-items/9228348-apparatus-of-kwalish)", "",
    "Для «Колоды чудес» приведены все 22 сочетания карты и эффекта. В русской таблице семь пометок «только для колоды из 22 карт», при этом заявленный размер малой колоды равен 13. Для короткой колоды карточка описывает опубликованный вариант, в котором мастер заранее выбирает 13 карт. [Таблица ДнД.су](https://dnd.su/items/7248-deck-of-wonder/) · [Пояснение издателя](https://www.dndbeyond.com/posts/1611-deck-of-wonder-the-deck-of-many-things-for-low)", "",
    "## Что ещё требует редакторской сверки", "",
    `Карточек, в которых названию свойства ещё требуется сопоставить пояснение, — ${rows.filter(r => r.unmatchedOptions.length).length}. Автоматическая проверка учитывает заголовки блоков, строки таблиц и явно подписанные пояснения. Результаты доступны по каждой карточке в CSV.`, "",
    ...Object.keys(categoryNames).filter(c => rows.some(r => r.category === c && r.unmatchedOptions.length))
      .map(c => `- ${categoryNames[c]} — ${rows.filter(r => r.category === c && r.unmatchedOptions.length).length}.`), "",
    `Заклинания без класса, подкласса или пояснения о доступе — ${rows.filter(r => r.flags.includes("missing-spell-classes")).length}, из них домашних и учебных — ${demo.filter(r => r.flags.includes("missing-spell-classes")).length}.`, "",
    "Отдельные проверки таблиц и списков не охватывают каждое исключение и каждый пример из опубликованных книг. Короткие описания, заполненность технических полей и результаты сверки показаны раздельно.", "",
    "## Автоматические замечания", "", ...Object.entries(flagCounts).map(([k,v]) => `- ${k}: ${v}`), "",
    `Проверка локализации: ${validation.localization.length} замечаний; терминология и связи ContentRelation: ${validation.issues.length}.`, "",
    "## Как воспроизвести", "", "`pnpm data:completeness:audit` — чтение текущей базы без изменения игровых данных. Полная ведомость каждой карточки: CONTENT_AUDIT.csv; машинный отчёт: data/dndsu/completeness-audit.json. Наличие описаний не заменяет количественную сверку с индексами: см. DNDSU_COVERAGE.md.", "",
    "## Карточки без отдельного подробного режима", "",
    ...(summaryOnlyRows.length
      ? summaryOnlyRows.map(r => `- ${r.name} (${r.edition.slice(3)}, ${r.category}) — ${r.source}`)
      : ["Для каждой проверенной карточки доступен подробный режим."]), "",
  ].join("\n"));
  console.log(JSON.stringify({ total: rows.length, groups, flagCounts, localizationIssues: validation.localization.length }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
