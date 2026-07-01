// CSV 生成（人が読みやすい形式）。
// 列: 日付, 連番, <商品ごとに1列（日本語名・値は個数）>, 合計点数
// ※ デスクトップ版 recognition_results_*.csv（_0/_1 の2列構成）とは非互換。
import { qtyOf, toInt, computeTotalScore } from "./validate.js";

function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// rows: [{ predictions }]（recognizePage / 訂正済みの結果）
// products: [{ key, name, points }]（product_list.csv 由来。列の順序・日本語名に使用）
export function buildCsv(rows, products) {
  const header = ["日付", "連番", ...products.map((p) => p.name), "合計点数"];
  const counter = {};
  const lines = [header.map(csvCell).join(",")];

  for (const { predictions } of rows) {
    const day = toInt(predictions.date_1) * 10 + toInt(predictions.date_0);
    const dateStr = `${predictions.date_1 ?? ""}${predictions.date_0 ?? ""}`;
    const seq = (counter[dateStr] || 0) + 1;
    counter[dateStr] = seq;

    const cells = [
      day || "",
      seq,
      ...products.map((p) => qtyOf(predictions, p.key) || ""),
      computeTotalScore(predictions, products) || "",
    ];
    lines.push(cells.map(csvCell).join(","));
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
