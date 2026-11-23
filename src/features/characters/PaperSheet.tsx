import type { CharacterData, CustomSheet } from "@/entities/character";
import type { Content } from "@/entities/content";
import { characterSheetTemplate } from "@/domain/paper-sheet";

export function PaperFields({ sheet }: { sheet: CustomSheet }) {
  return (
    <div className={`paper-fields paper-columns-${sheet.columns}`}>
      {sheet.blocks.map((b) => (
        <section
          key={b.id}
          className={`paper-field paper-${b.kind} ${b.wide ? "paper-wide" : ""}`}
        >
          <h3>{b.title}</h3>
          {b.kind === "text" ? (
            <p>{b.text || "\u00a0"}</p>
          ) : (
            <strong>
              {b.kind === "checkbox"
                ? b.checked
                  ? "☑"
                  : "☐"
                : b.kind === "resource"
                  ? `${b.value} / ${b.max}`
                  : b.value}
            </strong>
          )}
          {b.caption && <small>{b.caption}</small>}
        </section>
      ))}
    </div>
  );
}
export function PaperSheet({
  character: c,
  content,
}: {
  character: CharacterData;
  content: Content[];
}) {
  const sheet = c.customSheet.standalone
    ? c.customSheet
    : characterSheetTemplate(c, content);
  return (
    <article className="paper-sheet" aria-label={`Лист персонажа: ${c.name}`}>
      <header className="paper-heading">
        <div>
          <span>D&D COMPANION · {c.edition.slice(3)}</span>
          <h2>{sheet.title || c.name}</h2>
        </div>
        <span className="paper-seal">
          {c.customSheet.standalone ? "СВОЙ\nЛИСТ" : "ЛИСТ\nПЕРСОНАЖА"}
        </span>
      </header>
      <div
        className={`paper-sections ${sheet.columns === 1 ? "paper-single" : ""}`}
      >
        {[...new Set(sheet.blocks.map((b) => b.group || "Свои поля"))].map(
          (group) => (
            <section
              key={group}
              data-group={group}
              className={`paper-section ${["Персонаж", "Характеристики", "Заклинания", "Умения и история"].includes(group) ? "paper-section-wide" : ""} ${["Навыки", "Спасброски"].includes(group) ? "paper-list" : ""}`}
            >
              <h2 className="paper-section-title">{group}</h2>
              <PaperFields
                sheet={{
                  ...sheet,
                  blocks: sheet.blocks.filter(
                    (b) => (b.group || "Свои поля") === group,
                  ),
                }}
              />
            </section>
          ),
        )}
      </div>
      {!c.customSheet.standalone && c.customSheet.blocks.length > 0 && (
        <>
          <h2>{c.customSheet.title}</h2>
          <PaperFields sheet={c.customSheet} />
        </>
      )}
      <footer>
        Лист для игры за столом ·{" "}
        {c.customSheet.standalone ? "Пользовательские значения" : "D&D 5e"}
      </footer>
    </article>
  );
}
