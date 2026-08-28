// AI相談用状況レポート生成・クリップボードコピーモジュール
// 現在の画面・対象年月・集計サマリ・エラーログ・システム仕様(README)をMarkdown形式で出力する。
// 個人情報（生徒名・個人名・備考本文等）は完全に除外。

import { APP_VERSION } from "./version.js";
import { getMonth, getAllMasters, masterForYm } from "./db.js";
import { formatYm } from "./dateUtils.js";
import { toast } from "./toast.js";

// 直近のエラー・警告ログを記録するリングバッファ
const MAX_LOGS = 15;
const logBuffer = [];

// 日本語の画面名マッピング
const VIEW_NAMES = {
  home: "ホーム（進行管理ダッシュボード）",
  reader: "読み取り（AI-OCR 交換票スキャン・訂正）",
  carryover: "繰越在庫（前月からの繰越数入力）",
  arrivals: "入庫（仕入・納品データの入力）",
  specials: "ノート購入（現金/口座振替/ポイント購入入力）",
  cash: "現金管理（金種計算・レジ金実査）",
  closing: "月締め（棚卸表・実棚数入力・差異自動調整・Excel出力）",
  settings: "設定（商品マスタ・交換票Excel・データ管理）",
};

/**
 * グローバルエラーロガーの初期化
 */
export function initErrorLogger() {
  const pushLog = (level, message, detail = null) => {
    const timestamp = new Date().toLocaleTimeString("ja-JP", { hour12: false });
    logBuffer.push({
      time: timestamp,
      level,
      message: String(message || ""),
      detail: detail ? String(detail).slice(0, 300) : null,
    });
    if (logBuffer.length > MAX_LOGS) {
      logBuffer.shift();
    }
  };

  // console.error のフック
  const origError = console.error;
  console.error = function (...args) {
    origError.apply(console, args);
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    pushLog("ERROR", msg);
  };

  // console.warn のフック
  const origWarn = console.warn;
  console.warn = function (...args) {
    origWarn.apply(console, args);
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    pushLog("WARN", msg);
  };

  // 未捕捉例外
  window.addEventListener("error", (e) => {
    pushLog("UNCAUGHT", e.message, e.filename ? `${e.filename}:${e.lineno}` : null);
  });

  // Promiseの未捕捉拒否
  window.addEventListener("unhandledrejection", (e) => {
    pushLog("REJECTION", e.reason?.message || e.reason);
  });
}

/**
 * アプリ仕様書・アーキテクチャ概要（README本文）
 */
const SYSTEM_SPEC_README = `## 附録: システム仕様・アーキテクチャ概要（README）

### 1. システム概要
- **名称**: グッズ交換・月締めシステム（PWA）
- **目的**: 学習塾・教室等におけるグッズ交換の月締め（棚卸・受払台帳・Excelレポート出力）業務をブラウザ完結で実行するシステム。
- **特徴**: 完全端末内処理（IndexedDB）。サーバ通信・外部API送信なし。オフライン対応（ServiceWorkerキャッシュ）。

### 2. 主要機能と業務フロー
1. **読み取り (AI-OCR)**:
   - スキャンした交換票 (PDF/画像) を OpenCV.js（台形補正 1000x707）+ TensorFlow.js（数字セグメント 28x28 バッチ推論）で自動認識。
   - 検算（商品単価×個数合計 == 記入合計欄）および日付妥当性（当月内か）をチェック。
   - マーカー検出失敗時のパラメータ調整スライダー・四隅手動タップ救済機能を装備。
   - ✓OKの確定結果は IndexedDB（months）へ自動保存。
2. **繰越在庫**:
   - 前月末の実棚数を当月の繰越在庫として設定。
3. **入庫**:
   - 日付ごとの商品仕入・納品個数を記録。
4. **ノート購入 (特殊売上)**:
   - 現金 / 口座振替 / ポイントでの購入（出庫）記録。
5. **現金管理**:
   - 金種別枚数入力（10,000円〜1円）による前月繰越金・月末実査残高の計算および出金記録。
6. **月締め (棚卸・レポート)**:
   - 日次台帳計算: \`当日残高 = 前日残高 + 入庫 − 交換出庫 − ノート購入出庫\`
   - 棚卸表: 帳簿在庫 vs 実棚数の差異を突合。
   - 差異の自動調整: 不足分（帳簿＞実棚）のみ、検算が成立する交換記録を自動生成して帳簿を実棚に合致させる（余剰分は隠し在庫として調整対象外）。
   - Excelレポート（.xlsx）出力: ExcelJSを用いて公式帳票レイアウトを動的生成。
7. **商品マスタ & 交換票**:
   - バージョン管理された商品マスタ（商品ID、名称、単価ポイント）。
   - Excel交換票（.xlsx）からROI枠座標を自動抽出。

### 3. データ構造 (IndexedDB: tsukijime)
- **months (key: YYYYMM)**:
  - \`ym\`: 対象年月 (例: "202608")
  - \`masterVersion\`: 適用マスタ版
  - \`pages\`: 確定済みOCR結果配列
  - \`carryover\`: \`{ [productKey]: qty }\`
  - \`arrivals\`: \`{ [day]: { [productKey]: qty } }\`
  - \`specials\`: \`[{ id, day, method('cash'|'debit'|'point'), qty: { ... } }]\`
  - \`physicalCount\`: \`{ [productKey]: qty }\` (月末実棚数)
  - \`cash\`: \`{ opening, closing: {金種:枚数}, withdrawals: [...] }\`
  - \`locked\`: 月締めロック状態 (boolean)
- **masters (key: version)**:
  - \`version\`, \`effectiveFrom\`, \`products[]\`, \`roiRows[]\`, \`config\`
- **settings (key: key)**: 各種ユーザー設定`;

