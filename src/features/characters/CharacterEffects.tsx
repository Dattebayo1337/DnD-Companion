import { useState } from "react";
import { skillLabels, type CharacterData } from "@/entities/character";
import { rollKinds } from "@/domain/rules/character-combat";
import { abilityLabels, damageLabels } from "@/localization/labels";
import {
  advanceEffectRound,
  isEffectActive,
  resources,
} from "@/domain/rules/character";
import type { Content } from "@/entities/content";

type Effect = CharacterData["effects"][number];
const targets = {
  ac: "Класс доспеха",
  speed: "Скорость, футы",
  speedOverride: "Фиксированная скорость, футы",
  resource: "Максимум ресурса",
  saves: "Все спасброски",
  skills: "Все проверки навыков",
  advantage: "Преимущество",
  disadvantage: "Помеха",
  resistance: "Сопротивление",
  immunity: "Иммунитет",
  vulnerability: "Уязвимость",
};
const durations = {
  manual: "До снятия вручную",
  rounds: "На несколько раундов",
  rest: "До отдыха",
  concentration: "До конца текущей концентрации",
  equipment: "Пока предмет экипирован",
  condition: "Пока действует состояние",
};

export function CharacterEffects({
  character,
  entries,
  save,
}: {
  character: CharacterData;
  entries: Content[];
  save: (effects: Effect[]) => void;
}) {
  const { effects, concentrationId } = character;
  const [source, setSource] = useState("");
  const [target, setTarget] = useState<Effect["target"]>("ac");
  const [specific, setSpecific] = useState("");
  const choiceSets: Partial<Record<Effect["target"], Record<string, string>>> =
    {
      saves: abilityLabels,
      skills: skillLabels,
      advantage: rollKinds,
      disadvantage: rollKinds,
      resistance: damageLabels,
      immunity: damageLabels,
      vulnerability: damageLabels,
      resource: Object.fromEntries(
        resources(character).map((resource) => [resource.key, resource.name]),
      ),
    };
  const choices = choiceSets[target] ?? {};
  const numeric =
    target === "ac" ||
    target === "speed" ||
    target === "speedOverride" ||
    target === "resource" ||
    target === "skills" ||
    target === "saves";
  const [bonus, setBonus] = useState("5");
  const [kind, setKind] = useState<Effect["duration"]["kind"]>("rounds");
  const [rounds, setRounds] = useState("1");
  const [itemId, setItemId] = useState("");
  const [conditionId, setConditionId] = useState("");
  const item = character.inventory.find((item) => item.id === itemId);
  const conditions = entries.filter(
    (entry) =>
      entry.kind === "Reference" && entry.reference.category === "Condition",
  );
  const itemName = (id: string) =>
    name(character.inventory.find((item) => item.id === id)?.contentId ?? "");
  const name = (id: string) =>
    entries.find((entry) => entry.id === id)?.nameRu ?? "Запись недоступна";
  const linkedName =
    kind === "equipment" && item
      ? name(item.contentId)
      : kind === "condition" &&
          conditions.some((entry) => entry.id === conditionId)
        ? name(conditionId)
        : "";
  const effectSource = source.trim() || linkedName.slice(0, 120);
  const amount = numeric ? Number(bonus) : 1;
  const remaining = Number(rounds);
  const valid =
    effectSource &&
    ((numeric && target !== "resource") || Object.hasOwn(choices, specific)) &&
    Number.isInteger(amount) &&
    (target === "speedOverride" ? amount >= 0 : amount !== 0) &&
    (!numeric || bonus.trim() !== "") &&
    Math.abs(amount) <= 100 &&
    (kind !== "rounds" ||
      (Number.isInteger(remaining) && remaining >= 1 && remaining <= 100)) &&
    (kind !== "concentration" || concentrationId) &&
    (kind !== "equipment" || item) &&
    (kind !== "condition" ||
      conditions.some((entry) => entry.id === conditionId)) &&
    effects.length < 30;
  const chip = (effect: Effect) =>
    effect.duration.kind === "rounds"
      ? `Раундов осталось: ${effect.duration.remaining}`
      : durations[effect.duration.kind];

  return (
    <section className="tool-panel">
      <h2>Эффекты персонажа</h2>
      <p>
        Поправки сразу меняют расчёты листа. Нажмите «Следующий раунд» в начале
        следующего раунда персонажа.
      </p>
      {effects.length === 0 && <p>Нет сохранённых эффектов.</p>}
      {effects.map((effect) => (
        <div key={effect.id} className="character-row">
          <strong>{effect.source}</strong>
          <span>
            {targets[effect.target]}
            {effect.specific &&
              ` · ${choiceSets[effect.target]?.[effect.specific]}`}
            {[
              "ac",
              "speed",
              "speedOverride",
              "resource",
              "skills",
              "saves",
            ].includes(effect.target) &&
              ` ${effect.bonus > 0 ? "+" : ""}${effect.bonus}`}{" "}
            · {chip(effect)}
            {effect.duration.kind === "equipment" &&
              ` · ${itemName(effect.duration.itemId)}`}
            {effect.duration.kind === "condition" &&
              ` · ${name(effect.duration.conditionId)}`}
            {!isEffectActive(character, effect) && " · Неактивен"}
          </span>
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              save(effects.filter((item) => item.id !== effect.id))
            }
          >
            Снять
          </button>
        </div>
      ))}
      {effects.some((effect) => effect.duration.kind === "rounds") && (
        <button
          type="button"
          className="button secondary"
          onClick={() => save(advanceEffectRound(effects))}
        >
          Следующий раунд
        </button>
      )}
      <div className="character-grid">
        <label>
          Источник
          <input
            value={source}
            maxLength={120}
            placeholder="Например, Щит"
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label>
          Параметр
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as Effect["target"]);
              setSpecific("");
            }}
          >
            {Object.entries(targets).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {Object.keys(choices).length > 0 && (
          <label>
            Область действия
            <select
              value={specific}
              onChange={(event) => setSpecific(event.target.value)}
            >
              <option value="">
                {target === "saves" || target === "skills" ? "Все" : "Выберите"}
              </option>
              {Object.entries(choices).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {numeric && (
          <label>
            {target === "speedOverride" ? "Скорость в футах" : "Поправка"}
            <input
              type="number"
              min={target === "speedOverride" ? 0 : -100}
              max={100}
              value={bonus}
              onChange={(e) => setBonus(e.target.value)}
            />
          </label>
        )}
        <label>
          Длительность
          <select
            value={kind}
            onChange={(e) =>
              setKind(e.target.value as Effect["duration"]["kind"])
            }
          >
            {Object.entries(durations).map(([key, label]) => (
              <option
                key={key}
                value={key}
                disabled={key === "concentration" && !concentrationId}
              >
                {label}
              </option>
            ))}
          </select>
        </label>
        {kind === "rounds" && (
          <label>
            Раунды
            <input
              type="number"
              min={1}
              max={100}
              value={rounds}
              onChange={(e) => setRounds(e.target.value)}
            />
          </label>
        )}
        {kind === "equipment" && (
          <label>
            Предмет из инвентаря
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Выберите предмет</option>
              {character.inventory.map((item) => (
                <option value={item.id} key={item.id}>
                  {name(item.contentId)} ·{" "}
                  {item.equipped ? "экипирован" : "снят"}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "condition" && (
          <label>
            Состояние
            <select
              value={conditionId}
              onChange={(e) => setConditionId(e.target.value)}
            >
              <option value="">Выберите состояние</option>
              {conditions.map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {entry.nameRu}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <button
        type="button"
        className="button primary"
        disabled={!valid}
        onClick={() => {
          if (!valid || (kind === "concentration" && !concentrationId)) return;
          let duration: Effect["duration"];
          if (kind === "rounds") duration = { kind, remaining };
          else if (kind === "concentration")
            duration = { kind, spellId: concentrationId! };
          else if (kind === "equipment") duration = { kind, itemId };
          else if (kind === "condition") duration = { kind, conditionId };
          else duration = { kind };
          const other = effects.filter(
            (effect) =>
              effect.target !== target ||
              effect.specific !== (specific || undefined) ||
              effect.source.toLowerCase() !== effectSource.toLowerCase(),
          );
          save([
            ...other,
            {
              id: crypto.randomUUID(),
              source: effectSource,
              target,
              specific: specific || undefined,
              bonus: amount,
              duration,
            },
          ]);
        }}
      >
        Применить эффект
      </button>
      {effects.length >= 30 && <p>Достигнут предел в 30 эффектов.</p>}
    </section>
  );
}
