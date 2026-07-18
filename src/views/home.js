// ホームタブ。対象年月の作業進捗と各工程へのショートカットを表示する。
import { ensureMonth, getMaster } from "../db.js";
import { downloadReport } from "../excelReport.js";
import { openReportPreview } from "../reportPreview.js";

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

// 次にやるべき工程を1つ決めて、でかでかと表示するバナー
function nextAction(month) {
  const p = month.readerPending;
  const pendingN = p ? (p.fail || 0) + (p.ng || 0) + (p.low || 0) : 0;
  if (pendingN) {
    return {
      view: "reader", cls: "warn", title: "読み取りの要対応を解消する",
      desc: `未解決の読み取りが ${pendingN} 件あります（マーカー失敗 ${p.fail || 0}・検算/日付NG ${p.ng || 0}・低信頼度 ${p.low || 0}）。該当の交換票をもう一度読み取り、修正・確定してください。`,
    };
  }
  if (month.carryover === null)
    return { view: "carryover", cls: "", title: "繰越在庫を入力する", desc: "月初時点の在庫数を入力します。前月の帳簿残から自動入力できます。" };
  if (!month.pages.length)
    return { view: "reader", cls: "", title: "交換票を読み取る", desc: "交換票のスキャンPDFをAIで読み取り、確認して保存します。月内は何回かに分けてOK。" };
  // 現金のつじつまチェックはノート購入の記録を使うため、現金入力より先に案内する
  if (!(month.cash && month.cash.closing) && !(month.specials || []).length)
    return {
      view: "specials", cls: "", title: "ノート購入を記録する",
      desc: "現金・口座振替・栄冠ポイントでのノート購入を記録します。現金管理のつじつまチェックはこの記録を使うので、月末の現金入力より先に済ませてください（この月の購入がなければ、そのまま「5. 現金管理」へ進んでOK。グッズが届いた月は「3. 入庫」の記録もお忘れなく）。",
    };
  if (!(month.cash && month.cash.closing))
    return { view: "cash", cls: "", title: "月末の現金を数えて入力する", desc: "金庫の現金を金種別に数えて入力すると、売上とのつじつまを自動チェックします。" };
  if (month.physicalCount === null)
    return { view: "closing", cls: "", title: "実棚数を入力して棚卸する", desc: "実際に棚を数えて入力し、帳簿残との差異を確認します。" };
  return { view: "closing", cls: "done", title: "この月の作業は完了しています ✓", desc: "下のボタンからExcelレポートをダウンロード（またはプレビュー）して本部に報告してください。" };
}

export async function show() {
  const ym = app.ym;
  const month = await ensureMonth(ym);
  const master = await getMaster(month.masterVersion);
  const y = ym.slice(0, 4), m = parseInt(ym.slice(4, 6), 10);

  const pagesN = month.pages.length;
  const carryoverDone = month.carryover !== null;
  const arrivalDays = Object.keys(month.arrivals || {}).length;
  const specialsN = (month.specials || []).length;
  const cashDone = !!(month.cash && month.cash.closing);
  const physDone = month.physicalCount !== null;
  const p = month.readerPending;
  const pendingN = p ? (p.fail || 0) + (p.ng || 0) + (p.low || 0) : 0;
  const na = nextAction(month);

  const readerStatus = pendingN
    ? `<span class="err">要対応 ${pendingN} 件</span>`
    : (pagesN ? `保存済み ${pagesN} 枚` : "未読み取り");

  el().innerHTML = `
    <h2 class="view-title">${y}年${m}月 の月締め</h2>
    <a class="home-next ${na.cls}" href="#${na.view}">
      <div class="hn-label">次にやること</div>
      <div class="hn-title">${na.title}</div>
      <p class="hn-desc">${na.desc}</p>
    </a>
    ${physDone && master ? `
    <div class="row-actions">
      <button id="homeReport" class="btn btn-secondary">Excelレポート（report_${ym}.xlsx）</button>
      <button id="homePreview" class="btn-sub">レポートをブラウザで見る</button>
    </div>` : ""}
    <p class="view-sub">上から順に進めると月締めが完了します。使用マスタ: v${month.masterVersion}${master ? `（${master.label || ""}・商品${master.products.length}件）` : ""}</p>
    <div class="home-grid">
      ${card("carryover", "1. 繰越在庫", carryoverDone ? "入力済み ✓" : "未入力",
        carryoverDone, "月初時点の在庫数。前月の帳簿残から自動入力できます。")}
      ${card("reader", "2. 交換票の読み取り", readerStatus,
        pagesN > 0 && !pendingN, "交換票のスキャンPDFをAIで読み取り、確認・訂正して保存します。月内は何回かに分けてOK。")}
      ${card("arrivals", "3. 入庫の記録", arrivalDays ? `${arrivalDays} 日分入力` : "入庫なし/未入力",
        arrivalDays > 0, "グッズが届いたら日付ごとに個数を記録します。")}
      ${card("specials", "4. ノート購入", specialsN ? `${specialsN} 件` : "0 件",
        specialsN > 0, "現金・口座振替・栄冠ポイントでのノート購入を手入力します。")}
      ${card("cash", "5. 現金管理", cashDone ? "月末現金入力済み ✓" : "未入力",
        cashDone, "月末に金庫の現金を数えて入力すると、ノートの現金売上とのつじつまを自動チェックします。本部報告用の日別金種表も作れます。")}
      ${card("closing", "6. 月締め（棚卸）", physDone ? "実棚入力済み ✓" : "未実施",
        physDone, "日別台帳と月末の帳簿残を確認し、実際の在庫数と突き合わせてExcelレポートを出力します。")}
    </div>
    <div class="home-links">
      <a href="#masters">商品の入れ替え・交換票の印刷 →</a>
      <a href="#backup">バックアップ・引き継ぎ（データ管理） →</a>
    </div>`;

  const repBtn = el().querySelector("#homeReport");
  if (repBtn) repBtn.addEventListener("click", async () => {
    repBtn.disabled = true;
    try {
      await downloadReport(month, master.products);
    } catch (err) {
      alert("レポート生成に失敗しました: " + err.message);
      console.error(err);
    } finally {
      repBtn.disabled = false;
    }
  });
  const prevBtn = el().querySelector("#homePreview");
  if (prevBtn) prevBtn.addEventListener("click", () => openReportPreview(month, master.products));
}
