"use client";
import { useState } from "react";
import {
  MAX_CHARACTER_FILE,
  parseCharacterFile,
} from "@/domain/character-files";
import type { CharacterData } from "@/entities/character";
import type { Content, EditionId } from "@/entities/content";
import { deriveCharacter } from "@/domain/rules/character";
export function CharacterImport({
  entries,
  edition,
  accept,
  close,
}: {
  entries: Content[];
  edition: EditionId;
  accept: (data: CharacterData, warnings: string[]) => void;
  close: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const [reading, setReading] = useState(false);
  const [showMappings, setShowMappings] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ReturnType<
    typeof parseCharacterFile
  > | null>(null);
  function check(source: string, mappings: Record<string, string>) {
    try {
      setPreview(parseCharacterFile(source, entries, edition, mappings));
      setError("");
    } catch (err) {
      setPreview(null);
      setError(
        err instanceof Error ? err.message : "Не удалось прочитать файл",
      );
      setShowMappings(true);
    }
  }
  return (
    <section className="character-panel" aria-label="Импорт персонажа">
      <div className="character-row">
        <h2>Загрузить лист JSON</h2>
        <button className="button" onClick={close}>
          Закрыть импорт
        </button>
      </div>
      <p>
        Форматы D&D Companion и Long Story Short v2, до 8 МБ (LSS — до 1 МБ).
        Импорт создаёт нового персонажа в вашем аккаунте и не заменяет
        существующих.
      </p>
      <label>
        Файл персонажа
        <input
          type="file"
          accept=".json,application/json"
          disabled={reading}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setPreview(null);
            setText("");
            setOverrides({});
            setFilename(f.name);
            setError("");
            setReading(true);
            try {
              if (f.size > MAX_CHARACTER_FILE)
                throw Error("Файл превышает 8 МБ.");
              const source = await f.text();
              setText(source);
              check(source, {});
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setReading(false);
            }
          }}
        />
      </label>
      <p role="status" aria-live="polite">
        {reading
          ? "Читаем файл…"
          : filename
            ? `Выбран файл: ${filename}`
            : "Выберите JSON — проверка начнётся автоматически."}
      </p>
      <details
        open={showMappings}
        onToggle={(e) => setShowMappings(e.currentTarget.open)}
      >
        <summary>Соответствия LSS: если название не найдено</summary>
        <div className="character-grid">
          {[
            ["classId", "Class", "Класс"],
            ["speciesRaceId", "SpeciesRace", "Вид / раса"],
            ["backgroundId", "Background", "Предыстория"],
          ].map(([key, category, label]) => (
            <label key={key}>
              {label}
              <select
                value={overrides[key] ?? ""}
                onChange={(e) => {
                  const next = { ...overrides, [key]: e.target.value };
                  setOverrides(next);
                  if (text) check(text, next);
                }}
              >
                <option value="">Определить по имени</option>
                {entries
                  .filter(
                    (x) =>
                      x.edition === edition &&
                      x.kind === "Reference" &&
                      x.reference.category === category,
                  )
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nameRu}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      </details>
      <button
        className="button"
        disabled={!text || reading}
        onClick={() => check(text, overrides)}
      >
        Проверить и посмотреть
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="import-preview">
          <h3>{preview.data.name}</h3>
          <p>
            {filename} ·{" "}
            {preview.format === "native" ? "D&D Companion" : "LSS v2"} ·{" "}
            {preview.data.edition.slice(3)}
          </p>
          <p>
            Уровень {deriveCharacter(preview.data).level} · Хиты{" "}
            {preview.data.hp} / {deriveCharacter(preview.data).maxHp} ·
            Пользовательских блоков {preview.data.customSheet.blocks.length}
          </p>
          {preview.warnings.map((w) => (
            <p className="character-help" key={w}>
              {w}
            </p>
          ))}
          <button
            className="button primary"
            onClick={() => accept(preview.data, preview.warnings)}
          >
            Открыть для проверки и сохранения
          </button>
        </div>
      )}
    </section>
  );
}
