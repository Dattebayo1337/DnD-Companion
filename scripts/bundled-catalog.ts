import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  contentSchema,
  type Content,
  type Monster,
  type ReferenceEntry,
} from "../src/entities/content";
import { importDataset, parseDataset } from "../src/imports/pipeline";

type Reference = ReferenceEntry["reference"];
type Revision = {
  from: number;
  fingerprint: string;
  aliases?: string[];
  classes?: string[];
  descriptionRu?: string;
  properties?: Reference["properties"];
  features?: Reference["features"];
  progression?: Reference["progression"];
  monsterActions?: Monster["monster"]["actions"];
};
const revisions = [
  ["tabletop-updates", "2026-11-27T06:00:00.000Z"],
  ["editorial-updates", "2026-11-27T09:58:00.000Z"],
  ["tabletop-summaries", "2026-11-27T10:03:00.000Z"],
].map(([file, stamp]) => ({
  stamp,
  entries: JSON.parse(readFileSync(`data/dndsu/${file}.json`, "utf8")) as Record<string, Revision>,
}));
const release = JSON.parse(readFileSync("data/dndsu/release-baselines.json", "utf8")) as {
  fingerprints: Record<string, string>;
};

function fingerprint(entry: Content) {
  return createHash("sha256")
    .update(JSON.stringify(contentSchema.parse(entry)))
    .digest("hex");
}

function applyRevision(entry: Content, update: Revision, stamp: string): Content {
  if (
    entry.contentVersion !== update.from ||
    fingerprint(entry) !== update.fingerprint
  ) {
    throw new Error(
      "Изменилась исходная карточка. Требуется сверка дополнения: " + entry.id,
    );
  }
  const next = {
    ...entry,
    contentVersion: entry.contentVersion + 1,
    updatedAt: stamp,
  };
  if (update.aliases) next.aliases = update.aliases;
  if (update.descriptionRu) next.descriptionRu = update.descriptionRu;
  if (next.kind === "Monster" && update.monsterActions)
    next.monster = { ...next.monster, actions: update.monsterActions };
  if (next.kind === "Spell" && update.classes)
    next.spell = { ...next.spell, classes: update.classes };
  if (next.kind === "Reference") {
    next.reference = { ...next.reference };
    if (update.features) next.reference.features = update.features;
    if (update.properties) next.reference.properties = update.properties;
    if (update.progression) next.reference.progression = update.progression;
  }
  return contentSchema.parse(next);
}

function bundledVersions(entry: Content) {
  const versions = [entry];
  for (const { stamp, entries } of revisions) {
    if (entries[entry.id])
      versions.push(applyRevision(versions.at(-1)!, entries[entry.id], stamp));
  }
  return versions;
}

export function reviewedEntry(entry: Content): Content {
  return bundledVersions(entry).at(-1)!;
}

// A database may hold any previously shipped version of a bundled official card.
export async function importBundledFile(path: string) {
  const data = parseDataset(readFileSync(path, "utf8"));
  const baselines = new Map<string, Content[]>();
  data.entries = data.entries.map((entry) => {
    const versions = bundledVersions(entry);
    if (versions.length > 1 || release.fingerprints[entry.id]) baselines.set(entry.id, versions);
    return versions.at(-1)!;
  });
  return importDataset(data, (current, next) => {
    const versions = baselines.get(current.id);
    return (
      !!versions &&
      isDeepStrictEqual(next, versions.at(-1)) &&
      (versions.slice(0, -1).some(previous => isDeepStrictEqual(current, previous)) ||
        release.fingerprints[current.id] === fingerprint(current))
    );
  });
}

export const libraryFiles = () =>
  readdirSync("data/dndsu/library")
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => "data/dndsu/library/" + name);
