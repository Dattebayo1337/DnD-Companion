import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Content } from "../src/entities/content";
import { readingContent } from "../src/domain/reading-content";

type Catalog = { name: string; year: number; source: string; items: [string, string, string][] };
type ChoiceList = { id: string; year: number; name: string; source: string; feature: string; rows: string[][] };
type TableCheck = { id: string; feature: string; source: string; count: number; digest: string };
type ReviewedChange = { date: string; previousCatalog: number; catalog: number; modified: number; addedRules: number;
  addedGear: number; previousNamed: number; remainingNamed: number };
const checklist: { catalogs: Catalog[]; cases: ChoiceList[]; tables: TableCheck[]; change: ReviewedChange } = JSON.parse(
  readFileSync("data/dndsu/reference-checkpoints.json", "utf8"),
);
const editorial: {
  named: { id: string; options: string[] }[];
  short: { id: string; result: "expanded" | "concise" }[];
} = JSON.parse(readFileSync("data/dndsu/editorial-review.json", "utf8"));

export function checkEditorialCoverage(entries: Content[]) {
  const byId = new Map(entries.map(e => [e.id, e]));
  const missing: { id: string; option: string }[] = [];
  for (const { id, options } of editorial.named) {
    const entry = byId.get(id);
    const visible = new Set(entry && readingContent(entry).features
      .filter(f => f.descriptionRu.trim()).map(f => f.nameRu));
    for (const option of options) {
      if (!visible.has(option)) missing.push({ id, option });
    }
  }
  return {
    namedCards: editorial.named.length,
    namedOptions: editorial.named.reduce((count, item) => count + item.options.length, 0),
    missing,
    shortReviewed: editorial.short.length,
    shortExpanded: editorial.short.filter(r => r.result === "expanded").length,
    shortConcise: editorial.short.filter(r => r.result === "concise").length,
    missingShortCards: editorial.short.filter(r => !byId.has(r.id)).map(r => r.id),
  };
}

function markdownTables(text: string): string[][][] {
  const groups = text.replace(/\r/g, "").match(/(?:^[ \t]*\|[^\n]+\|[ \t]*(?:\n|$))+/gm) ?? [];
  return groups.map(group => group.trim().split("\n").map(line =>
    line.trim().slice(1, -1).split("|").map(cell => cell.trim()),
  ).slice(2));
}

function sameText(s: string) {
  return s.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

export function checkReferenceCoverage(entries: Content[]) {
  const byId = new Map(entries.map(e => [e.id, e]));
  const byTitle = new Map<string, Content[]>();
  for (const e of entries) {
    if (e.kind !== "Reference" || e.contentOrigin === "Homebrew") continue;
    const key = [e.edition, e.reference.category, e.nameOriginal].join("/");
    byTitle.set(key, [...(byTitle.get(key) ?? []), e]);
  }
  const catalogs = checklist.catalogs.map(group => {
    const missing: string[] = [];
    const used = new Set<string>();
    for (const [sourceTitle, category, original] of group.items) {
      const matches = byTitle.get(["5e_" + group.year, category, original].join("/")) ?? [];
      const e = matches[0];
      if (matches.length !== 1 || used.has(e.id) || !e.descriptionRu.trim() || !readingContent(e).summary.text.trim()) {
        missing.push(sourceTitle);
      } else used.add(e.id);
    }
    return { name: group.name, year: group.year, source: group.source, total: group.items.length, matched: used.size, missing };
  });
  const cases = checklist.cases.map(expect => {
    const e = byId.get(expect.id);
    const features = e?.kind === "Reference" && e.edition === "5e_" + expect.year ? readingContent(e).features : [];
    const tables = features.filter(f => f.nameRu === expect.feature).flatMap(f => markdownTables(f.descriptionRu));
    const rows = expect.feature ? tables.flat() : features.map(f => ["", f.nameRu, f.descriptionRu]);
    const missing = expect.rows.filter(([key, name, ...markers]) => {
      const found = rows.filter(r => r[0] === key && r[1] === name);
      return found.length !== 1 || !markers.every(s => sameText(found[0][2] ?? "").includes(sameText(s)));
    }).map(r => r[1]);
    const unexpected = rows.filter(r => !expect.rows.some(ex => ex[0] === r[0] && ex[1] === r[1])).map(r => r[1]);
    return { id: expect.id, name: expect.name, year: expect.year, source: expect.source, total: expect.rows.length,
      matched: expect.rows.length - missing.length, missing, unexpected };
  });
  const tables = checklist.tables.map(test => {
    const e = byId.get(test.id);
    let blocks: string[] = [];
    if (e && !test.feature) blocks = [e.descriptionRu];
    else if (e?.kind === "Reference") blocks = readingContent(e).features.filter(f => f.nameRu === test.feature).map(f => f.descriptionRu);
    else if (e?.kind === "Spell") {
      const heading = "### " + test.feature;
      blocks = e.descriptionRu.split(/(?=^### )/m).filter(block => block.split("\n")[0] === heading);
    }
    const candidates = blocks.flatMap(markdownTables);
    const found = candidates.filter(rows => rows.length === test.count &&
      createHash("sha256").update(JSON.stringify(rows)).digest("hex") === test.digest);
    return { id: test.id, name: e?.nameRu ?? test.id, feature: test.feature, source: test.source, rows: test.count, passed: found.length === 1 };
  });
  return { catalogs, cases, tables, change: checklist.change };
}

// Flags a list of named benefits for editorial review when names lack a corresponding rule in the card.
export function unresolvedNamedOptions(entry: Content): string[] {
  if (entry.kind !== "Reference" || entry.contentOrigin !== "MetadataOnly") return [];
  const options = entry.reference.properties.filter(p =>
    ["Преимущества", "Именованные свойства", "Особенности предыстории"].includes(p.nameRu) && p.valueRu.includes(" · "),
  ).flatMap(p => p.valueRu.split(" · ").map(s => s.trim()));
  if (!options.length) return [];
  const blocks = [entry.descriptionRu, ...entry.reference.features.map(f => f.descriptionRu)];
  const names = entry.reference.features.filter(f => f.descriptionRu.trim()).map(f => sameText(f.nameRu));
  const tableRows = blocks.flatMap(markdownTables).flat();
  const paragraphs = blocks.flatMap(b => b.split(/\n+/)).map(s => sameText(s.replace(/[*_#]/g, "")));
  return [...new Set(options)].filter(option => {
    const term = sameText(option);
    if (names.some(name => name === term || name.endsWith(" · " + term))) return false;
    if (tableRows.some(row => row.some((cell, i) => sameText(cell) === term && row.slice(i + 1).some(c => c.trim())))) return false;
    return !paragraphs.some(line => [". ", " — ", ": ", " даёт ", " позволяет "].some(sep => {
      const start = (". " + line).indexOf(". " + term + sep);
      return start >= 0 && line.length - start >= term.length + 16;
    }));
  });
}
