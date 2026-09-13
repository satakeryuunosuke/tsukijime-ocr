// システム全体のバージョン定義
export const APP_VERSION = "v28";

/**
 * バージョン番号の数値を抽出 (例: "v28" -> 28)
 * @param {string} [ver=APP_VERSION]
 * @returns {number}
 */
export function parseAppVersion(ver = APP_VERSION) {
  const m = String(ver).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

/**
 * バージョンの比較 (a > b なら正、a < b なら負、等しければ 0)
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareAppVersions(a, b) {
  return parseAppVersion(a) - parseAppVersion(b);
}
