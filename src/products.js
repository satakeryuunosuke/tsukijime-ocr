// product_list.csv を読み込む（検算の単価・手動入力の日本語名に使用）。
// 列: code, product_key, japanese_name, point_values
export function parseProductCsv(text) {
  const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
  const header = lines[0].split(",").map((s) => s.trim());
  const iCode = header.indexOf("code");
  const iKey = header.indexOf("product_key");
  const iName = header.indexOf("japanese_name");
  const iPts = header.indexOf("point_values");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const p = lines[i].split(",");
    rows.push({
      code: p[iCode]?.trim(),
      key: p[iKey].trim(),
      name: p[iName].trim(),
      points: parseInt(p[iPts], 10),
    });
  }
  return rows;
}

export async function loadProducts(assetsBase) {
  const text = await (await fetch(assetsBase + "product_list.csv")).text();
  return parseProductCsv(text);
}
