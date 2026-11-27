"use client";
import { CharacterImport } from "./CharacterImport";
import { OfflineSnapshotSave } from "../offline/OfflineSnapshotSave";
import { characterSnapshot } from "@/domain/offline-snapshot";
import {
  CustomSheet,
  PlayableCustomSheet,
  downloadCharacterJson,
} from "./CustomSheet";
import { exportCharacter } from "@/domain/character-files";
import { CharacterPrint } from "../print/CharacterPrint";
import { PaperSheet } from "./PaperSheet";
import { TabletopSheet } from "./TabletopSheet";
import { useEffect, useState } from "react";
import type { Content, EditionId, SourceBook } from "@/entities/content";
import type { Settings } from "../shell/types";
import { Detail } from "../compendium/Detail";
import {
  characterSchema,
  skillLabels,
  skillAbilities,
  type CharacterData,
  type CharacterRecord,
} from "@/entities/character";
import {
  classRules,
  deriveCharacter,
  castingAbility,
  pointCost,
  validateCharacter,
  classSpellLevel,
} from "@/domain/rules/character";
import { requestJson } from "@/shared/client";
import { RulesText } from "../compendium/RulesText";
const abilityLabels = {
  STR: "Сила",
  DEX: "Ловкость",
  CON: "Телосложение",
  INT: "Интеллект",
  WIS: "Мудрость",
  CHA: "Харизма",
};
const signed = (n: number) => (n >= 0 ? "+" : "") + n;
const post = <T,>(body: unknown) =>
  requestJson<T>("/api/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
function Picker({
  label,
  entries,
  value,
  change,
}: {
  label: string;
  entries: Content[];
  value: string;
  change: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  return (
    <label className="character-field">
      {label}
      <input
        aria-label={"Поиск: " + label}
        placeholder="Найти в списке…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => change(e.target.value)}
      >
        <option value="">Выберите…</option>
        {entries
          .filter(
            (e) =>
              e.id === value ||
              `${e.nameRu} ${e.nameOriginal}`
                .toLowerCase()
                .includes(q.toLowerCase()),
          )
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.nameRu}
              {e.kind === "Spell"
                ? ` · ${e.spell.level === 0 ? "заговор" : e.spell.level + " круг"}`
                : ""}
            </option>
          ))}
      </select>
    </label>
  );
}
export function Characters({
  edition,
  sources,
  settings,
}: {
  edition: EditionId;
  sources: SourceBook[];
  settings: Settings;
}) {
  const [editorMode, setEditorMode] = useState<"sheet" | "steps">("sheet");
  const [inventoryPick, setInventoryPick] = useState("");
  const [spellPick, setSpellPick] = useState("");
  const [importing, setImporting] = useState(false);
  const [isImport, setIsImport] = useState(false);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [detail, setDetail] = useState<Content | null>(null);
  const [entries, setEntries] = useState<Content[]>([]),
    [records, setRecords] = useState<CharacterRecord[]>([]),
    [selected, setSelected] = useState<CharacterRecord | null>(null),
    [draft, setDraft] = useState<CharacterData | null>(null),
    [step, setStep] = useState(0),
    [tab, setTab] = useState("Бумажный лист"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [archive, setArchive] = useState(false),
    [amount, setAmount] = useState(1),
    [pick, setPick] = useState(""),
    [classId, setClassId] = useState(""),
    [slot, setSlot] = useState(1),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      requestJson<Content[]>(`/api/characters?edition=${edition}&catalog=1`),
      requestJson<CharacterRecord[]>(`/api/characters?edition=${edition}`),
    ])
      .then(([e, r]) => {
        if (!cancelled) {
          setEntries(e);
          setRecords(r);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [edition, revision]);
  const refs = (category: string) =>
    entries.filter(
      (e) => e.kind === "Reference" && e.reference.category === category,
    );
  const name = (id: string | null) =>
    entries.find((e) => e.id === id)?.nameRu ?? "—";
  const classes = refs("Class").filter((e) => classRules[e.id]);
  const update = (patch: Partial<CharacterData>) =>
    setDraft(draft ? { ...draft, ...patch } : null);
  async function command(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await post<CharacterRecord>({
        action,
        ...(selected ? { id: selected.id, version: selected.version } : {}),
        ...extra,
      });
      setSelected(r);
      setDraft(null);
      setRecords((old) => [r, ...old.filter((x) => x.id !== r.id)]);
      setNotice(
        action === "level"
          ? "Уровень повышен. Проверьте новые умения и доступные варианты на вкладке «Умения»."
          : "Сохранено",
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function create() {
    setInventoryPick("");
    setSpellPick("");
    setIsImport(false);
    setImportWarnings([]);
    setImporting(false);
    setClassId("");
    setPick("");
    setNotice("");
    if (!classes[0] || !refs("SpeciesRace")[0] || !refs("Background")[0]) {
      setError("Сначала импортируйте классы, виды и предыстории SRD.");
      return;
    }
    const id = classes[0].id;
    setSelected(null);
    setStep(0);
    setDraft(
      characterSchema.parse({
        edition,
        speciesRaceId: refs("SpeciesRace")[0].id,
        backgroundId: refs("Background")[0].id,
        method: "Standard",
        abilities: { STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 },
        classes: [{ classId: id, level: 1, hpRolls: [classRules[id].hitDie] }],
        name: "Новый герой",
      }),
    );
    setError("");
  }
  const stats = selected ? deriveCharacter(selected.data) : null;
  const c = selected?.data;
  const stages = [
    "Происхождение",
    "Характеристики",
    "Владения",
    "Снаряжение",
    "Заклинания",
    "Свой лист",
    "Проверка",
  ];
  const active = draft ?? c;
  const draftStats =
    draft && draft.classes.every((x) => classRules[x.classId])
      ? deriveCharacter(draft)
      : null;
  const draftParsed = draft ? characterSchema.safeParse(draft) : null;
  const draftIssues = draftParsed?.success
    ? validateCharacter(
        draftParsed.data,
        new Map(entries.map((e) => [e.id, e])),
      )
    : draft
      ? ["Заполните имя и проверьте допустимые значения полей."]
      : [];

  const savePatch = (patch: Partial<CharacterData>) =>
    c && command("save", { data: { ...c, ...patch } });
  const spellClasses =
    active?.classes.map((x) => classRules[x.classId]).filter(Boolean) ?? [];
  const activeClass = active?.classes.some((x) => x.classId === classId)
    ? classId
    : active?.classes[0].classId || "";
  const maxCircle = classSpellLevel(
    activeClass,
    active?.classes.find((x) => x.classId === activeClass)?.level ?? 1,
  );
  const spellOptions = entries.filter(
    (e) =>
      e.kind === "Spell" &&
      e.spell.level <= maxCircle &&
      (!classRules[activeClass] ||
        e.spell.classes.includes(classRules[activeClass].nameRu) ||
        e.spell.classes.includes(classRules[activeClass].name)),
  );
  function inventoryEditor(
    data: CharacterData,
    change: (v: CharacterData["inventory"]) => void,
  ) {
    const pick = inventoryPick;
    const setPick = setInventoryPick;
    return (
      <>
        <div className="character-row">
          <Picker
            label="Добавить предмет"
            entries={entries.filter(
              (e) =>
                e.kind === "Reference" &&
                ["Weapon", "Armor", "Equipment", "MagicItem"].includes(
                  e.reference.category,
                ),
            )}
            value={pick}
            change={setPick}
          />
          <button
            className="button"
            disabled={!pick || busy}
            onClick={() => {
              change([
                ...data.inventory,
                {
                  id: crypto.randomUUID(),
                  contentId: pick,
                  quantity: 1,
                  equipped: false,
                  attuned: false,
                },
              ]);
              setPick("");
            }}
          >
            Добавить предмет
          </button>
        </div>
        {data.inventory.map((i) => (
          <div className="character-item" key={i.id}>
            <strong>
              <button
                onClick={() =>
                  setDetail(entries.find((e) => e.id === i.contentId) ?? null)
                }
              >
                {name(i.contentId)} ↗
              </button>
            </strong>
            <label>
              Количество
              <input
                type="number"
                min={1}
                max={10000}
                aria-label={"Количество: " + name(i.contentId)}
                key={i.quantity}
                defaultValue={i.quantity}
                onBlur={(e) =>
                  change(
                    data.inventory.map((v) =>
                      v.id === i.id
                        ? {
                            ...v,
                            quantity: Math.max(1, Number(e.target.value)),
                          }
                        : v,
                    ),
                  )
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={i.equipped}
                onChange={(e) =>
                  change(
                    data.inventory.map((v) =>
                      v.id === i.id ? { ...v, equipped: e.target.checked } : v,
                    ),
                  )
                }
              />{" "}
              Надето
            </label>
            <label>
              <input
                type="checkbox"
                checked={i.attuned}
                onChange={(e) =>
                  change(
                    data.inventory.map((v) =>
                      v.id === i.id ? { ...v, attuned: e.target.checked } : v,
                    ),
                  )
                }
              />{" "}
              Настройка
            </label>
            <button
              aria-label={"Убрать: " + name(i.contentId)}
              onClick={() =>
                change(data.inventory.filter((v) => v.id !== i.id))
              }
            >
              Убрать
            </button>
          </div>
        ))}
      </>
    );
  }
  function spellEditor(
    data: CharacterData,
    change: (v: CharacterData["spells"]) => void,
  ) {
    const pick = spellPick;
    const setPick = setSpellPick;
    return (
      <>
        <div className="character-row">
          <label>
            Класс
            <select
              value={activeClass}
              onChange={(e) => {
                setClassId(e.target.value);
                setPick("");
              }}
            >
              {spellClasses.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nameRu}
                </option>
              ))}
            </select>
          </label>
          <Picker
            label="Добавить заклинание"
            entries={spellOptions}
            value={pick}
            change={setPick}
          />
          <button
            className="button"
            disabled={
              !pick ||
              busy ||
              data.spells.some(
                (s) => s.spellId === pick && s.classId === activeClass,
              )
            }
            onClick={() => {
              change([
                ...data.spells,
                { spellId: pick, classId: activeClass, status: "Known" },
              ]);
              setPick("");
            }}
          >
            Добавить заклинание
          </button>
        </div>
        <p className="character-help">
          Отметьте подготовленные и всегда доступные заклинания. Для классов с
          известными заклинаниями отметьте доступные как «Всегда». Лимит выбора
          и исключения от умений проверяются по тексту класса.
        </p>
        {data.spells.map((s, i) => (
          <div className="character-item" key={s.spellId + s.classId}>
            <strong>
              <button
                onClick={() =>
                  setDetail(entries.find((e) => e.id === s.spellId) ?? null)
                }
              >
                {name(s.spellId)} ↗
              </button>
              <small>{name(s.classId)}</small>
            </strong>
            <select
              aria-label={"Подготовка: " + name(s.spellId)}
              value={s.status}
              onChange={(e) =>
                change(
                  data.spells.map((v, j) =>
                    j === i
                      ? { ...v, status: e.target.value as typeof s.status }
                      : v,
                  ),
                )
              }
            >
              <option value="Known">В книге / известно</option>
              <option value="Prepared">Подготовлено</option>
              <option value="Always">Всегда доступно</option>
            </select>
            {!draft && (
              <>
                <button
                  className="button"
                  disabled={busy || s.status === "Known"}
                  onClick={() => command("cast", { key: s.spellId, slot })}
                >
                  Применить
                </button>
                {stats!.pact.max > 0 && (
                  <button
                    className="button"
                    disabled={busy || s.status === "Known"}
                    onClick={() =>
                      command("cast", { key: s.spellId, pact: true })
                    }
                  >
                    Договор
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => change(data.spells.filter((_, j) => i !== j))}
            >
              Убрать
            </button>
          </div>
        ))}
      </>
    );
  }
  return (
    <section className="characters">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ВАШИ ПРИКЛЮЧЕНИЯ · {edition.slice(3)}</p>
          <h1>Персонажи</h1>
          <p>История героя начинается здесь.</p>
        </div>
        <button
          className="button primary"
          disabled={!loaded || busy || !!draft}
          onClick={create}
        >
          ＋ Создать персонажа
        </button>
        <button
          className="button"
          disabled={!loaded || busy || !!draft}
          onClick={() => {
            create();
            setStep(5);
            setEditorMode("steps");
          }}
        >
          ＋ Свой лист
        </button>
        <button
          className="button"
          disabled={!loaded || busy || !!draft}
          onClick={() => setImporting(!importing)}
        >
          ↑ Загрузить JSON
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="character-notice">
          {notice}
        </p>
      )}
      {!loaded && <p>Загрузка персонажей…</p>}
      {importing && (
        <CharacterImport
          entries={entries}
          edition={edition}
          close={() => setImporting(false)}
          accept={(data, warnings) => {
            setSelected(null);
            setDraft(data);
            setIsImport(true);
            setImportWarnings(warnings);
            setImporting(false);
            setEditorMode("sheet");
            setStep(0);
            setError("");
          }}
        />
      )}
      {draft ? (
        <div className={`character-panel character-builder ${editorMode}`}>
          <div className="character-row">
            <h2>{selected ? "Редактирование героя" : "Создание героя"}</h2>
            <button
              className="button"
              onClick={() => {
                if (window.confirm("Отменить несохранённые изменения листа?"))
                  setDraft(null);
              }}
            >
              Отмена
            </button>
          </div>
          <div className="character-row">
            <button
              className="button"
              aria-pressed={editorMode === "sheet"}
              onClick={() => setEditorMode("sheet")}
            >
              Лист целиком
            </button>
            <button
              className="button"
              aria-pressed={editorMode === "steps"}
              onClick={() => setEditorMode("steps")}
            >
              По шагам
            </button>
          </div>
          {importWarnings.map((w) => (
            <p className="character-help" key={w}>
              {w}
            </p>
          ))}
          {draftStats && (
            <div className="builder-summary">
              <strong>{draft.name || "Без имени"}</strong>
              <span>Уровень {draftStats.level}</span>
              <span>Макс. хиты {draftStats.maxHp}</span>
              <span>КД {draftStats.ac}</span>
              <span>Мастерство {signed(draftStats.proficiency)}</span>
            </div>
          )}
          <nav className="character-tabs" aria-label="Шаги создания">
            {stages.map((s, i) => (
              <button
                key={s}
                aria-current={step === i ? "step" : undefined}
                className={step === i ? "active" : ""}
                onClick={() => {
                  setStep(i);
                  if (editorMode === "sheet")
                    document
                      .getElementById(`builder-${i}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  setPick("");
                }}
              >
                {i + 1}. {s}
              </button>
            ))}
          </nav>
          {(editorMode === "sheet" || step === 0) && (
            <section className="sheet-editor-section" id="builder-0">
              <h3>Происхождение</h3>
              <div className="character-grid">
                <label>
                  Имя
                  <input
                    value={draft.name}
                    maxLength={120}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                </label>
                <Picker
                  label="Вид / раса"
                  entries={refs("SpeciesRace")}
                  value={draft.speciesRaceId}
                  change={(id) => update({ speciesRaceId: id })}
                />
                <Picker
                  label="Предыстория"
                  entries={refs("Background")}
                  value={draft.backgroundId}
                  change={(id) => update({ backgroundId: id })}
                />
                {!selected && (
                  <Picker
                    label="Начальный класс"
                    entries={classes}
                    value={draft.classes[0].classId}
                    change={(id) => {
                      if (id)
                        update({
                          classes: [
                            {
                              classId: id,
                              level: 1,
                              subclassId: null,
                              hpRolls: [classRules[id].hitDie],
                            },
                          ],
                        });
                    }}
                  />
                )}
              </div>
              <div className="character-grid">
                {draft.classes.map((x, index) => (
                  <div key={x.classId}>
                    <label>
                      Уровень · {name(x.classId)}
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={x.level}
                        onChange={(e) => {
                          const level = Math.max(
                            1,
                            Math.min(20, Math.trunc(Number(e.target.value))),
                          );
                          update({
                            classes: draft.classes.map((old, i) =>
                              i !== index
                                ? old
                                : {
                                    ...old,
                                    level,
                                    hpRolls: Array.from(
                                      { length: level },
                                      (_, j) =>
                                        old.hpRolls[j] ??
                                        Math.floor(
                                          classRules[old.classId].hitDie / 2,
                                        ) + 1,
                                    ),
                                  },
                            ),
                          });
                        }}
                      />
                    </label>
                    <Picker
                      label={"Подкласс · " + name(x.classId)}
                      entries={refs("Subclass").filter(
                        (e) =>
                          e.kind === "Reference" &&
                          e.reference.parentId === x.classId,
                      )}
                      value={x.subclassId ?? ""}
                      change={(id) =>
                        update({
                          classes: draft.classes.map((old, i) =>
                            i === index
                              ? { ...old, subclassId: id || null }
                              : old,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              {[
                draft.speciesRaceId,
                draft.backgroundId,
                draft.classes[0].classId,
              ].map((id) => (
                <details key={id}>
                  <summary>{name(id)} — правила выбора</summary>
                  <RulesText
                    text={entries.find((e) => e.id === id)?.descriptionRu ?? ""}
                  />
                </details>
              ))}
            </section>
          )}
          {(editorMode === "sheet" || step === 1) && (
            <section className="sheet-editor-section" id="builder-1">
              <h3>Характеристики</h3>
              <label>
                Метод характеристик
                <select
                  value={draft.method}
                  onChange={(e) =>
                    update({
                      method: e.target.value as CharacterData["method"],
                    })
                  }
                >
                  <option value="Standard">Стандартный набор</option>
                  <option value="PointBuy">Покупка за 27 очков</option>
                  <option value="Manual">Вручную</option>
                  <option value="Roll">4d6, отбросить меньший</option>
                </select>
              </label>
              {draft.method === "Roll" && (
                <button
                  className="button"
                  onClick={async () => {
                    try {
                      const rolls = await post<
                        { dice: number[]; total: number }[]
                      >({ action: "roll" });
                      update({
                        abilities: Object.fromEntries(
                          Object.keys(abilityLabels).map((a, i) => [
                            a,
                            rolls[i].total,
                          ]),
                        ) as CharacterData["abilities"],
                      });
                      setNotice(
                        rolls
                          .map((r) => r.dice.join("+") + " → " + r.total)
                          .join(" · "),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Бросить характеристики
                </button>
              )}
              <p>
                Стандартный набор: 15, 14, 13, 12, 10, 8. Покупка:{" "}
                {Number.isFinite(pointCost(Object.values(draft.abilities)))
                  ? pointCost(Object.values(draft.abilities))
                  : "—"}{" "}
                / 27.
              </p>
              <div className="character-grid">
                {Object.entries(abilityLabels).map(([key, label]) => {
                  const a = key as keyof typeof abilityLabels;
                  return (
                    <div className="ability-editor" key={a}>
                      <label>
                        {label}
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={draft.abilities[a]}
                          onChange={(e) =>
                            update({
                              abilities: {
                                ...draft.abilities,
                                [a]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        Бонусы {label.toLowerCase()}
                        <input
                          type="number"
                          min={0}
                          max={20}
                          value={draft.abilityBonuses[a] ?? 0}
                          onChange={(e) =>
                            update({
                              abilityBonuses: {
                                ...draft.abilityBonuses,
                                [a]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
              <p className="character-help">
                Бонусы происхождения, черт и повышения характеристик внесите
                отдельно по выбранным правилам. Они не применяются
                автоматически.
              </p>
              <h4>Боевые параметры и поправки</h4>
              <div className="character-grid">
                {(["maxHp", "ac", "initiative", "speed"] as const).map((k) => (
                  <label key={k}>
                    {
                      {
                        maxHp: "Поправка к максимуму хитов",
                        ac: "КД вручную (пусто — автоматически)",
                        initiative: "Поправка к инициативе",
                        speed: "Скорость, футы",
                      }[k]
                    }
                    <input
                      type="number"
                      value={draft.adjustments[k] ?? ""}
                      onChange={(e) =>
                        update({
                          adjustments: {
                            ...draft.adjustments,
                            [k]:
                              k === "ac" && e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
                {(isImport || selected) &&
                  (["hp", "tempHp"] as const).map((k) => (
                    <label key={k}>
                      {k === "hp" ? "Текущие хиты" : "Временные хиты"}
                      <input
                        type="number"
                        min={0}
                        max={1000000}
                        value={draft[k]}
                        onChange={(e) =>
                          update({ [k]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
              </div>
            </section>
          )}
          {(editorMode === "sheet" || step === 2) && (
            <section className="sheet-editor-section" id="builder-2">
              <h3>Владения</h3>
              <div className="character-grid">
                {Object.entries(skillLabels).map(([k, label]) => (
                  <label key={k}>
                    {label}
                    <select
                      value={
                        draft.skills[k as keyof typeof skillAbilities] ?? 0
                      }
                      onChange={(e) =>
                        update({
                          skills: {
                            ...draft.skills,
                            [k]: Number(e.target.value),
                          },
                        })
                      }
                    >
                      <option value={0}>Нет владения</option>
                      <option value={1}>Владение</option>
                      <option value={2}>Компетентность</option>
                    </select>
                  </label>
                ))}
              </div>
              <label>
                Языки
                <input
                  value={draft.languages}
                  onChange={(e) => update({ languages: e.target.value })}
                />
              </label>
              <label>
                Оружие, доспехи и инструменты
                <textarea
                  value={draft.proficiencies}
                  onChange={(e) => update({ proficiencies: e.target.value })}
                />
              </label>
              <p className="character-help">
                Выберите владения, предоставленные классом, видом и
                предысторией. Текст правил доступен на первом шаге.
              </p>
            </section>
          )}
          {(editorMode === "sheet" || step === 3) && (
            <section className="sheet-editor-section" id="builder-3">
              <h3>Снаряжение</h3>
              {inventoryEditor(draft, (inventory) => update({ inventory }))}
            </section>
          )}
          {(editorMode === "sheet" || step === 4) && (
            <section className="sheet-editor-section" id="builder-4">
              <h3>Заклинания</h3>
              {spellEditor(draft, (spells) => update({ spells }))}
            </section>
          )}
          {(editorMode === "sheet" || step === 5) && (
            <section className="sheet-editor-section" id="builder-5">
              <CustomSheet
                sheet={draft.customSheet}
                character={draft}
                content={entries}
                change={(customSheet) => update({ customSheet })}
                design
              />
            </section>
          )}
          {(editorMode === "sheet" || step === 6) && (
            <section className="sheet-editor-section" id="builder-6">
              <h3>Проверка и сохранение</h3>
              <h2>{draft.name}</h2>
              <p>
                {name(draft.speciesRaceId)} · {name(draft.backgroundId)} ·{" "}
                {draft.classes
                  .map((x) => name(x.classId) + " " + x.level)
                  .join(" / ")}
              </p>
              <p>
                Предметов: {draft.inventory.length} · Заклинаний:{" "}
                {draft.spells.length}
              </p>
              <label>
                История и заметки
                <textarea
                  value={draft.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                />
              </label>
              <p className="character-help">
                Хиты, бонус мастерства, спасброски, навыки, базовая защита и
                ячейки рассчитываются автоматически. Особые эффекты умений
                внесите как поправки в листе.
              </p>
              {draftIssues.length > 0 && (
                <ul className="error" aria-label="Проверьте перед сохранением">
                  {draftIssues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              )}
              <button
                className="button primary"
                disabled={busy || draftIssues.length > 0}
                onClick={() =>
                  command(selected ? "save" : isImport ? "import" : "create", {
                    data: draft,
                  })
                }
              >
                {busy
                  ? "Сохранение…"
                  : selected
                    ? "Сохранить изменения"
                    : "Создать героя"}
              </button>
            </section>
          )}
          <div
            className="character-row character-step-actions"
            hidden={editorMode === "sheet"}
          >
            <button
              className="button"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              Назад
            </button>
            <span>
              {step + 1} / {stages.length}
            </span>
            <button
              className="button"
              disabled={step === stages.length - 1}
              onClick={() => {
                setStep(step + 1);
                setPick("");
              }}
            >
              Далее
            </button>
          </div>
        </div>
      ) : selected && c && stats ? (
        <>
          <div className="character-panel">
            <div className="character-row">
              <button
                className="button"
                onClick={() => {
                  setSelected(null);
                  setNotice("");
                }}
              >
                ← Все персонажи
              </button>
              <button
                className="button"
                disabled={busy || selected.archived}
                onClick={() => {
                  setIsImport(false);
                  setImportWarnings([]);
                  setDraft(structuredClone(c));
                  setStep(0);
                  setPick("");
                }}
              >
                Редактировать
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  command("archive", { archived: !selected.archived })
                }
              >
                {selected.archived ? "Восстановить" : "В архив"}
              </button>
              <button
                className="button"
                disabled={busy || selected.archived}
                onClick={() => {
                  setIsImport(false);
                  setImportWarnings([]);
                  setDraft(structuredClone(c));
                  setEditorMode("steps");
                  setStep(5);
                  setPick("");
                }}
              >
                Настроить свой лист
              </button>
              <button
                className="button"
                onClick={() => {
                  downloadCharacterJson(
                    exportCharacter(c),
                    "character-" + selected.id + ".json",
                  );
                }}
              >
                Экспорт JSON
              </button>
            </div>
            <h2>
              {c.name} {selected.archived && "· в архиве"}
            </h2>
            <p>
              {name(c.speciesRaceId)} · {name(c.backgroundId)} ·{" "}
              {c.classes
                .map((x) => name(x.classId) + " " + x.level)
                .join(" / ")}
            </p>
            <div className="character-stats" hidden={c.customSheet.standalone}>
              {[
                ["Уровень", stats.level],
                ["Хиты", `${c.hp} / ${stats.maxHp}`],
                ["Временные хиты", c.tempHp],
                ["Класс доспеха", stats.ac],
                ["Инициатива", signed(stats.initiative)],
                ["Мастерство", signed(stats.proficiency)],
                ["Скорость", stats.speed + " фт."],
                ["Внимательность", stats.passivePerception],
              ].map(([label, value]) => (
                <div key={label}>
                  <small>{label}</small>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </div>
          {tab === "Свои поля" && (
            <PlayableCustomSheet
              key={selected.id + ":" + selected.version}
              sheet={c.customSheet}
              save={(customSheet) => savePatch({ customSheet })}
              disabled={busy || selected.archived}
            />
          )}
          {c.importSource && (
            <button
              className="button"
              onClick={() =>
                downloadCharacterJson(
                  JSON.parse(c.importSource!.json),
                  "original-lss.json",
                )
              }
            >
              Скачать исходный LSS JSON
            </button>
          )}
          <CharacterPrint character={c} content={entries} />
          <OfflineSnapshotSave
            key={selected.id}
            makeSnapshot={() => characterSnapshot(selected, entries)}
          />
          <nav className="character-tabs" aria-label="Разделы листа">
            {[
              "Бумажный лист",
              "Свои поля",
              "За столом",
              "Лист",
              "Инвентарь",
              "Заклинания",
              "Умения",
              "Заметки",
            ].map((t) => (
              <button
                key={t}
                className={tab === t ? "active" : ""}
                onClick={() => {
                  setTab(t);
                  setPick("");
                }}
              >
                {t}
              </button>
            ))}
          </nav>
          <fieldset
            disabled={busy || selected.archived}
            className="character-panel character-content"
          >
            {tab === "Бумажный лист" && (
              <PaperSheet character={c} content={entries} />
            )}
            {tab === "За столом" && (
              <TabletopSheet
                key={selected.id}
                character={c}
                stats={stats}
                entries={entries}
                command={command}
                patch={savePatch}
                open={setDetail}
                navigate={setTab}
              />
            )}
            {tab === "Лист" && (
              <>
                <div className="character-row">
                  <label>
                    Количество
                    <input
                      type="number"
                      min={0}
                      value={amount}
                      onChange={(e) => setAmount(Number(e.target.value))}
                    />
                  </label>
                  <button
                    className="button"
                    onClick={() => command("damage", { amount })}
                  >
                    Получить урон
                  </button>
                  <button
                    className="button"
                    onClick={() => command("heal", { amount })}
                  >
                    Лечение
                  </button>
                  <button
                    className="button"
                    onClick={() => command("tempHp", { amount })}
                  >
                    Временные хиты
                  </button>
                </div>
                <div className="character-stats">
                  {Object.entries(abilityLabels).map(([a, label]) => (
                    <div key={a}>
                      <small>{label}</small>
                      <strong>
                        {stats.scores[a as keyof typeof abilityLabels]} (
                        {signed(stats.mods[a as keyof typeof abilityLabels])})
                      </strong>
                      <small>Спасбросок {signed(stats.saves[a])}</small>
                    </div>
                  ))}
                </div>
                <div className="character-grid">
                  {Object.entries(skillLabels).map(([key, label]) => (
                    <div className="character-skill" key={key}>
                      <span>{label}</span>
                      <strong>{signed(stats.skills[key])}</strong>
                    </div>
                  ))}
                </div>
                <h3>Отдых и ресурсы</h3>
                <div className="character-row">
                  <button className="button" onClick={() => command("short")}>
                    Короткий отдых
                  </button>
                  <button className="button" onClick={() => command("long")}>
                    Длительный отдых
                  </button>
                </div>
                <p className="character-help">
                  Нажимайте после завершения отдыха. Кости хитов расходуются
                  отдельно; длительный отдых восстанавливает их по редакции.
                  Проверки концентрации и спасброски от смерти отмечаются
                  вручную.
                </p>
                {stats.hitDice.map((d) => (
                  <div className="character-item" key={d.classId}>
                    <span>
                      {name(d.classId)}: {d.remaining} / {d.max} d{d.die}
                    </span>
                    <button
                      className="button"
                      disabled={!d.remaining}
                      onClick={() => command("hitDie", { key: d.classId })}
                    >
                      Потратить кость хитов
                    </button>
                  </div>
                ))}
                {stats.resources.map((r) => (
                  <div className="character-item" key={r.key}>
                    <strong>
                      {r.name}:{" "}
                      {Math.max(0, r.max - (c.resourcesUsed[r.key] ?? 0))} /{" "}
                      {r.max}
                    </strong>
                    <button
                      className="button"
                      disabled={(c.resourcesUsed[r.key] ?? 0) >= r.max}
                      onClick={() =>
                        command("resource", {
                          key: r.key,
                          amount: (c.resourcesUsed[r.key] ?? 0) + 1,
                        })
                      }
                    >
                      Потратить
                    </button>
                    <button
                      className="button"
                      disabled={!(c.resourcesUsed[r.key] ?? 0)}
                      onClick={() =>
                        command("resource", {
                          key: r.key,
                          amount: (c.resourcesUsed[r.key] ?? 0) - 1,
                        })
                      }
                    >
                      Вернуть
                    </button>
                  </div>
                ))}
                <div className="character-grid">
                  <label>
                    Истощение
                    <input
                      type="number"
                      min={0}
                      max={6}
                      key={c.exhaustion}
                      defaultValue={c.exhaustion}
                      onBlur={(e) =>
                        savePatch({ exhaustion: Number(e.target.value) })
                      }
                    />
                  </label>
                  {(["success", "failure"] as const).map((k) => (
                    <label key={k}>
                      {k === "success" ? "Успехи" : "Провалы"} спасбросков от
                      смерти
                      <input
                        type="number"
                        min={0}
                        max={3}
                        key={c.deathSaves[k]}
                        defaultValue={c.deathSaves[k]}
                        onBlur={(e) =>
                          savePatch({
                            deathSaves: {
                              ...c.deathSaves,
                              [k]: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <Picker
                  label="Добавить состояние"
                  entries={refs("Condition")}
                  value={pick}
                  change={setPick}
                />
                <button
                  className="button"
                  disabled={!pick || c.conditionIds.includes(pick)}
                  onClick={() => {
                    savePatch({ conditionIds: [...c.conditionIds, pick] });
                    setPick("");
                  }}
                >
                  Добавить состояние
                </button>
                {c.conditionIds.map((id) => (
                  <button
                    className="button"
                    key={id}
                    onClick={() =>
                      savePatch({
                        conditionIds: c.conditionIds.filter((x) => x !== id),
                      })
                    }
                  >
                    {name(id)} ×
                  </button>
                ))}
              </>
            )}
            {tab === "Инвентарь" && (
              <>
                {inventoryEditor(c, (inventory) => savePatch({ inventory }))}
                <h3>Монеты</h3>
                <div className="character-grid">
                  {Object.entries(c.currency).map(([key, value]) => (
                    <label key={key}>
                      {
                        (
                          {
                            CP: "Медные",
                            SP: "Серебряные",
                            EP: "Электрумовые",
                            GP: "Золотые",
                            PP: "Платиновые",
                          } as const
                        )[key as keyof typeof c.currency]
                      }
                      <input
                        type="number"
                        min={0}
                        key={value}
                        defaultValue={value}
                        onBlur={(e) =>
                          savePatch({
                            currency: {
                              ...c.currency,
                              [key]: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
            {tab === "Заклинания" && (
              <>
                <div className="character-row">
                  {stats.slots.map(
                    (max, i) =>
                      max > 0 && (
                        <span key={i}>
                          Круг {i + 1}: {Math.max(0, max - c.slotsSpent[i])} /{" "}
                          {max}
                        </span>
                      ),
                  )}
                  {stats.pact.max > 0 && (
                    <span>
                      Договор: {stats.pact.max - c.pactSpent} / {stats.pact.max}
                      , круг {stats.pact.level}
                    </span>
                  )}
                </div>
                <label>
                  Ячейка для применения
                  <select
                    value={slot}
                    onChange={(e) => setSlot(Number(e.target.value))}
                  >
                    {Array.from({ length: 9 }, (_, i) => (
                      <option key={i} value={i + 1}>
                        {i + 1} круг
                      </option>
                    ))}
                  </select>
                </label>
                {c.classes
                  .filter(
                    (x) =>
                      classRules[x.classId].rows[x.level - 1].slots.some(
                        (n) => n > 0,
                      ) || classRules[x.classId].name === "Warlock",
                  )
                  .map((x) => {
                    const ability = castingAbility(classRules[x.classId].name);
                    return (
                      <p key={x.classId}>
                        {name(x.classId)} · Сл спасброска{" "}
                        {8 + stats.proficiency + stats.mods[ability]} · Атака{" "}
                        {signed(stats.proficiency + stats.mods[ability])}
                      </p>
                    );
                  })}
                <p>
                  Концентрация: {name(c.concentrationId)}{" "}
                  {c.concentrationId && (
                    <button
                      className="button"
                      onClick={() => savePatch({ concentrationId: null })}
                    >
                      Прекратить
                    </button>
                  )}
                </p>
                {spellEditor(c, (spells) => savePatch({ spells }))}
              </>
            )}
            {tab === "Умения" && (
              <>
                <div className="character-row">
                  <Picker
                    label="Класс для повышения уровня"
                    entries={classes}
                    value={classId || c.classes[0].classId}
                    change={setClassId}
                  />
                  <button
                    className="button"
                    disabled={stats.level >= 20}
                    onClick={() =>
                      command("level", { key: classId || c.classes[0].classId })
                    }
                  >
                    Повысить уровень · средние хиты
                  </button>
                </div>
                <p className="character-help">
                  При повышении добавляются хиты и пересчитываются ресурсы.
                  Подкласс, черты, заклинания и повышение характеристик выберите
                  по тексту новых умений.
                </p>
                {c.classes.map((x, i) => (
                  <div key={x.classId}>
                    <h3>
                      {name(x.classId)} · {x.level} уровень
                    </h3>
                    <Picker
                      label={"Подкласс: " + name(x.classId)}
                      entries={refs("Subclass").filter(
                        (e) =>
                          e.kind === "Reference" &&
                          e.reference.parentId === x.classId &&
                          Math.min(
                            ...e.reference.features.map((f) => f.level ?? 20),
                          ) <= x.level,
                      )}
                      value={x.subclassId ?? ""}
                      change={(id) =>
                        savePatch({
                          classes: c.classes.map((v, j) =>
                            i === j ? { ...v, subclassId: id || null } : v,
                          ),
                        })
                      }
                    />
                    {[x.classId, x.subclassId].filter(Boolean).map((id) => {
                      const e = entries.find((e) => e.id === id);
                      return e?.kind === "Reference" ? (
                        <div key={id}>
                          {e.reference.features
                            .filter(
                              (f) => f.level === null || f.level <= x.level,
                            )
                            .map((f, j) => (
                              <details key={j}>
                                <summary>
                                  {f.nameRu} {f.level && `· ${f.level} ур.`}
                                </summary>
                                <RulesText text={f.descriptionRu} />
                              </details>
                            ))}
                          <details>
                            <summary>Полные правила: {e.nameRu}</summary>
                            <RulesText text={e.descriptionRu} />
                          </details>
                        </div>
                      ) : null;
                    })}
                  </div>
                ))}
                <Picker
                  label="Добавить черту"
                  entries={refs("Feat")}
                  value={pick}
                  change={setPick}
                />
                <button
                  className="button"
                  disabled={!pick || c.featIds.includes(pick)}
                  onClick={() => {
                    savePatch({ featIds: [...c.featIds, pick] });
                    setPick("");
                  }}
                >
                  Добавить черту
                </button>
                {c.featIds.map((id) => (
                  <details key={id}>
                    <summary>{name(id)}</summary>
                    <RulesText
                      text={
                        entries.find((e) => e.id === id)?.descriptionRu ?? ""
                      }
                    />
                    <button
                      onClick={() =>
                        savePatch({
                          featIds: c.featIds.filter((x) => x !== id),
                        })
                      }
                    >
                      Убрать черту
                    </button>
                  </details>
                ))}
              </>
            )}
            {tab === "Заметки" && (
              <>
                <p>
                  {c.notes ||
                    "Историю героя можно добавить через «Редактировать»."}
                </p>
                <p>Языки: {c.languages || "не указаны"}</p>
                <p>Владения: {c.proficiencies || "не указаны"}</p>
                <h3>Поправки от умений и предметов</h3>
                <p className="character-help">
                  Эффекты черт, магических предметов, состояний и подклассов не
                  применяются автоматически. Здесь можно уточнить итоговые
                  значения.
                </p>
                <div className="character-grid">
                  {(
                    [
                      ["maxHp", "Поправка к максимуму хитов"],
                      ["initiative", "Поправка к инициативе"],
                      ["speed", "Скорость, футы"],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k}>
                      {label}
                      <input
                        type="number"
                        key={c.adjustments[k]}
                        defaultValue={c.adjustments[k]}
                        onBlur={(e) =>
                          savePatch({
                            adjustments: {
                              ...c.adjustments,
                              [k]: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                  <label>
                    Класс доспеха вручную (пусто = расчёт)
                    <input
                      type="number"
                      key={c.adjustments.ac ?? ""}
                      defaultValue={c.adjustments.ac ?? ""}
                      onBlur={(e) =>
                        savePatch({
                          adjustments: {
                            ...c.adjustments,
                            ac:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                </div>
              </>
            )}
          </fieldset>
        </>
      ) : (
        loaded && (
          <>
            <div className="character-row">
              <label>
                <input
                  type="checkbox"
                  checked={archive}
                  onChange={(e) => setArchive(e.target.checked)}
                />{" "}
                Показать архив
              </label>
              <button
                className="button"
                onClick={() => setRevision((r) => r + 1)}
              >
                Обновить список
              </button>
            </div>
            <div className="character-cards">
              {records
                .filter((r) => r.archived === archive)
                .map((r) => (
                  <button
                    className="character-card"
                    key={r.id}
                    onClick={() => {
                      setSelected(r);
                      setTab("Лист");
                      setError("");
                      setNotice("");
                      setClassId("");
                      setPick("");
                    }}
                  >
                    <span className="character-avatar">
                      {r.data.name.slice(0, 1)}
                    </span>
                    <h2>{r.data.name}</h2>
                    <p>
                      {r.data.classes
                        .map((x) => name(x.classId) + " " + x.level)
                        .join(" / ")}
                    </p>
                    <small>
                      {name(r.data.speciesRaceId)} · {r.data.hp} хитов
                    </small>
                  </button>
                ))}
            </div>
            {!records.some((r) => r.archived === archive) && (
              <div className="empty-state">
                <h2>{archive ? "Архив пуст" : "Ваш первый герой"}</h2>
                <p>
                  Создайте персонажа по правилам {edition.slice(3)}. Его лист
                  сохранится на этом устройстве.
                </p>
              </div>
            )}
          </>
        )
      )}
      {detail && (
        <Detail
          entry={detail}
          sources={sources}
          settings={settings}
          close={() => setDetail(null)}
          open={setDetail}
        />
      )}
    </section>
  );
}
