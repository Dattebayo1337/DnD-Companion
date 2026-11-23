import {
  customSheetSchema,
  skillLabels,
  type CharacterData,
  type CustomSheet,
} from "@/entities/character";
import type { Content } from "@/entities/content";
import {
  castingAbility,
  classSpellLevel,
  deriveCharacter,
} from "./rules/character";

const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
const abilityLabels = {
  STR: "Сила",
  DEX: "Ловкость",
  CON: "Телосложение",
  INT: "Интеллект",
  WIS: "Мудрость",
  CHA: "Харизма",
};
/** A snapshot template: every field can be edited without changing D&D mechanics. */
export function characterSheetTemplate(
  c: CharacterData,
  content: Content[],
): CustomSheet {
  const stats = deriveCharacter(c);
  const name = (id: string) =>
    content.find((e) => e.id === id)?.nameRu ?? "Не указано";
  const blocks: CustomSheet["blocks"] = [];
  let group = "Персонаж";
  const add = (title: string, value: string | number, wide = false) => {
    blocks.push({
      id: `00000000-0000-4000-8000-${String(blocks.length + 1).padStart(12, "0")}`,
      title,
      kind: typeof value === "number" ? "number" : "text",
      text: typeof value === "string" ? value : "",
      value: typeof value === "number" ? value : 0,
      max: 1,
      checked: false,
      wide,
      group,
    });
  };
  add("Имя персонажа", c.name);
  add(
    "Класс и уровень",
    c.classes
      .map(
        (x) =>
          `${name(x.classId)} ${x.level}${x.subclassId ? ` · ${name(x.subclassId)}` : ""}`,
      )
      .join(" / "),
  );
  add("Вид / раса", name(c.speciesRaceId));
  add("Предыстория", name(c.backgroundId));
  add("Мировоззрение", c.alignment);
  add("Опыт", c.experience);
  group = "Характеристики";
  for (const [key, value] of Object.entries(stats.scores)) {
    add(abilityLabels[key as keyof typeof abilityLabels] ?? key, value);
    blocks[blocks.length - 1].caption =
      `Модификатор ${signed(stats.mods[key as keyof typeof stats.mods])}`;
  }
  group = "Бой";
  add("Бонус мастерства", stats.proficiency);
  add("Класс доспеха", stats.ac);
  add("Инициатива", stats.initiative);
  add("Скорость, футы", stats.speed);
  add("Текущие хиты", c.hp);
  add("Максимум хитов", stats.maxHp);
  add("Временные хиты", c.tempHp);
  add("Пассивная внимательность", stats.passivePerception);
  group = "Спасброски";
  for (const [key, value] of Object.entries(stats.saves))
    add(
      `Спасбросок · ${abilityLabels[key as keyof typeof abilityLabels] ?? key}`,
      value,
    );
  group = "Навыки";
  for (const [key, label] of Object.entries(skillLabels))
    add(label, stats.skills[key]);
  group = "Состояния и ресурсы";
  add(
    "Кости хитов",
    stats.hitDice.map((d) => `${d.remaining} / ${d.max} к${d.die}`).join("; "),
  );
  add(
    "Спасброски от смерти",
    `Успехи: ${c.deathSaves.success} / 3\nПровалы: ${c.deathSaves.failure} / 3`,
  );
  add(
    "Состояния",
    `Истощение: ${c.exhaustion}\n${c.conditionIds.map(name).join(", ")}`,
  );
  add(
    "Ресурсы",
    stats.resources
      .map(
        (r) =>
          `${r.name}: ${Math.max(0, r.max - (c.resourcesUsed[r.key] ?? 0))} / ${r.max}`,
      )
      .join("\n"),
  );
  group = "Снаряжение и владения";
  add(
    "Снаряжение",
    c.inventory
      .map(
        (i) =>
          `${name(i.contentId)} × ${i.quantity}${i.equipped ? " · экипировано" : ""}${i.attuned ? " · настройка" : ""}`,
      )
      .join("\n"),
    true,
  );
  add(
    "Монеты",
    Object.entries(c.currency)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · "),
  );
  add(
    "Языки и владения",
    [c.languages, c.proficiencies].filter(Boolean).join("\n"),
  );
  group = "Заклинания";
  add(
    "Магия",
    c.classes
      .filter(
        (x) =>
          classSpellLevel(x.classId, x.level) > 0 ||
          c.spells.some((s) => s.classId === x.classId),
      )
      .map((x) => {
        const a = castingAbility(x.classId);
        return a
          ? `${name(x.classId)} · Сл ${8 + stats.proficiency + stats.mods[a]} · атака ${signed(stats.proficiency + stats.mods[a])}`
          : "";
      })
      .filter(Boolean)
      .join("\n"),
  );
  add(
    "Ячейки заклинаний",
    stats.slots
      .map((n, i) =>
        n ? `${i + 1} круг: ${Math.max(0, n - c.slotsSpent[i])} / ${n}` : "",
      )
      .filter(Boolean)
      .concat(
        stats.pact.max
          ? [
              `Договор (${stats.pact.level} круг): ${Math.max(0, stats.pact.max - c.pactSpent)} / ${stats.pact.max}`,
            ]
          : [],
      )
      .join("\n"),
  );
  add(
    "Заклинания",
    c.spells
      .map(
        (s) =>
          `${name(s.spellId)} · ${s.status === "Known" ? "известно" : "подготовлено"}`,
      )
      .join("\n"),
    true,
  );
  group = "Умения и история";
  add("Черты и умения", c.featIds.map(name).join("\n"), true);
  add("История и заметки", c.notes, true);
  return customSheetSchema.parse({
    title: c.name,
    columns: 2,
    standalone: true,
    blocks,
  });
}
