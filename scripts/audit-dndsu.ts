import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { db } from "../src/database/client";
import { contentInclude, toContent } from "../src/database/repository";
import { validateRussian } from "../src/localization/validate";
type Item = {
  nameRu: string;
  nameOriginal: string;
  url: string;
  source: string;
  parent?: string;
  parentUrl?: string;
};
type Index = { edition: string; category: string; url: string; items: Item[] };
const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const attr = (s: string, key: string) =>
  s.match(new RegExp(`${key}=["']([^]*?)["'](?=\\s|>|$)`))?.[1] ?? "";
export function parseIndex(html: string, url: string): Item[] {
  const list = html.match(/window\.LIST\s*=\s*({[^]*?});\s*<\/script>/);
  if (list) {
    const data = JSON.parse(list[1]);
    return data.cards.map(
      (c: {
        title: string;
        title_en: string;
        link: string;
        filter_source?: unknown[];
      }) => ({
        nameRu: decode(c.title),
        nameOriginal: decode(c.title_en ?? ""),
        url: new URL(c.link, url).href,
        source: (c.filter_source ?? []).join(","),
      }),
    );
  }
  const section = new URL(url).pathname;
  const found = new Map<string, Item>();
  for (const m of html.matchAll(
    /<a\s+([^>]*href=["'][^"']+["'][^>]*)>([^]*?)<\/a>/g,
  )) {
    const href = attr(m[1], "href");
    if (
      !(
        href.startsWith(section) ||
        (section === "/race/" && href.startsWith("/multiverse/race/"))
      ) ||
      href === section ||
      href.includes("#") ||
      href.includes("?")
    )
      continue;
    const title =
      m[2].match(/class=["']article_title["'][^>]*>([^]*?)<\/span>/)?.[1] ??
      m[2].match(/class=["']list-item-title["'][^>]*>([^]*?)<\/div>/)?.[1];
    if (!title) continue;
    const before = html.slice(Math.max(0, m.index! - 550), m.index);
    const searches = [
      ...before.matchAll(/data-search=["']([^]*?)["']\s+data-id/g),
    ];
    const search = searches.at(-1)?.[1]?.split(",") ?? [];
    const en =
      m[2].match(/class=["']article_title_en["'][^>]*>([^]*?)<\/span>/)?.[1] ??
      search.find((v) => /[a-z]{2}/i.test(v)) ??
      "";
    const source =
      m[2].match(/class=["']article_source["'][^>]*>([^]*?)<\/span>/)?.[1] ??
      attr(before.slice(before.lastIndexOf("<div")), "data-letter");
    const absolute = new URL(href, url).href;
    found.set(absolute, {
      nameRu: decode(title),
      nameOriginal: decode(en),
      url: absolute,
      source: decode(source),
    });
  }
  return [...found.values()];
}
const path = "data/dndsu/catalog-index.json";
async function main() {
  let snapshot: { checkedAt: string; indexes: Index[] };
  if (process.argv.includes("--refresh")) {
    const indexes: Index[] = [];
    for (const host of ["dnd.su", "next.dnd.su"]) {
      const sections: Record<string, string> = {
        class: "Class",
        [host === "dnd.su" ? "race" : "species"]: "SpeciesRace",
        backgrounds: "Background",
        feats: "Feat",
        spells: "Spell",
        bestiary: "Monster",
        items: "MagicItem",
        ...(host === "next.dnd.su" ? { equipment: "Equipment" } : {}),
      };
      for (const [section, category] of Object.entries(sections)) {
        const url = `https://${host}/${section}/`;
        const response = await fetch(url, {
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        let html = await response.text();
        const piece = html.match(/xhttp.open\('GET', '(\/piece\/[^']+)'/);
        if (piece) {
          const r = await fetch(new URL(piece[1], url), {
            signal: AbortSignal.timeout(30000),
          });
          if (!r.ok) throw new Error(`Не загружен индекс ${url}`);
          html = await r.text();
        }
        const items = parseIndex(html, url);
        if (!items.length)
          throw new Error(`Не распознан каталог ${url}; отчёт не перезаписан.`);
        indexes.push({
          edition: host === "dnd.su" ? "5e_2014" : "5e_2024",
          category,
          url,
          items,
        });
        console.log(`${host} ${section}: ${items.length}`);
      }
    }
    // Subclasses require a reviewed traversal of class pages, not the class listing.
    const subclassSnapshot = JSON.parse(
      readFileSync("data/dndsu/subclass-index.json", "utf8"),
    );
    indexes.push(...subclassSnapshot.indexes);
    snapshot = { checkedAt: new Date().toISOString(), indexes };
    mkdirSync("data/dndsu", { recursive: true });
    writeFileSync(path, JSON.stringify(snapshot, null, 2));
  } else snapshot = JSON.parse(readFileSync(path, "utf8"));
  const entries = (
    await db.content.findMany({
      where: { contentOrigin: { not: "Homebrew" } },
      include: contentInclude,
    })
  ).map(toContent);
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "");
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const link = (url: string) => url.replace(/\/$/, "");
  const reports = snapshot.indexes.map((index) => {
    const local = entries.filter(
      (e) =>
        e.edition === index.edition &&
        (index.category === "Equipment"
          ? e.kind === "Reference" &&
            ["Equipment", "Weapon", "Armor"].includes(e.reference.category)
          : index.category === "Monster"
            ? e.kind === "Monster" || (e.kind === "Reference" && e.reference.category === "BestiaryProfile")
          : e.kind === "Reference"
            ? e.reference.category === index.category
            : e.kind === index.category),
    );
    const names = new Map(
      local.flatMap((e) =>
        [e.nameRu, e.nameOriginal, ...e.aliases]
          .filter(Boolean)
          .map((n) => [norm(n), e.id] as const),
      ),
    );
    const links = new Set(local.map(e => link(e.source)));
    const matched = index.items.filter(i => {
      if (index.category === "Subclass" && i.parent) {
        return local.some(e => {
          if (e.kind !== "Reference") return false;
          const parent = byId.get(e.reference.parentId ?? "");
          return parent?.kind === "Reference" && parent.reference.category === "Class" &&
            parent.edition === index.edition && [parent.nameOriginal, parent.nameRu, ...parent.aliases].some(n => norm(n) === norm(i.parent!)) &&
            (link(e.source) === link(i.url) || [e.nameRu, e.nameOriginal, ...e.aliases].some(name => norm(name) === norm(i.nameRu) ||
              Boolean(i.nameOriginal && norm(name) === norm(i.nameOriginal))));
        });
      }
      if (links.has(link(i.url))) return true;
      if (index.category === "SpeciesRace" && i.url.includes("/multiverse/")) return false;
      if (i.url.includes("/class/wow/")) return false;
      return names.has(norm(i.nameRu)) || Boolean(i.nameOriginal && names.has(norm(i.nameOriginal)));
    });
    const unmatched = index.items.filter((i) => !matched.includes(i));
    return {
      edition: index.edition,
      category: index.category,
      url: index.url,
      local: local.length,
      indexed: index.items.length,
      matchedByName: matched.length,
      unmatched: unmatched.length,
      missingCandidates: unmatched,
    };
  });
  const quality = validateRussian(entries);
  const report = {
    checkedAt: snapshot.checkedAt,
    generatedAt: new Date().toISOString(),
    method:
      "Сопоставление внутри редакции по ссылке, названию или псевдониму. Для подклассов учитывается родительский класс. В бестиарий включены отдельные справочные блоки для спутников и объектов без фиксированной сложности.",
    localCount: entries.length,
    localizationIssues: quality,
    coverage: reports,
    notComparable: [
      "Вложенные варианты внутри статей и пользовательские материалы вне сохранённых индексов учитываются отдельно. Совпадение карточки подтверждает наличие записи. Полнота правил требует отдельной сверки.",
      "Состояния 2014, глоссарий 2024, таблицы инвентаря 2014 и заголовки главы о бое сверяются отдельно в [аудите наполнения](CONTENT_AUDIT.md).",
    ],
  };
  writeFileSync(
    "data/dndsu/coverage-report.json",
    JSON.stringify(report, null, 2),
  );
  const labels: Record<string, string> = {
    Class: "Классы",
    Subclass: "Подклассы",
    SpeciesRace: "Расы / виды",
    Background: "Предыстории",
    Feat: "Черты",
    Spell: "Заклинания",
    Monster: "Бестиарий",
    MagicItem: "Магические предметы",
    Equipment: "Оружие, доспехи, снаряжение",
  };
  const lines = [
    "# Проверка полноты по ДнД.су",
    `Дата последнего обновления сохранённой подборки — ${snapshot.checkedAt.slice(0, 10)}.`,
    report.method,
    `Позиций в сохранённых индексах: ${reports.reduce((n,r)=>n+r.indexed,0)}. Требуют сопоставления: ${reports.reduce((n,r)=>n+r.unmatched,0)}.`,
    "| Редакция | Категория | В базе | В индексе сайта | Сопоставлено | Требуют сверки |",
    "|---|---|---:|---:|---:|---:|",
    ...reports.map(
      (r) =>
        `| ${r.edition.slice(3)} | [${labels[r.category]}](${r.url}) | ${r.local} | ${r.indexed} | ${r.matchedByName} | ${r.unmatched} |`,
    ),
    "",
    "## Что означают результаты",
    "Сравниваются основные записи без демонстрационного Homebrew. Количество в базе и число совпадений могут различаться: один локальный объект может соответствовать нескольким вариантам на сайте. На next.dnd.su есть материалы совместимости и сторонние книги; это не перечень только PHB 2024. Полные списки кандидатов со ссылками находятся в data/dndsu/coverage-report.json.",
    ...report.notComparable.map((s) => `- ${s}`),
    `- Проверка обязательной русской локализации: ${quality.length} замечаний.`,
    "",
    "## Воспроизведение",
    "`pnpm data:dndsu:audit` пересчитывает отчёт по сохранённому индексу и текущей базе. `pnpm data:dndsu:audit --refresh` загружает открытые каталоги заново. Команда не импортирует тексты карточек и не меняет игровые записи.",
    "",
    "## Полнота карточек",
    "Длина текста, доступность вкладки с подробностями, наличие умений и уровней проверяются в CONTENT_AUDIT.md. Для записей с авторским обзором карточка также содержит ссылку на источник.",
  ];
  writeFileSync(
    "docs/DNDSU_COVERAGE.md",
    lines.join("\n\n").replace(/(?<=\|)\n\n(?=\|)/g, "\n"),
  );
  console.log(
    reports.map((r) => ({
      edition: r.edition,
      category: r.category,
      local: r.local,
      indexed: r.indexed,
      unmatched: r.unmatched,
    })),
  );
}
if (process.argv[1]?.includes("audit-dndsu"))
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
