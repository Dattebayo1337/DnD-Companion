import type { CharacterRecord } from "@/entities/character";
import { campaignFields, type CampaignRecord } from "@/entities/campaign";
import type { Content } from "@/entities/content";
import { characterSheetTemplate } from "./paper-sheet";

export type OfflineSnapshot = {
  id: string;
  kind: "character" | "campaign";
  name: string;
  edition: CharacterRecord["data"]["edition"] | "Mixed";
  version: number;
  savedAt: string;
  notes?: string;
  blocks: { title: string; text: string }[];
};

export function characterSnapshot(
  record: CharacterRecord,
  entries: Content[],
): OfflineSnapshot {
  const character = record.data;
  const custom = character.customSheet;
  const blocks = custom.standalone
    ? custom.blocks
    : [
        ...characterSheetTemplate(
          { ...character, notes: "" },
          entries,
        ).blocks.filter((block) => block.title !== "История и заметки"),
        ...custom.blocks,
      ];
  return {
    id: "character:" + record.id,
    kind: "character",
    name: custom.standalone ? custom.title || character.name : character.name,
    version: record.version,
    edition: character.edition,
    savedAt: new Date().toISOString(),
    notes: character.notes,
    blocks: blocks.map((block) => {
      const value = {
        text: block.text,
        number: String(block.value),
        resource: `${block.value} / ${block.max}`,
        checkbox: block.checked ? "Да" : "Нет",
      }[block.kind];
      return {
        title: [block.group, block.title].filter(Boolean).join(" · "),
        text: [value, block.caption].filter(Boolean).join("\n") || "—",
      };
    }),
  };
}

export function campaignSnapshot(record: CampaignRecord): OfflineSnapshot {
  const data = record.data;
  return {
    id: "campaign:" + record.id,
    kind: "campaign",
    name: data.name,
    edition: data.editionMode,
    version: record.version,
    savedAt: new Date().toISOString(),
    notes: data.notes,
    blocks: [
      { title: "Описание", text: data.description },
      { title: "Календарь", text: data.calendar },

      ...data.entries
        .filter((entry) => entry.kind === "session" && !entry.archived)
        .map((entry) => ({
          title: "Сессия · " + entry.name,
          text:
            [
              ...campaignFields.session.flatMap(({ key, label }) =>
                entry.fields[key]?.trim()
                  ? [label + "\n" + entry.fields[key]]
                  : [],
              ),
              entry.notes,
            ]
              .filter(Boolean)
              .join("\n\n") || "Без заметок.",
        })),
    ].filter((block) => block.text.trim()),
  };
}
