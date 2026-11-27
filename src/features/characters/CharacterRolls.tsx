import { useState } from "react";
import { skillLabels, type CharacterData } from "@/entities/character";
import { abilityLabels } from "@/localization/labels";
import type { deriveCharacter } from "@/domain/rules/character";
import {
  rollKinds,
  rollModifiers,
  type RollKind,
} from "@/domain/rules/character-combat";
import { rollDice } from "@/domain/rules/dice";

export function CharacterRolls({
  character,
  stats,
}: {
  character: CharacterData;
  stats: ReturnType<typeof deriveCharacter>;
}) {
  const [kind, setKind] = useState<RollKind>("skills");
  const [specific, setSpecific] = useState("Perception");
  const [attackBonus, setAttackBonus] = useState("0");
  const [result, setResult] = useState("");
  const { mode, effects } = rollModifiers(character, kind);
  const choices = kind === "skills" ? skillLabels : abilityLabels;
  const modifier =
    kind === "attack"
      ? Number(attackBonus)
      : (kind === "skills" ? stats.skills : stats.saves)[specific];
  const modes = {
    normal: "Обычный бросок",
    advantage: "Преимущество",
    disadvantage: "Помеха",
  };
  const valid =
    Number.isInteger(modifier) &&
    Math.abs(modifier) <= 99999 &&
    (kind !== "attack" || attackBonus.trim() !== "");
  return (
    <section className="tool-panel">
      <h2>Броски персонажа</h2>
      <div className="character-grid">
        <label>
          Тип броска
          <select
            value={kind}
            onChange={(event) => {
              const next = event.target.value as RollKind;
              setKind(next);
              setSpecific(next === "skills" ? "Perception" : "STR");
              setResult("");
            }}
          >
            {Object.entries(rollKinds).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {kind === "attack" ? (
          <label>
            Бонус атаки
            <input
              type="number"
              value={attackBonus}
              onChange={(event) => {
                setAttackBonus(event.target.value);
                setResult("");
              }}
            />
          </label>
        ) : (
          <label>
            Параметр
            <select
              value={specific}
              onChange={(event) => {
                setSpecific(event.target.value);
                setResult("");
              }}
            >
              {Object.entries(choices).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p>
        {modes[mode]}
        {mode === "normal" &&
          effects.length > 0 &&
          " · преимущество и помеха отменяют друг друга"}
      </p>
      {effects.length > 0 && (
        <p>
          {effects
            .map(
              (effect) =>
                `${effect.source} (${effect.target === "advantage" ? "преимущество" : "помеха"})`,
            )
            .join(" · ")}
        </p>
      )}
      <button
        type="button"
        className="button"
        disabled={!valid}
        onClick={() => {
          const rolled = rollDice(
            `1d20${modifier >= 0 ? "+" : ""}${modifier}`,
            mode,
          );
          setResult(
            `${modes[mode]} · к20: ${rolled.rolls.join(", ")} · выбран ${rolled.kept[0]} · модификатор ${modifier >= 0 ? "+" : ""}${modifier} · итог ${rolled.total}`,
          );
        }}
      >
        Бросить к20
      </button>
      {result && <p role="status">{result}</p>}
    </section>
  );
}
