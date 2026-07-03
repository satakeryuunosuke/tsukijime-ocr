// ホームタブ。対象年月の作業進捗と各工程へのショートカットを表示する。
import { ensureMonth, getMaster } from "../db.js";

let app = null;
const el = () => document.getElementById("view-home");

function card(view, title, status, ok, desc) {
  return `
    <a class="home-card ${ok ? "done" : ""}" href="#${view}">
      <div class="hc-head"><span class="hc-title">${title}</span><span class="hc-status">${status}</span></div>
      <p class="hc-desc">${desc}</p>
    </a>`;
}

export function init(appRef) { app = appRef; }

export async function show() {
  const ym = app.ym;
  const month = await ensureMonth(ym);
  const master = await getMaster(month.masterVersion);
  const y = ym.slice(0, 4), m = parseInt(ym.slice(4, 6), 10);

  const pagesN = month.pages.length;
  const carryoverDone = month.carryover !== null;
  const arrivalDays = Object.keys(month.arrivals || {}).length;
  const specialsN = (month.specials || []).length;
  const physDone = month.physicalCount !== null;

  el().innerHTML = `
    <h2 class="view-title">${y}年${m}月 の月締め</h2>
    <p class="view-sub">上から順に進めると月締めが完了します。使用マスタ: v${month.masterVersion}${master ? `（${master.label || ""}・商品${master.products.length}件）` : ""}</p>
    <div class="home-grid">
      ${card("carryover", "1. 繰越在庫", carryoverDone ? "入力済み ✓" : "未入力",
        carryoverDone, "月初時点の在庫数。前月の帳簿残から自動入力できます。")}
      ${card("reader", "2. 交換票の読み取り", pagesN ? `保存済み ${pagesN} 枚` : "未読み取り",
        pagesN > 0, "交換票のスキャンPDFをAIで読み取り、確認・訂正して保存します。月内は何回かに分けてOK。")}
      ${card("arrivals", "3. 入庫の記録", arrivalDays ? `${arrivalDays} 日分入力` : "入庫なし/未入力",
        arrivalDays > 0, "本部からグッズが届いたら日付ごとに個数を記録します。")}
      ${card("specials", "4. ノート特別交換", specialsN ? `${specialsN} 件` : "0 件",
        specialsN > 0, "現金・口座振替・栄冠ポイントでのノート交換を手入力します。")}
      ${card("closing", "5. 月締め（棚卸）", physDone ? "実棚入力済み ✓" : "未実施",
        physDone, "日別台帳と月末の帳簿残を確認し、実際の在庫数と突き合わせてExcelレポートを出力します。")}
    </div>
    <div class="home-links">
      <a href="#masters">商品の入れ替え・交換票の印刷 →</a>
      <a href="#backup">バックアップ・引き継ぎ（データ管理） →</a>
    </div>`;
}
