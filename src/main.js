// アプリシェル。タブナビゲーション・対象年月の管理・エンジン初期化・マスタ初期シード。
// 各画面のロジックは src/views/*.js に分離。
import { loadConfig, parseRoiCsv } from "./config.js";
import { initBackend } from "./backend.js";
import { loadProducts } from "./products.js";
import { getAllMasters, putMaster } from "./db.js";
import { formatYm, parseYm, ymShift, defaultYmByRule } from "./dateUtils.js";
import { initGlobalHelpListener, initHelpShortcuts } from "./help.js";
import * as home from "./views/home.js";
import * as reader from "./views/reader.js";
import * as carryover from "./views/carryover.js";
import * as arrivals from "./views/arrivals.js";
import * as specials from "./views/specials.js";
import * as cash from "./views/cash.js";
import * as closing from "./views/closing.js";
import * as settings from "./views/settings.js";

const ASSETS = "public/assets/";
const $ = (id) => document.getElementById(id);

const VIEWS = { home, reader, carryover, arrivals, specials, cash, closing, settings };

export const app = {
  ym: null,        // 対象年月 'YYYYMM'（全タブ共通）
  engine: null,    // { model, backend } 認識エンジン（起動時に一度だけ初期化）
  currentView: "home",
  navigate(view) { location.hash = "#" + view; },
  async setYm(rawYm) {
    const ym = parseYm(rawYm);
    if (!ym) return;
    app.ym = ym;
    $("ymInput").value = formatYm(app.ym);
    await showView(app.currentView); // 表示中の画面を新しい年月で再描画
  },
};

async function showView(rawName) {
  let name = rawName;
  let subTab = null;
  if (name === "masters" || name === "backup") {
    subTab = name;
    name = "settings";
  }
  if (!VIEWS[name]) name = "home";
  app.currentView = name;
  for (const key of Object.keys(VIEWS)) {
    $(`view-${key}`).hidden = key !== name;
  }
  document.querySelectorAll("#nav a").forEach((a) =>
    a.classList.toggle("active", a.dataset.view === name));
  try {
    if (name === "settings" && subTab) {
      await VIEWS[name].show(subTab);
    } else {
      await VIEWS[name].show();
    }
  } catch (e) {
    console.error(`画面 ${name} の表示エラー:`, e);
    $(`view-${name}`).innerHTML = `<p class="err">画面の表示に失敗しました: ${e.message}</p>`;
  }
}

// 初回起動時: 同梱の設定CSVから商品マスタ v1 を作成（既存の紙の交換票に対応）
async function seedMastersIfEmpty() {
  const all = await getAllMasters();
  if (all.length) return;
  const config = await loadConfig(ASSETS);
  const roiRows = parseRoiCsv(await (await fetch(ASSETS + "ROI_coordinate.csv")).text());
  const products = await loadProducts(ASSETS);
  await putMaster({
    version: 1,
    label: "初期マスタ（現行の交換票）",
    effectiveFrom: "000000", // すべての月に適用
    createdAt: new Date().toISOString(),
    products,
    roiRows,
    config,
    layout: null, // v1 は既存CSVの座標をそのまま使用（レイアウトモデル未使用）
  });
}

async function waitCv() {
  const t0 = Date.now();
  while (!window.__CV_READY__ || typeof window.tf === "undefined" || typeof window.pdfjsLib === "undefined") {
    if (Date.now() - t0 > 30000) throw new Error("ライブラリ初期化タイムアウト");
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function init() {
  // 対象年月は起動のたびにルールから算出（手動変更はそのセッション内でのみ有効）
  app.ym = defaultYmByRule();
  $("ymInput").value = formatYm(app.ym);

  // 年月バー
  $("ymInput").addEventListener("change", () => {
    const v = $("ymInput").value.trim();
    const parsed = parseYm(v);
    if (parsed) {
      app.setYm(parsed);
    } else {
      $("ymInput").value = formatYm(app.ym);
    }
  });
  $("ymInput").addEventListener("focus", () => {
    $("ymInput").select();
  });
  $("ymPrev").addEventListener("click", () => app.setYm(ymShift(app.ym, -1)));
  $("ymNext").addEventListener("click", () => app.setYm(ymShift(app.ym, +1)));

  // ルーティング
  window.addEventListener("hashchange", () => showView(location.hash.slice(1) || "home"));

  // ヘルプ機能（取説・ヒントポップアップ）の初期化
  initGlobalHelpListener();
  initHelpShortcuts(() => app.currentView);

  // 各ビューの初期化（イベント紐付け）
  for (const v of Object.values(VIEWS)) {
    if (typeof v.init === "function") v.init(app);
  }

  // マスタのシード（初回のみ）→ 最初の画面を表示
  try {
    await seedMastersIfEmpty();
  } catch (e) {
    console.error("マスタ初期化エラー:", e);
  }
  await showView(location.hash.slice(1) || "home");

  // 認識エンジンの初期化（重いのでバックグラウンドで）
  try {
    reader.setLoadStatus("認識エンジン初期化中…");
    await waitCv();
    const backend = await initBackend();
    const model = await window.tf.loadLayersModel(ASSETS + "model/model.json");
    app.engine = { model, backend };
    reader.onEngineReady();
  } catch (e) {
    reader.setLoadStatus("初期化エラー: " + e.message);
    console.error(e);
  }
}

init();
