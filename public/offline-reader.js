"use strict";
const byId = (id) => document.getElementById(id);
const element = (tag, text) => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};
const status = byId("status"),
  detail = byId("detail"),
  kind = byId("kind");
const edition = byId("edition"),
  search = byId("search"),
  clear = byId("clear-personal");
const collections = {
  public: {
    database: "companion-offline",
    store: "cards",
    items: [],
    limit: 200,
  },
  personal: {
    database: "companion-offline-personal",
    store: "snapshots",
    items: [],
    limit: 30,
  },
};
const current = () =>
  collections[kind.value === "public" ? "public" : "personal"];
const reset = () =>
  detail.replaceChildren(element("p", "Выберите сохранённую копию."));
function render() {
  const list = byId("cards");
  list.replaceChildren();
  const collection = current();
  const personal = collection === collections.personal;
  byId("edition-filter").hidden = personal;
  byId("privacy").hidden = !personal;
  clear.hidden = !personal || !collection.items.length;
  const query = search.value.trim().toLocaleLowerCase("ru");
  const found = collection.items
    .filter(
      (item) =>
        (personal
          ? item.kind === kind.value
          : item.edition === edition.value) &&
        [
          item.name,
          ...item.blocks.map((block) => block.title + " " + block.text),
        ]
          .join(" ")
          .toLocaleLowerCase("ru")
          .includes(query),
    )
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  status.textContent =
    collection.error ||
    `Сохранено ${collection.items.length} / ${collection.limit} · найдено ${found.length}`;
  for (const item of found) {
    const button = element("button", item.name);
    button.onclick = () => show(item, collection);
    list.append(button);
  }
}
function show(item, collection) {
  const editions = {
    "5e_2014": "2014",
    "5e_2024": "2024",
    Mixed: "2014 + 2024",
  };
  detail.replaceChildren(
    element("h2", item.name),
    element(
      "p",
      `Редакция ${editions[item.edition]} · версия ${item.version} · сохранено ${new Date(item.savedAt).toLocaleString("ru-RU")}`,
    ),
  );
  const print = element("button", "Распечатать копию");
  print.onclick = () => window.print();
  const remove = element("button", "Удалить сохранённую копию");
  remove.onclick = () => {
    if (confirm("Удалить эту копию из браузера?"))
      mutate(collection, (store) => store.delete(item.id));
  };
  detail.append(print, remove);
  for (const block of item.blocks)
    detail.append(element("h3", block.title), element("p", block.text));
  if (typeof item.notes === "string") showNotes(item, collection);
  if (item.source || item.license)
    detail.append(
      element("h3", "Источник и лицензия"),
      element("p", item.source),
      element("p", item.license),
    );
}
function mutate(collection, command) {
  if (!collection.db) return;
  const tx = collection.db.transaction(collection.store, "readwrite");
  command(tx.objectStore(collection.store));
  tx.oncomplete = () => {
    reset();
    load(collection);
  };
  tx.onabort = () => {
    status.textContent = "Удаление не удалось.";
  };
}
function load(collection) {
  if (!collection.db) return;
  const request = collection.db
    .transaction(collection.store)
    .objectStore(collection.store)
    .getAll();
  request.onsuccess = () => {
    collection.error = "";
    collection.items = request.result;
    if (current() === collection) render();
  };
  request.onerror = () => {
    collection.error = "Не удалось прочитать копии.";
    if (current() === collection) render();
  };
}
const view = new URLSearchParams(location.search).get("view");
if (view === "campaign" || view === "character") kind.value = view;
for (const collection of Object.values(collections)) {
  const request = indexedDB.open(collection.database, 1);
  request.onupgradeneeded = () =>
    request.result.createObjectStore(collection.store, { keyPath: "id" });
  request.onsuccess = () => {
    collection.db = request.result;
    load(collection);
  };
  request.onerror = () => {
    collection.error = "Браузер не разрешил открыть локальное хранилище.";
    if (current() === collection) render();
  };
}
search.oninput = render;
kind.onchange = edition.onchange = () => {
  reset();
  render();
};
byId("refresh").onclick = () => {
  reset();
  load(current());
};
clear.onclick = () => {
  if (confirm("Удалить из этого браузера все копии листов и заметок?"))
    mutate(collections.personal, (store) => store.clear());
};
render();

