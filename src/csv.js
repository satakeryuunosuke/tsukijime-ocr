// save_to_csv_B.save_to_csv と同じ列順で CSV を生成する。
// これによりデスクトップ版の Excel 集計工程（recognition_results_*.csv を消費）へ
// そのまま受け渡せる（ハイブリッド運用の受け渡し点）。

// 列順: [日付(降順)] + [code_1, code_0] + [その他ROI(CSV順)] + [合計(降順)]
export function csvColumns(roiRows) {
  const names = roiRows.map((r) => r.name);
  const dates = names.filter((n) => n.startsWith("date_")).sort().reverse();   // date_1, date_0
  const totals = names.filter((n) => n.startsWith("total_")).sort().reverse(); // total_2, total_1
  const others = names.filter((n) => !n.startsWith("date_") && !n.startsWith("total_"));
  return [...dates, "code_1", "code_0", ...others, ...totals];
}

// rows: [{ predictions }]（recognizePage の ok 結果）
// code_1/code_0 は日付ごとの連番（デスクトップ版の date_counter 相当。処理順で採番）。
export function buildCsv(rows, roiRows) {
  const cols = csvColumns(roiRows);
  const counter = {};
  const lines = [cols.join(",")];

  for (const { predictions } of rows) {
    const d1 = predictions.date_1 ?? "";
    const d0 = predictions.date_0 ?? "";
    const dateStr = `${d1}${d0}`;
    const seq = (counter[dateStr] || 0) + 1;
    counter[dateStr] = seq;

    const row = { ...predictions, code_1: Math.floor(seq / 10), code_0: seq % 10 };
    const line = cols
      .map((c) => {
        const v = row[c];
        return v === undefined || v === null ? "" : String(v);
      })
      .join(",");
    lines.push(line);
  }
  return lines.join("\r\n");
}

// BOM 付き UTF-8 でダウンロード（Excel で文字化けしないように）
export function downloadCsv(csvText, filename) {
  const blob = new Blob(["﻿" + csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
