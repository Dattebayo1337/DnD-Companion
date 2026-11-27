import { useState } from "react";
import type { OfflineSnapshot } from "@/domain/offline-snapshot";

async function saveSnapshot(snapshot: OfflineSnapshot) {
  if (
    !window.isSecureContext ||
    !("serviceWorker" in navigator) ||
    !("indexedDB" in window)
  )
    throw new Error(
      "Для автономного чтения нужен браузер с локальным хранилищем и HTTPS или localhost.",
    );
  if (
    new TextEncoder().encode(JSON.stringify(snapshot)).length >
    2 * 1024 * 1024
  )
    throw new Error("Копия превышает 2 МБ. Сократите объём заметок или листа.");
  await navigator.serviceWorker.register("/offline-sw.js", { scope: "/" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Автономный читатель не подготовился. Повторите сохранение.",
              ),
            ),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("companion-offline-personal", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("snapshots", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      const store = tx.objectStore("snapshots");
      const count = store.count();
      const existing = store.get(snapshot.id);
      let limitReached = false;
      existing.onsuccess = () => {
        limitReached = count.result >= 30 && existing.result === undefined;
        if (limitReached) tx.abort();
        else store.put({ ...snapshot, draft: existing.result?.draft });
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(
          limitReached
            ? new Error(
                "Достигнут лимит в 30 личных копий. Удалите ненужную в читателе.",
              )
            : tx.error,
        );
    });
  } finally {
    db.close();
  }
}

export function OfflineSnapshotSave({
  kind = "character",
  makeSnapshot,
}: {
  kind?: OfflineSnapshot["kind"];
  makeSnapshot: () => OfflineSnapshot;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="offline-save">
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          if (
            !window.confirm(
              "Сохранить личную копию в этом браузере? Она доступна каждому, кто пользуется этим профилем браузера, даже после выхода из аккаунта. Сохраняйте только на доверенном устройстве.",
            )
          )
            return;
          setBusy(true);
          setMessage("");
          try {
            await saveSnapshot(makeSnapshot());
            setMessage("Копия сохранена. Повторное сохранение обновит её.");
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "Не удалось сохранить копию.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Сохранение…" : "Сохранить для чтения без сети"}
      </button>
      <a href={`/offline.html?view=${kind}`} target="_blank" rel="noreferrer">
        Открыть копии без сети
      </a>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
