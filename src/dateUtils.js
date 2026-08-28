// 日付・年月に関するユーティリティ関数。
// 内部表現（DBキー・集計キー等）は 'YYYYMM' 形式の6桁文字列で一貫させ、
// UI表示・入力は「YYYY年MM月」形式（各種入力フォーマットのパースにも対応）とする。

/**
 * 'YYYYMM' 形式の文字列を 'YYYY年MM月' (例: '2026年07月') にフォーマットする。
 * @param {string} ym 'YYYYMM' 形式
 * @returns {string} 'YYYY年MM月'
 */
export function formatYm(ym) {
  if (!ym || typeof ym !== "string") return ym || "";
  const clean = ym.trim();
  if (!/^\d{6}$/.test(clean)) return ym;
  return `${clean.slice(0, 4)}年${clean.slice(4, 6)}月`;
}

/**
 * 日本語表記・区切り記号など様々な年月入力を 'YYYYMM' 形式にパース・正規化する。
 * 対応例:
 *   - '2026年07月', '2026年7月', '2026年07', '2026年7'
 *   - '202607', '20267'
 *   - '2026-07', '2026-7', '2026/07', '2026/7', '2026.07', '2026.7'
 *   - 全角数字（例: '２０２６年７月'）
 * @param {string} str
 * @returns {string|null} 6桁の 'YYYYMM' またはパース失敗時は null
 */
export function parseYm(str) {
  if (!str) return null;
  const s = String(str)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .trim();

  // 1) 6桁の数字: '202607'
  if (/^\d{6}$/.test(s)) {
    const y = parseInt(s.slice(0, 4), 10);
    const m = parseInt(s.slice(4, 6), 10);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12) {
      return `${y}${String(m).padStart(2, "0")}`;
    }
  }

  // 2) 5桁の数字: '20267' (2026年7月)
  if (/^\d{5}$/.test(s)) {
    const y = parseInt(s.slice(0, 4), 10);
    const m = parseInt(s.slice(4, 5), 10);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 9) {
      return `${y}${String(m).padStart(2, "0")}`;
    }
  }

  // 3) 年月表記・区切り文字: '2026年7月', '2026年07月', '2026-7', '2026/7', '2026.7', '2026 7'
  const match = s.match(/^(\d{4})\s*(?:年|[-/._\s])\s*(\d{1,2})\s*月?$/);
  if (match) {
    const y = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12) {
      return `${y}${String(m).padStart(2, "0")}`;
    }
  }

  return null;
}

/**
 * 指定年月から delta か月シフトした 'YYYYMM' を返す。
 * @param {string} ym 'YYYYMM'
 * @param {number} delta シフトする月数（正負可）
 * @returns {string} 'YYYYMM'
 */
export function ymShift(ym, delta) {
  if (!ym || ym.length !== 6) return ym;
  let y = parseInt(ym.slice(0, 4), 10);
  let m = parseInt(ym.slice(4, 6), 10) + delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}${String(m).padStart(2, "0")}`;
}

export function prevYm(ym) { return ymShift(ym, -1); }
export function nextYm(ym) { return ymShift(ym, 1); }

/**
 * 指定年月の日数を返す（1〜31）。
 * @param {string} ym 'YYYYMM'
 * @returns {number}
 */
export function daysInMonth(ym) {
  const y = parseInt(String(ym).slice(0, 4), 10);
  const m = parseInt(String(ym).slice(4, 6), 10);
  if (!y || !m || m < 1 || m > 12) return 31;
  return new Date(y, m, 0).getDate();
}

/**
 * 既定の対象年月をルールから算出:
 * 毎月15日〜翌月14日を「その月」とする（前月の棚卸を月初に行う運用）。
 * @param {Date} now
 * @returns {string} 'YYYYMM'
 */
export function defaultYmByRule(now = new Date()) {
  let y = now.getFullYear();
  let m = now.getMonth() + 1; // 1-12
  if (now.getDate() < 15) {
    m--;
    if (m < 1) { m = 12; y--; }
  }
  return `${y}${String(m).padStart(2, "0")}`;
}
