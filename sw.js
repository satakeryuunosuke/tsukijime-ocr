// Service Worker: アプリシェルと全アセット（OpenCV.js/tfjs/モデル/設定）を
// プリキャッシュし、オフラインでも完全動作させる。
// モデルや辞書を更新したら CACHE 名のバージョンを上げること。
const CACHE = "tsukijime-ocr-v11";

const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  // アプリコード
  "./src/main.js",
  "./src/config.js",
  "./src/backend.js",
  "./src/pdf.js",
  "./src/pipeline.js",
  "./src/markerDetector.js",
  "./src/geometry.js",
  "./src/extractor.js",
  "./src/segmenter.js",
  "./src/predictor.js",
  "./src/csv.js",
  "./src/styles.css",
  "./src/products.js",
  "./src/validate.js",
  "./src/overlay.js",
  "./src/review.js",
  "./src/db.js",
  "./src/ledger.js",
  "./src/excelReport.js",
  "./src/roiEditor.js",
  "./src/xlsxForm.js",
  "./src/views/home.js",
  "./src/views/reader.js",
  "./src/views/carryover.js",
  "./src/views/arrivals.js",
  "./src/views/specials.js",
  "./src/views/closing.js",
  "./src/views/masters.js",
  "./src/views/backup.js",
  // ライブラリ（同梱）
  "./public/assets/vendor/opencv.js",
  "./public/assets/vendor/tf.min.js",
  "./public/assets/vendor/pdf.min.js",
  "./public/assets/vendor/pdf.worker.min.js",
  "./public/assets/vendor/exceljs.min.js",
  // モデル・設定
  "./public/assets/model/model.json",
  "./public/assets/model/group1-shard1of1.bin",
  "./public/assets/config.json",
  "./public/assets/ROI_coordinate.csv",
  "./public/assets/product_list.csv",
  "./public/assets/exchange_form.xlsx",
  "./public/assets/icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// アプリ本体（HTML・src/*.js・css・設定json）はネットワーク優先にする。
// これによりデプロイ後は常に最新版が配信され、「更新が反映されない」問題を防ぐ。
// オフライン時のみキャッシュへフォールバック。
// 一方、重い vendor/model アセット（約14MB）はキャッシュ優先で高速＆通信量節約。
function isAppShell(url) {
  const p = url.pathname;
  // vendor/model は除外（＝キャッシュ優先のまま）。それ以外の同一オリジンはアプリ本体扱い。
  if (p.includes("/public/assets/vendor/") || p.includes("/public/assets/model/")) return false;
  return (
    p.endsWith("/") ||
    p.endsWith(".html") ||
    p.endsWith(".js") ||
    p.endsWith(".css") ||
    p.endsWith(".json") ||
    p.endsWith(".csv")
  );
}

// ネットワーク優先：取得できたらキャッシュ更新して返す。失敗時はキャッシュ。
function networkFirst(request) {
  return fetch(request)
    .then((resp) => {
      if (resp && resp.status === 200 && resp.type === "basic") {
        const clone = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(request, clone));
      }
      return resp;
    })
    .catch(() => caches.match(request));
}

// キャッシュ優先：無ければネットワーク取得し、成功時はキャッシュに追加。
function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((resp) => {
      if (resp && resp.status === 200 && resp.type === "basic") {
        const clone = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(request, clone));
      }
      return resp;
    });
  });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const strategy =
    event.request.mode === "navigate" || (url.origin === self.location.origin && isAppShell(url));
  event.respondWith(strategy ? networkFirst(event.request) : cacheFirst(event.request));
});
