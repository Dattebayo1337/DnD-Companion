"use client";
import { useState } from "react";
import type { CustomSheet as Sheet, CharacterData } from "@/entities/character";
import type { Content } from "@/entities/content";
import { characterSheetTemplate } from "@/domain/paper-sheet";
import {
  exportSheet,
  parseSheetFile,
  MAX_CHARACTER_FILE,
} from "@/domain/character-files";
export function downloadCharacterJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const kinds = {
  text: "Текст",
  number: "Число",
  checkbox: "Отметка",
  resource: "Счётчик",
};
export function PlayableCustomSheet({
  sheet,
  save,
  disabled,
}: {
  sheet: Sheet;
  save: (sheet: Sheet) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(sheet);
  if (!sheet.blocks.length) return null;
  return (
    <fieldset disabled={disabled} className="character-panel">
      <CustomSheet sheet={draft} change={setDraft} />
      <button
        className="button"
        disabled={disabled || JSON.stringify(sheet) === JSON.stringify(draft)}
        onClick={() => save(draft)}
      >
        Сохранить свои поля
      </button>
      <p className="character-help">
        Изменения счётчиков и заметок сохраняются этой кнопкой.
      </p>
    </fieldset>
  );
}
export function CustomSheet({
  sheet,
  change,
  design = false,
  character,
  content = [],
}: {
  sheet: Sheet;
  change?: (sheet: Sheet) => void;
  design?: boolean;
  character?: CharacterData;
  content?: Content[];
}) {
  const [error, setError] = useState("");
  const patch = (id: string, values: Partial<Sheet["blocks"][number]>) =>
    change?.({
      ...sheet,
      blocks: sheet.blocks.map((b) => (b.id === id ? { ...b, ...values } : b)),
    });
  const move = (i: number, delta: number) => {
    const blocks = [...sheet.blocks];
    [blocks[i], blocks[i + delta]] = [blocks[i + delta], blocks[i]];
    change?.({ ...sheet, blocks });
  };
  return (
    <section className="custom-sheet">
      {design ? (
        <>
          <h3>Конструктор своего листа</h3>
          <p className="character-help">
            Создайте свободный лист из готового шаблона: изменяйте названия,
            значения, типы и порядок полей, добавляйте и удаляйте
            характеристики. Свободный лист заполняется вручную и не
            синхронизируется с расчётами D&D.
          </p>
          <div className="character-row">
            {character && (
              <button
                type="button"
                className="button"
                onClick={() => {
                  if (
                    sheet.blocks.length &&
                    !window.confirm(
                      "Заменить свои поля шаблоном текущего персонажа?",
                    )
                  )
                    return;
                  try {
                    change?.(characterSheetTemplate(character, content));
                    setError("");
                  } catch {
                    setError(
                      "Сначала выберите класс и заполните основные параметры персонажа.",
                    );
                  }
                }}
              >
                Шаблон: полный лист D&D
              </button>
            )}
            <button
              type="button"
              className="button"
              onClick={() => {
                if (
                  sheet.blocks.length &&
                  !window.confirm("Очистить все поля своего листа?")
                )
                  return;
                change?.({
                  title: "Мой лист",
                  columns: 2,
                  standalone: true,
                  blocks: [],
                });
              }}
            >
              Пустой шаблон
            </button>
            <label>
              <input
                type="checkbox"
                checked={sheet.standalone ?? false}
                onChange={(e) =>
                  change?.({ ...sheet, standalone: e.target.checked })
                }
              />
              Использовать вместо стандартного листа
            </label>
            <label>
              Название листа
              <input
                maxLength={120}
                value={sheet.title}
                onChange={(e) => change?.({ ...sheet, title: e.target.value })}
              />
            </label>
            <label>
              Колонки
              <select
                value={sheet.columns}
                onChange={(e) =>
                  change?.({
                    ...sheet,
                    columns: Number(e.target.value) as 1 | 2,
                  })
                }
              >
                <option value={1}>Одна</option>
                <option value={2}>Две</option>
              </select>
            </label>
            <button
              type="button"
              className="button"
              onClick={() =>
                downloadCharacterJson(exportSheet(sheet), "sheet-template.json")
              }
            >
              Скачать шаблон
            </button>
            <label className="button">
              Загрузить шаблон
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    if (file.size > MAX_CHARACTER_FILE)
                      throw Error("Шаблон превышает 8 МБ.");
                    const next = parseSheetFile(await file.text());
                    if (
                      sheet.blocks.length &&
                      !window.confirm(
                        "Заменить пользовательские блоки загруженным шаблоном? Основные параметры героя сохранятся.",
                      )
                    )
                      return;
                    change?.(next);
                    setError("");
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "Неверный шаблон",
                    );
                  }
                }}
              />
            </label>
          </div>
          <div className="character-row">
            {Object.entries(kinds).map(([kind, label]) => (
              <button
                type="button"
                className="button"
                disabled={sheet.blocks.length >= 120}
                key={kind}
                onClick={() =>
                  change?.({
                    ...sheet,
                    blocks: [
                      ...sheet.blocks,
                      {
                        id: crypto.randomUUID(),
                        title: label,
                        kind: kind as keyof typeof kinds,
                        text: "",
                        value: 0,
                        max: 3,
                        checked: false,
                        wide: false,
                      },
                    ],
                  })
                }
              >
                ＋ {label}
              </button>
            ))}
          </div>
        </>
      ) : (
        sheet.blocks.length > 0 && <h3>{sheet.title || "Мой лист"}</h3>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {design && !sheet.blocks.length && (
        <p>Добавьте первый блок или загрузите свой шаблон.</p>
      )}
      <div className={`custom-sheet-grid columns-${sheet.columns}`}>
        {sheet.blocks.map((b, i) => (
          <section
            className={`custom-sheet-block ${b.wide ? "wide" : ""}`}
            key={b.id}
          >
            {design ? (
              <div className="custom-sheet-controls">
                <input
                  aria-label="Название блока"
                  maxLength={120}
                  value={b.title}
                  onChange={(e) => patch(b.id, { title: e.target.value })}
                />
                <button
                  type="button"
                  disabled={i === 0}
                  aria-label={`Выше: ${b.title}`}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={i === sheet.blocks.length - 1}
                  aria-label={`Ниже: ${b.title}`}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Удалить: ${b.title}`}
                  onClick={() => {
                    if (window.confirm(`Удалить блок «${b.title}»?`))
                      change?.({
                        ...sheet,
                        blocks: sheet.blocks.filter((x) => x.id !== b.id),
                      });
                  }}
                >
                  ×
                </button>
              </div>
            ) : (
              <h4>{b.title}</h4>
            )}
            {b.kind === "text" &&
              (change ? (
                <textarea
                  aria-label={b.title}
                  maxLength={20000}
                  value={b.text}
                  onChange={(e) => patch(b.id, { text: e.target.value })}
                />
              ) : (
                <p className="custom-sheet-text">{b.text || "—"}</p>
              ))}
            {b.kind === "number" &&
              (change ? (
                <input
                  type="number"
                  aria-label={b.title}
                  min={-1000000}
                  max={1000000}
                  value={b.value}
                  onChange={(e) =>
                    patch(b.id, { value: Number(e.target.value) })
                  }
                />
              ) : (
                <strong>{b.value}</strong>
              ))}
            {b.kind === "checkbox" && (
              <label>
                <input
                  type="checkbox"
                  disabled={!change}
                  checked={b.checked}
                  onChange={(e) => patch(b.id, { checked: e.target.checked })}
                />
                {b.title}
              </label>
            )}
            {b.kind === "resource" && (
              <div className="character-row">
                {change && (
                  <button
                    type="button"
                    className="button"
                    disabled={b.value <= 0}
                    aria-label={`Потратить: ${b.title}`}
                    onClick={() => patch(b.id, { value: b.value - 1 })}
                  >
                    −
                  </button>
                )}
                <strong>
                  {b.value} / {b.max}
                </strong>
                {change && (
                  <button
                    type="button"
                    className="button"
                    disabled={b.value >= b.max}
                    aria-label={`Восстановить: ${b.title}`}
                    onClick={() => patch(b.id, { value: b.value + 1 })}
                  >
                    ＋
                  </button>
                )}
                {design && (
                  <label>
                    Максимум
                    <input
                      type="number"
                      min={0}
                      max={1000000}
                      value={b.max}
                      onChange={(e) => {
                        const max = Math.max(
                          0,
                          Math.min(1000000, Math.trunc(Number(e.target.value))),
                        );
                        patch(b.id, { max, value: Math.min(b.value, max) });
                      }}
                    />
                  </label>
                )}
              </div>
            )}
            {design && (
              <label>
                Раздел
                <input
                  maxLength={60}
                  value={b.group ?? ""}
                  onChange={(e) => patch(b.id, { group: e.target.value })}
                />
                Тип поля
                <select
                  value={b.kind}
                  onChange={(e) =>
                    patch(b.id, {
                      kind: e.target.value as keyof typeof kinds,
                      value:
                        e.target.value === "resource"
                          ? Math.max(0, Math.min(b.max, Math.trunc(b.value)))
                          : b.value,
                    })
                  }
                >
                  {Object.entries(kinds).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                Подпись
                <input
                  maxLength={120}
                  value={b.caption ?? ""}
                  onChange={(e) => patch(b.id, { caption: e.target.value })}
                />
              </label>
            )}
            {design && (
              <label>
                <input
                  type="checkbox"
                  checked={b.wide}
                  onChange={(e) => patch(b.id, { wide: e.target.checked })}
                />
                На всю ширину
              </label>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
