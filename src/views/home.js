import { ensureMonth, getMaster, putMonth } from "../db.js";
import { downloadReport } from "../excelReport.js";
import { openReportPreview } from "../reportPreview.js";
import { APP_VERSION } from "../version.js";
import { formatYm } from "../dateUtils.js";
import { helpBtn } from "../help.js";
import { toast } from "../toast.js";

let app = null;
const el = () => document.getElementById("view-home");

const VIEW_HELP_MAP = {
  carryover: "carryover_overview",
  reader: "reader_overview",
  arrivals: "arrivals_overview",
  specials: "specials_overview",
  cash: "cash_overview",
  closing: "closing_overview",
};

function card(view, title, status, ok, desc) {
  const helpKey = VIEW_HELP_MAP[view] || "home_overview";
  return `
    <a class="home-card ${ok ? "done" : ""}" href="#${view}">
      <div class="hc-head">
        <span class="hc-title">${title} ${helpBtn(helpKey, { size: "sm", title: `${title}の取説・ヒントを見る` })}</span>
        <span class="hc-status">${status}</span>
      </div>
      <p class="hc-desc">${desc}</p>
    </a>`;
}

export function init(appRef) { app = appRef; }

// 次にやるべき工程を1つ決めて、でかでかと表示するバナー
function nextAction(month) {
  if (month.locked) {
    return {
      view: "closing", cls: "done", title: "月締め確定済み（ロック中） 🔒",
      desc: "この月の月締め作業は完了し、データはロックされています。Excelレポートのダウンロードやバックアップの保存が可能です。",
      btnLabel: "月締め画面を見る →",
    };
  }
  const p = month.readerPending;
  const pendingN = p ? (p.fail || 0) + (p.ng || 0) + (p.low || 0) : 0;
  if (pendingN) {
    return {
      view: "reader", cls: "warn", title: "読み取りの要対応を解消する",
      desc: `未解決の読み取りが ${pendingN} 件あります（マーカー失敗 ${p.fail || 0}・検算/日付NG ${p.ng || 0}・低信頼度 ${p.low || 0}）。該当の交換票をもう一度読み取り、修正・確定してください。`,
      btnLabel: "要対応を確認する →",
    };
  }
  if (month.carryover === null)
    return {
      view: "carryover", cls: "", title: "繰越在庫を入力する",
      desc: "月初時点の在庫数を入力します。前月の帳簿残から自動入力できます。",
      btnLabel: "繰越在庫を入力する →",
    };
  if (!month.pages.length && !month.readerSkipped)
    return {
      view: "reader", cls: "", title: "交換票を読み取る",
      desc: "交換票のスキャンPDFをAIで読み取り、確認して保存します。月内は何回かに分けてOK。",
      btnLabel: "交換票を読み取る →",
    };

  // 入庫の記録
  const arrivalDays = Object.keys(month.arrivals || {}).length;
  const arrivalsHandled = arrivalDays > 0 || !!month.arrivalsSkipped;
  if (!arrivalsHandled) {
    return {
      view: "arrivals", cls: "",
      title: "入庫を記録する",
      desc: "今月届いたグッズ（納品・仕入）がある場合は日付と個数を記録します。",
      btnLabel: "入庫を入力する →",
    };
  }

  // ノート購入の記録
  const specialsCount = (month.specials || []).length;
  const specialsHandled = specialsCount > 0 || !!month.specialsSkipped;
  if (!specialsHandled) {
    return {
      view: "specials", cls: "",
      title: "ノート購入を記録する",
      desc: "現金・口座振替・栄冠ポイントでのノート購入を記録します。現金管理のつじつまチェックはこの記録を使うので、月末の現金入力より先に済ませてください。",
      btnLabel: "ノート購入を記録する →",
    };
  }

  if (!(month.cash && month.cash.closing))
    return {
      view: "cash", cls: "",
      title: "月末の現金を数えて入力する",
      desc: "金庫の現金を金種別に数えて入力すると、売上とのつじつまを自動チェックします。",
      btnLabel: "現金管理を開く →",
    };
  if (month.physicalCount === null)
    return {
      view: "closing", cls: "",
      title: "実棚数を入力して棚卸する",
      desc: "実際に棚を数えて入力し、帳簿残との差異を確認します。",
      btnLabel: "実棚数を入力する →",
    };
  return {
    view: "closing", cls: "warn",
    title: "月締めを確定（ロック）する 🔒",
    desc: "実棚数の保存が完了しています。Excelレポートを確認後、「月締め」画面から締め確定（ロック）を行ってください。",
    btnLabel: "月締め確定画面へ →",
  };
}