/**
 * AI相談用のMarkdownレポート文字列を生成する
 * （個人情報は完全除外）
 */
export async function buildAiReport(app, userQuestion = "") {
  const ym = app.ym || "未設定";
  const formattedYm = app.ym ? formatYm(app.ym) : "未設定";
  const currentViewId = app.currentView || "home";
  const currentViewName = VIEW_NAMES[currentViewId] || currentViewId;
  const nowStr = new Date().toLocaleString("ja-JP", { hour12: false });

  // 1. 環境・システム情報
  const isPwa = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isOnline = navigator.onLine;
  const userAgent = navigator.userAgent;
  const screenSize = `${window.innerWidth}x${window.innerHeight} (Screen: ${window.screen.width}x${window.screen.height})`;
  const engineStatus = app.engine ? "✓ 正常初期化済み (TensorFlow.js + OpenCV)" : "⚠ 未初期化または初期化中";

  // 2. データベース（当月データ）のサマリ取得（個人情報は完全排除）
  let monthSummaryText = "（当月データなし）";
  let masterSummaryText = "（マスタ情報なし）";

  try {
    const month = await getMonth(ym);
    const activeMaster = await masterForYm(ym);

    if (activeMaster) {
      const productCount = activeMaster.products ? activeMaster.products.length : 0;
      masterSummaryText = `マスタ版: v${activeMaster.version} (登録商品数: ${productCount}品目, 適用開始: ${activeMaster.effectiveFrom})`;
    }

    if (month) {
      // 確定OCRページ集計
      const pageCount = month.pages ? month.pages.length : 0;
      const pendingInfo = month.readerPending
        ? ` (要対応: ${month.readerPending.fail || 0}件, 合計不一致: ${month.readerPending.ng || 0}件, 低信頼度: ${month.readerPending.low || 0}件)`
        : "";

      // 繰越在庫
      const carryoverSet = !!month.carryover;
      const carryoverItems = month.carryover ? Object.keys(month.carryover).length : 0;

      // 入庫
      const arrivalDays = month.arrivals ? Object.keys(month.arrivals).length : 0;
      let arrivalTotalQty = 0;
      if (month.arrivals) {
        for (const day of Object.keys(month.arrivals)) {
          for (const q of Object.values(month.arrivals[day] || {})) {
            arrivalTotalQty += Number(q) || 0;
          }
        }
      }

      // ノート購入
      const specialsCount = month.specials ? month.specials.length : 0;
      const specialMethods = { cash: 0, debit: 0, point: 0 };
      if (month.specials) {
        for (const s of month.specials) {
          if (specialMethods[s.method] !== undefined) specialMethods[s.method]++;
        }
      }

      // 現金管理
      let cashStatus = "未入力";
      if (month.cash) {
        const hasClosing = !!month.cash.closing;
        cashStatus = hasClosing ? "実査入力済み" : "開始残高のみ設定";
      }

      // 月締め・実棚数
      const physicalSet = !!month.physicalCount;
      const physicalItems = month.physicalCount ? Object.keys(month.physicalCount).length : 0;
      const isLocked = !!month.locked;

      monthSummaryText = [
        `- **月締めロック状態**: ${isLocked ? `🔒 確定・ロック済み (${month.lockedAt || ""})` : "🔓 未確定（編集中）"}`,
        `- **交換票 (OCR)**: 確定 ${pageCount} 件${pendingInfo}`,
        `- **繰越在庫**: ${carryoverSet ? `入力済み (${carryoverItems} 品目)` : "未入力 ⚠"}`,
        `- **入庫データ**: ${arrivalDays} 日分登録 (合計 ${arrivalTotalQty} 点)`,
        `- **ノート購入**: 合計 ${specialsCount} 件 (現金: ${specialMethods.cash}, 口座振替: ${specialMethods.debit}, ポイント: ${specialMethods.point})`,
        `- **現金出納**: ${cashStatus}`,
        `- **実棚数 (月末)**: ${physicalSet ? `入力済み (${physicalItems} 品目)` : "未入力 ⚠"}`,
      ].join("\n");
    }
  } catch (e) {
    monthSummaryText = `（データ読み込みエラー: ${e.message}）`;
  }

  // 3. 直近のエラーログ整形
  let logsText = "（直近のエラー・警告なし）";
  if (logBuffer.length > 0) {
    logsText = logBuffer
      .map((l) => `- \`[${l.time}] [${l.level}]\` ${l.message}${l.detail ? ` (${l.detail})` : ""}`)
      .join("\n");
  }

  // 4. ユーザー質問セクション
  const questionSection = userQuestion.trim()
    ? `## 相談内容・質問\n${userQuestion.trim()}\n`
    : `## 相談内容・質問\n（※ここに「○○でエラーが出る」「計算結果の差異の原因は？」などの質問を入力してAIに送信してください）\n`;

  // 5. マークダウン全体の組み立て
  const report = `# 【グッズ交換・月締めシステム】アプリ状況レポート（AI相談用）

> **[個人情報保護について]**
> 本レポートには生徒名・個人名・担当者名・自由記述備考などの個人情報は一切含まれていません（システム・集計統計情報のみ）。

- **レポート生成日時**: ${nowStr}
- **アプリバージョン**: ${APP_VERSION}
- **ブラウザ / OS**: ${userAgent}
- **画面解像度**: ${screenSize}
- **ネットワーク / PWA**: ${isOnline ? "オンライン" : "オフライン"} / ${isPwa ? "PWAモード (Standalone)" : "ブラウザタブ"}
- **認識エンジン状態**: ${engineStatus}
- **適用商品マスタ**: ${masterSummaryText}

---

## 1. 現在の画面と選択状態
- **表示中の画面**: ${currentViewName} (\`#${currentViewId}\`)
- **選択中の対象年月**: ${formattedYm} (\`${ym}\`)

---

## 2. 対象年月のデータ状況サマリ（個人情報除外・集計値のみ）
${monthSummaryText}

---

## 3. アプリケーション直近ログ (エラー/警告 直近${logBuffer.length}件)
${logsText}

---

${questionSection}

---

${SYSTEM_SPEC_README}
`;

  return report;
}

