import type { CharacterData } from "@/entities/character";
import type { damages } from "@/entities/content";
import { isEffectActive } from "./character";

export type DamageType = (typeof damages)[number];
export type RollKind = "attack" | "skills" | "saves";

export const rollKinds = {
  attack: "Атака",
  skills: "Проверка навыка",
  saves: "Спасбросок",
};

export function rollModifiers(character: CharacterData, kind: RollKind) {
  const effects = character.effects.filter(
    (effect) =>
      (effect.target === "advantage" || effect.target === "disadvantage") &&
      effect.specific === kind &&
      isEffectActive(character, effect),
  );
  const advantage = effects.some((effect) => effect.target === "advantage");
  const disadvantage = effects.some(
    (effect) => effect.target === "disadvantage",
  );
  const mode: "normal" | "advantage" | "disadvantage" =
    advantage === disadvantage
      ? "normal"
      : advantage
        ? "advantage"
        : "disadvantage";
  return { mode, effects };
}

export function calculateDamage(
  character: CharacterData,
  amount: number,
  type?: DamageType,
) {
  const effects = type
    ? character.effects.filter(
        (effect) =>
          effect.specific === type &&
          (effect.target === "resistance" ||
            effect.target === "immunity" ||
            effect.target === "vulnerability") &&
          isEffectActive(character, effect),
      )
    : [];
  let total = amount;
  if (effects.some((effect) => effect.target === "immunity")) total = 0;
  else {
    if (effects.some((effect) => effect.target === "resistance"))
      total = Math.floor(total / 2);
    if (effects.some((effect) => effect.target === "vulnerability")) total *= 2;
  }
  return { total, effects };
}
