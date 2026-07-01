// config.json を読み込み、Python の predictor_C.load_digit_config + inference 設定に対応する
// 値を返す。欠損時のデフォルトも Python 側と一致させる。
export async function loadConfig(assetsBase) {
  let cfg = {};
  try {
    cfg = await (await fetch(assetsBase + "config.json")).json();
  } catch (e) {
    console.warn("config.json 読み込み失敗、デフォルト使用:", e);
  }
  const dr = cfg.digit_recognition || {};
  const inf = cfg.inference || {};
  return {
    ink_threshold: dr.ink_threshold ?? 9,
    tens_place_min_ink: dr.tens_place_min_ink ?? 15,
    aspect_ratio_max: dr.aspect_ratio_max ?? 1.85,
    kernel_open_size: dr.kernel_open_size ?? [2, 2],
    kernel_close_size: dr.kernel_close_size ?? [3, 3],
    confidence_threshold: inf.confidence_threshold ?? 0.8,
    tens_place_valid_classes: inf.tens_place_valid_classes ?? [1, 2],
  };
}

// ROI_coordinate.csv（先頭にBOM、ヘッダ: ROI_name,x,y,h,w）をパースする。
// extractor_A.py はカラム名で読むため、位置ではなくヘッダ名で対応付ける。
export function parseRoiCsv(text) {
  const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
  const header = lines[0].split(",").map((s) => s.trim());
  const idx = (n) => header.indexOf(n);
  const iName = idx("ROI_name"), iX = idx("x"), iY = idx("y"), iH = idx("h"), iW = idx("w");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const p = lines[i].split(",");
    rows.push({
      name: p[iName].trim(),
      x: parseInt(p[iX], 10),
      y: parseInt(p[iY], 10),
      w: parseInt(p[iW], 10),
      h: parseInt(p[iH], 10),
    });
  }
  return rows;
}
