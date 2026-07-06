// IndexedDB 保存層。月次データ（months）・商品マスタ（masters）・設定（settings）を端末内に保存する。
// すべての読み書きはこのモジュール経由で行う（引き継ぎ用の一括エクスポート/インポートもここ）。
const DB_NAME = "tsukijime";
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("months")) db.createObjectStore("months", { keyPath: "ym" });
      if (!db.objectStoreNames.contains("masters")) db.createObjectStore("masters", { keyPath: "version" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqResult(store, method, ...args) {
  return new Promise((resolve, reject) => {
    const r = store[method](...args);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function get(storeName, key) {
  const db = await openDb();
  const t = db.transaction(storeName, "readonly");
  return reqResult(t.objectStore(storeName), "get", key);
}

async function getAll(storeName) {
  const db = await openDb();
  const t = db.transaction(storeName, "readonly");
  return reqResult(t.objectStore(storeName), "getAll");
}

async function put(storeName, value) {
  const db = await openDb();
  return tx(db, storeName, "readwrite", (s) => s.put(value));
}

async function del(storeName, key) {
  const db = await openDb();
  return tx(db, storeName, "readwrite", (s) => s.delete(key));
}

// ---- 月次データ ----

// 空の月レコード。pages は確定済み読み取り結果、arrivals は {日: {商品key: 個数}}、
// specials はノート特別交換の明細、physicalCount は月末の実棚数。
export function emptyMonth(ym, masterVersion) {
  return {
    ym,
    masterVersion,
    pages: [],          // [{ name, predictions, savedAt }]
    carryover: null,    // { productKey: qty } 未入力なら null
    arrivals: {},       // { day(number): { productKey: qty } }
    specials: [],       // [{ id, day, method('cash'|'debit'|'point'), qty: {notes_Y..} }]
    physicalCount: null,// { productKey: qty } 未入力なら null
    cash: null,         // { opening: {金種:枚数}|null, closing: {金種:枚数}|null } 未入力なら null
    note: "",
    updatedAt: null,
  };
}

export async function getMonth(ym) {
  return (await get("months", ym)) || null;
}

// 無ければその月に適用されるマスタのスナップショット付きで作成して返す。
export async function ensureMonth(ym) {
  let m = await getMonth(ym);
  if (m) return m;
  const master = await masterForYm(ym);
  m = emptyMonth(ym, master ? master.version : 1);
  await putMonth(m);
  return m;
}

export async function putMonth(month) {
  month.updatedAt = new Date().toISOString();
  return put("months", month);
}

export async function getAllMonths() {
  const list = await getAll("months");
  return list.sort((a, b) => (a.ym < b.ym ? -1 : 1));
}

export async function deleteMonth(ym) {
  return del("months", ym);
}

// ---- 商品マスタ（バージョン管理）----
// マスタ = { version, createdAt, effectiveFrom('YYYYMM'), products[], roiRows[], config, layout }
// 月レコードは作成時点のマスタ version を保持し、以後その月はそのマスタで処理する。

export async function getMaster(version) {
  return (await get("masters", version)) || null;
}

export async function putMaster(master) {
  return put("masters", master);
}

export async function getAllMasters() {
  const list = await getAll("masters");
  return list.sort((a, b) => a.version - b.version);
}

// ym に適用されるマスタ（effectiveFrom <= ym の最新）。無ければ最古を返す。
export async function masterForYm(ym) {
  const all = await getAllMasters();
  if (!all.length) return null;
  const applicable = all.filter((m) => String(m.effectiveFrom) <= String(ym));
  return applicable.length ? applicable[applicable.length - 1] : all[0];
}

export async function nextMasterVersion() {
  const all = await getAllMasters();
  return all.length ? all[all.length - 1].version + 1 : 1;
}

// ---- 設定 ----

export async function getSetting(key, fallback = null) {
  const row = await get("settings", key);
  return row ? row.value : fallback;
}

export async function putSetting(key, value) {
  return put("settings", { key, value });
}

// ---- 一括エクスポート / インポート（バックアップ・引き継ぎ）----

export async function exportAll() {
  const [months, masters, settings] = await Promise.all([
    getAll("months"), getAll("masters"), getAll("settings"),
  ]);
  return {
    app: "tsukijime",
    format: 1,
    exportedAt: new Date().toISOString(),
    months, masters, settings,
  };
}

// data: exportAll() の出力。既存データはすべて置き換える。
export async function importAll(data) {
  if (!data || data.app !== "tsukijime" || !Array.isArray(data.months) || !Array.isArray(data.masters)) {
    throw new Error("バックアップファイルの形式が正しくありません。");
  }
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const t = db.transaction(["months", "masters", "settings"], "readwrite");
    for (const name of ["months", "masters", "settings"]) t.objectStore(name).clear();
    for (const m of data.months) t.objectStore("months").put(m);
    for (const m of data.masters) t.objectStore("masters").put(m);
    for (const s of data.settings || []) t.objectStore("settings").put(s);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return { months: data.months.length, masters: data.masters.length };
}