function updateSnapshot(collection, item, transform) {
  return new Promise((resolve, reject) => {
    const tx = collection.db.transaction(collection.store, "readwrite");
    const store = tx.objectStore(collection.store);
    const request = store.get(item.id);
    let updated;
    request.onsuccess = () => {
      const current = request.result;
      if (
        !current ||
        current.version !== item.version ||
        JSON.stringify(current.draft) !== JSON.stringify(item.draft)
      ) {
        tx.abort();
        return;
      }
      updated = transform(current);
      store.put(updated);
    };
    tx.oncomplete = () => {
      collection.items = collection.items.map((copy) =>
        copy.id === item.id ? updated : copy,
      );
      resolve(updated);
    };
    tx.onabort = () =>
      reject(
        tx.error ||
          Error("Копия изменилась. Перечитайте её перед сохранением."),
      );
  });
}

async function publishNotes(item) {
  const character = item.kind === "character";
  const endpoint = character ? "/api/characters" : "/api/campaigns";
  const id = item.id.split(":")[1];
  const list = await fetch(
    endpoint +
      (character ? "?edition=" + encodeURIComponent(item.edition) : ""),
    { cache: "no-store" },
  );
  if (!list.ok) throw Error("Войдите в аккаунт, которому принадлежит запись.");
  const row = (await list.json()).find(
    (record) => record.id === id && !record.archived,
  );
  if (!row) throw Error("Запись недоступна в текущем аккаунте.");
  if (row.version !== item.draft.version) {
    if (row.data.notes === item.draft.text) return row;
    throw Error(
      "Версия записи изменилась. Черновик сохранён. Сверьте его с актуальными заметками в приложении и перенесите нужный текст вручную.",
    );
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "save",
      id,
      version: row.version,
      data: { ...row.data, notes: item.draft.text },
    }),
  });
  if (response.status === 409)
    throw Error("Запись изменилась во время отправки. Черновик сохранён.");
  if (!response.ok)
    throw Error(
      "Сохранение на сервере не удалось. Черновик остался в браузере.",
    );
  return response.json();
}

function showNotes(item, collection) {
  const section = element("section", "");
  const label = element("label", "Черновик заметок");
  const input = element("textarea", "");
  input.maxLength = 20000;
  input.value = item.draft?.text ?? item.notes;
  label.append(input);
  const save = element("button", "Сохранить черновик в браузере");
  const sync = element("button", "Отправить черновик на сервер");
  const discard = element("button", "Удалить черновик");
  const message = element("p", "");
  message.setAttribute("role", "status");
  function updateActions() {
    const changed = input.value !== (item.draft?.text ?? item.notes);
    save.disabled = !changed;
    sync.disabled = !item.draft || changed;
    discard.disabled = !item.draft;
  }
  async function run(command) {
    input.disabled = save.disabled = sync.disabled = discard.disabled = true;
    try {
      await command();
    } catch (error) {
      message.textContent =
        error instanceof TypeError
          ? "Нет связи с сервером. Черновик остался в браузере."
          : error.message;
    } finally {
      input.disabled = false;
      updateActions();
    }
  }
  input.oninput = updateActions;
  save.onclick = () =>
    run(async () => {
      item = await updateSnapshot(collection, item, (current) => ({
        ...current,
        draft: {
          text: input.value,
          version: current.draft?.version ?? current.version,
        },
      }));
      message.textContent = "Черновик сохранён на устройстве.";
    });
  discard.onclick = () => {
    if (!confirm("Удалить локальный черновик заметок?")) return;
    return run(async () => {
      item = await updateSnapshot(collection, item, (current) => ({
        ...current,
        draft: undefined,
      }));
      input.value = item.notes;
      message.textContent = "Черновик удалён.";
    });
  };
  sync.onclick = () =>
    run(async () => {
      const published = await publishNotes(item);
      item = await updateSnapshot(collection, item, (current) => ({
        ...current,
        notes: published.data.notes,
        version: published.version,
        draft: undefined,
      }));
      message.textContent = "Заметки сохранены на сервере.";
    });
  updateActions();
  section.append(label, save, sync, discard, message);
  detail.append(section);
}
