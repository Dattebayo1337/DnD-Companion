import { useState } from "react";
import type { LobbyView, LobbyIndex } from "@/entities/lobby";

export function LobbyCharacterSharing({
  view,
  characters,
  busy,
  action,
}: {
  view: LobbyView;
  characters: LobbyIndex["characters"];
  busy: boolean;
  action: (body: unknown) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState("");
  const id = view.id;
  if (view.master)
    return (
      view.master.shares.length > 0 && (
        <div>
          <h3>Листы игроков</h3>
          {view.master.shares.map((share) => (
            <div key={share.requestId} className="lobby-actions">
              <span>
                {share.memberName} · {share.characterName} ·{" "}
                {share.approved ? "Опубликован" : "Ожидает решения"}
              </span>
              {!share.approved && (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void action({
                      action: "reviewCharacter",
                      id,
                      memberId: share.memberId,
                      requestId: share.requestId,
                      approved: true,
                    })
                  }
                >
                  Утвердить лист
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void action({
                    action: "reviewCharacter",
                    id,
                    memberId: share.memberId,
                    requestId: share.requestId,
                    approved: false,
                  })
                }
              >
                {share.approved ? "Убрать из лобби" : "Отклонить"}
              </button>
            </div>
          ))}
        </div>
      )
    );
  if (!view.sharing) return null;
  const share = view.sharing.current;
  return (
    <div>
      <h3>Предложить свой лист</h3>
      <p>
        После одобрения мастером все участники увидят актуальный лист, включая
        заметки и пользовательские поля.
      </p>
      {share && (
        <div className="lobby-actions">
          <span>
            {share.characterName} ·{" "}
            {share.approved ? "Опубликован" : "Ожидает одобрения"}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void action({ action: "shareCharacter", id, characterId: null })
            }
          >
            Отозвать лист
          </button>
        </div>
      )}
      <div className="lobby-actions">
        <label>
          Мой персонаж{" "}
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Выберите персонажа</option>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name} · {character.edition.slice(3)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button"
          disabled={
            busy || !characters.some((character) => character.id === selected)
          }
          onClick={async () => {
            if (
              share &&
              !window.confirm(
                "Заменить текущую заявку или опубликованный лист? Новый лист снова должен одобрить мастер.",
              )
            )
              return;
            if (
              await action({
                action: "shareCharacter",
                id,
                characterId: selected,
              })
            )
              setSelected("");
          }}
        >
          Отправить мастеру
        </button>
      </div>
    </div>
  );
}
