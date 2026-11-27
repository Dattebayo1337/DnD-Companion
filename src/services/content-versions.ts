import { db } from "@/database/client";
import { contentInclude, toContent } from "@/database/repository";
import type { Content } from "@/entities/content";

// PHB 2024 change notes identify these specific Tasha's subclasses.
// https://www.dndbeyond.com/posts/1810-updates-in-the-players-handbook-2024
const verifiedPairs = [
  [
    "dcdd2808-3aca-5cd0-af9b-bfeafc69b318",
    "2240a933-35fa-561f-a34b-d6522ab71fda",
  ], // Circle of Stars
  [
    "9995d0da-fdff-5598-a0ea-53f0a039d0d0",
    "9a84bc4f-1818-57c9-a0e6-2006a7854865",
  ], // Psi Warrior
  [
    "ff66faef-da3d-52f0-a6e7-4ab61f618140",
    "8e1e88ce-2593-5636-ac02-357e04be2ee3",
  ], // Mercy
  [
    "3916e6ae-8efe-5b8c-aa22-38ef7cad975f",
    "4b8c5b91-d35e-535f-afe3-4dcd6c6b9701",
  ], // Soulknife
] as const;

const key = (value: string) =>
  value.trim().toLocaleLowerCase("en").replace(/ё/g, "е");
export function versionCandidate(a: Content, b: Content): boolean {
  if (a.id === b.id || a.edition === b.edition || a.kind !== b.kind)
    return false;
  if (
    a.kind === "Reference" &&
    b.kind === "Reference" &&
    a.reference.category !== b.reference.category
  )
    return false;
  if (a.contentOrigin === "Homebrew" || b.contentOrigin === "Homebrew")
    return false;
  // Exact names only: fuzzy search can confuse unrelated rules and book variants.
  const names = [a.nameOriginal, a.nameRu, ...a.aliases]
    .filter(Boolean)
    .map(key);
  return [b.nameOriginal, b.nameRu, ...b.aliases]
    .filter(Boolean)
    .some((n) => names.includes(key(n)));
}
export async function contentVersions(id: string) {
  const source = await db.content.findFirst({
    where: { id, translationStatus: "Approved" },
    include: contentInclude,
  });
  if (!source) return null;
  const entry = toContent(source);
  const relations = await db.contentRelation.findMany({
    where: {
      OR: [{ sourceId: id }, { targetId: id }],
      relationType: {
        in: ["RevisedVersion", "LegacyVersion", "Equivalent", "Replacement"],
      },
    },
  });
  const linked = new Set(
    relations.map((r) => (r.sourceId === id ? r.targetId : r.sourceId)),
  );
  for (const [legacy, revised] of verifiedPairs) {
    if (id === legacy) linked.add(revised);
    if (id === revised) linked.add(legacy);
  }
  const rows = await db.content.findMany({
    where: {
      translationStatus: "Approved",
      kind: entry.kind,
      editionId: { not: entry.edition },
      ...(entry.kind === "Reference"
        ? { reference: { is: { category: entry.reference.category } } }
        : {}),
    },
    include: contentInclude,
    orderBy: [{ nameRu: "asc" }, { id: "asc" }],
  });
  const parents =
    entry.kind === "Reference" && entry.reference.category === "Subclass"
      ? new Map(
          (
            await db.content.findMany({
              where: {
                reference: { is: { category: "Class" } },
                translationStatus: "Approved",
              },
              include: contentInclude,
            })
          ).map((r) => [r.id, toContent(r)]),
        )
      : null;
  return rows
    .map(toContent)
    .filter((other) => {
      if (linked.has(other.id)) return true;
      if (!versionCandidate(entry, other)) return false;
      if (parents && entry.kind === "Reference" && other.kind === "Reference") {
        const a = parents.get(entry.reference.parentId ?? ""),
          b = parents.get(other.reference.parentId ?? "");
        return Boolean(a && b && versionCandidate(a, b));
      }
      return true;
    })
    .map((other) => ({
      entry: other,
      match: linked.has(other.id) ? ("relation" as const) : ("name" as const),
    }));
}