/**
 * クリップボードにAIレポートをコピーする
 */
export async function copyAiReportToClipboard(app, userQuestion = "", showToastNotice = true) {
  try {
    const reportText = await buildAiReport(app, userQuestion);
    await navigator.clipboard.writeText(reportText);
    if (showToastNotice) {
      toast("🤖 AI相談用レポートをコピーしました（個人情報除外・仕様書同梱）");
    }
    return true;
  } catch (err) {
    console.error("クリップボードへのコピーに失敗しました:", err);
    // フォールバック: textarea経由
    try {
      const reportText = await buildAiReport(app, userQuestion);
      const ta = document.createElement("textarea");
      ta.value = reportText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      if (showToastNotice) {
        toast("🤖 AI相談用レポートをコピーしました（個人情報除外・仕様書同梱）");
      }
      return true;
    } catch (e2) {
      alert("クリップボードへのコピーに失敗しました。ブラウザの権限設定をご確認ください。");
      return false;
    }
  }
}

/**
 * AI相談モーダル（質問入力 ＆ プレビュー ＆ キーボード操作対応）を表示
 */
export function openAiReportModal(app) {
  // 既存のモーダルがあれば削除
  const existing = document.getElementById("aiReportModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "aiReportModal";
  modal.className = "ai-modal-overlay";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "aiModalTitle");

  modal.innerHTML = `
    <div class="ai-modal-card">
      <div class="ai-modal-header">
        <div class="ai-modal-title-wrap">
          <span class="ai-modal-icon">🤖</span>
          <div>
            <h3 id="aiModalTitle" class="ai-modal-title">AI相談用レポートの作成・コピー</h3>
            <p class="ai-modal-subtitle">現在の画面・データ状況・エラーログ・仕様書をまとめてAI（ChatGPT/Claude等）に送信できます</p>
          </div>
        </div>
        <button type="button" class="ai-modal-close" id="aiModalCloseBtn" title="閉じる (Esc)">✕</button>
      </div>

      <div class="ai-modal-body">
        <div class="ai-modal-privacy-badge">
          🛡 <strong>個人情報保護</strong>: 生徒名・個人名・手書き氏名・自由記述備考は<strong>完全に除外</strong>されます（集計統計と仕様のみ出力）。
        </div>

        <div class="ai-form-group">
          <label for="aiUserQuestion" class="ai-form-label">
            AIへの質問・困っていること <span class="ai-optional">（省略可・後からチャットに入力してもOK）</span>
          </label>
          <textarea
            id="aiUserQuestion"
            class="ai-textarea"
            rows="3"
            placeholder="例: 月締めで¥200の差異が出ている原因を調べたい / 読み取りが途中で止まってしまう / Excelレポートの数式を確認したい 等"
          ></textarea>
        </div>

        <div class="ai-preview-toggle-wrap">
          <button type="button" id="aiPreviewToggleBtn" class="ai-btn-text">▶ 出力内容のプレビューを表示</button>
        </div>
        <div id="aiPreviewBox" class="ai-preview-box" hidden>
          <pre id="aiPreviewContent" class="ai-preview-pre"></pre>
        </div>
      </div>

      <div class="ai-modal-footer">
        <div class="ai-shortcut-hint">
          <kbd>Ctrl</kbd> + <kbd>Enter</kbd> でコピーして閉じる / <kbd>Esc</kbd> で閉じる
        </div>
        <div class="ai-footer-actions">
          <button type="button" class="btn btn-secondary" id="aiModalCancelBtn">キャンセル</button>
          <button type="button" class="btn btn-primary ai-copy-main-btn" id="aiModalCopyBtn">
            📋 クリップボードにコピー
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const questionInput = modal.querySelector("#aiUserQuestion");
  const copyBtn = modal.querySelector("#aiModalCopyBtn");
  const cancelBtn = modal.querySelector("#aiModalCancelBtn");
  const closeBtn = modal.querySelector("#aiModalCloseBtn");
  const previewToggleBtn = modal.querySelector("#aiPreviewToggleBtn");
  const previewBox = modal.querySelector("#aiPreviewBox");
  const previewContent = modal.querySelector("#aiPreviewContent");

  const closeModal = () => {
    modal.classList.add("fade-out");
    setTimeout(() => modal.remove(), 150);
  };

  // プレビューの更新
  const updatePreview = async () => {
    if (!previewBox.hidden) {
      const text = await buildAiReport(app, questionInput.value);
      previewContent.textContent = text;
    }
  };

  previewToggleBtn.addEventListener("click", async () => {
    previewBox.hidden = !previewBox.hidden;
    previewToggleBtn.textContent = previewBox.hidden
      ? "▶ 出力内容のプレビューを表示"
      : "▼ 出力内容のプレビューを隠す";
    if (!previewBox.hidden) {
      await updatePreview();
    }
  });

  questionInput.addEventListener("input", () => {
    if (!previewBox.hidden) updatePreview();
  });

  // コピー実行
  const doCopy = async () => {
    copyBtn.disabled = true;
    copyBtn.textContent = "コピー中…";
    const ok = await copyAiReportToClipboard(app, questionInput.value, true);
    if (ok) {
      closeModal();
    } else {
      copyBtn.disabled = false;
      copyBtn.textContent = "📋 クリップボードにコピー";
    }
  };

  copyBtn.addEventListener("click", doCopy);
  cancelBtn.addEventListener("click", closeModal);
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // キーボードショートカット操作
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doCopy();
    }
  });

  // フォーカス
  setTimeout(() => questionInput.focus(), 50);
}