export async function show() {
  const ym = app.ym;
  const month = await ensureMonth(ym);
  const master = await getMaster(month.masterVersion);
  const isLocked = !!month.locked;

  const pagesN = month.pages.length;
  const isReaderSkipped = !!month.readerSkipped;
  const carryoverDone = month.carryover !== null;
  const arrivalDays = Object.keys(month.arrivals || {}).length;
  const isArrivalsSkipped = !!month.arrivalsSkipped;
  const arrivalsDone = arrivalDays > 0 || isArrivalsSkipped;
  const specialsN = (month.specials || []).length;
  const isSpecialsSkipped = !!month.specialsSkipped;
  const specialsDone = specialsN > 0 || isSpecialsSkipped;
  const cashDone = !!(month.cash && month.cash.closing);
  const physDone = month.physicalCount !== null;
  const p = month.readerPending;
  const pendingN = p ? (p.fail || 0) + (p.ng || 0) + (p.low || 0) : 0;
  const na = nextAction(month);

  const readerStatus = pendingN
    ? `<span class="err">要対応 ${pendingN} 件</span>`
    : (pagesN ? `保存済み ${pagesN} 枚` : (isReaderSkipped ? "交換票なし（スキップ済） ✓" : "未読み取り"));

  const arrivalsStatus = arrivalDays
    ? `${arrivalDays} 日分入力`
    : (isArrivalsSkipped ? "入庫なし（スキップ済） ✓" : "未入力");

  const specialsStatus = specialsN
    ? `${specialsN} 件`
    : (isSpecialsSkipped ? "購入なし（スキップ済） ✓" : "未入力");

  const closingStatus = isLocked
    ? "締め確定（ロック中） 🔒"
    : (physDone ? "実棚入力済み ✓" : "未実施");

  el().innerHTML = `
    <h2 class="view-title">
      ${formatYm(ym)} の月締め${isLocked ? '<span class="lock-badge">🔒 締め確定済み</span>' : ""}
      ${helpBtn("home_overview", { size: "lg", title: "月締め全体の流れとホーム画面の使い方" })}
    </h2>
    <a class="home-next ${na.cls}" href="#${na.view}">
      <div class="hn-label">
        次にやること
        ${helpBtn("home_next_action", { size: "sm", title: "「次にやること」バナーの仕組み・判定基準" })}
      </div>
      <div class="hn-title">${na.title}</div>
      <p class="hn-desc">${na.desc}</p>
      <div class="hn-btn-group">
        <span class="hn-btn hn-btn-primary">${na.btnLabel || "進む →"}</span>
      </div>
    </a>
    ${physDone && master ? `
    <div class="row-actions">
      <button id="homeReport" class="btn btn-secondary">Excelレポート（report_${ym}.xlsx）</button>
      <button id="homePreview" class="btn-sub">レポートをブラウザで見る</button>
      ${helpBtn("home_report_preview", { size: "sm", title: "Excelレポート出力とプレビューについて" })}
    </div>` : ""}
    <p class="view-sub">上から順に進めると月締めが完了します。使用マスタ: v${month.masterVersion}${master ? `（${master.label || ""}・商品${master.products.length}件）` : ""}</p>
    <div class="home-grid">
      ${card("carryover", "1. 繰越在庫", carryoverDone ? "入力済み ✓" : "未入力",
        carryoverDone, "月初時点の在庫数。前月の帳簿残から自動入力できます。")}
      ${card("reader", "2. 交換票の読み取り", readerStatus,
        (pagesN > 0 && !pendingN) || isReaderSkipped, "交換票のスキャンPDFをAIで読み取り、確認・訂正して保存します。月内は何回かに分けてOK。")}
      ${card("arrivals", "3. 入庫の記録", arrivalsStatus,
        arrivalsDone, "グッズが届いたら日付ごとに個数を記録します。")}
      ${card("specials", "4. ノート購入", specialsStatus,
        specialsDone, "現金・口座振替・栄冠ポイントでのノート購入を手入力します。")}
      ${card("cash", "5. 現金管理", cashDone ? "月末現金入力済み ✓" : "未入力",
        cashDone, "月末に金庫の現金を数えて入力すると、ノートの現金売上とのつじつまを自動チェックします。本部報告用の日別金種表も作れます。")}
      ${card("closing", "6. 月締め（棚卸）", closingStatus,
        physDone, "日別台帳と月末の帳簿残を確認し、実際の在庫数と突き合わせてExcelレポートを出力・月締め確定します。")}
    </div>
    <div class="home-links">
      <a href="#settings">システム設定（検算桁数・商品マスタ・データ管理） →</a>
    </div>
    <div class="home-footer">
      <span class="home-version">システムバージョン: ${APP_VERSION}</span>
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
