// Service Worker: アプリシェルと全アセット（OpenCV.js/tfjs/モデル/設定）を
// プリキャッシュし、オフラインでも完全動作させる。
// モデルや辞書を更新したら CACHE 名のバージョンを上げること。
const CACHE = "tsukijime-ocr-v3";

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
  // ライブラリ（同梱）
  "./public/assets/vendor/opencv.js",
  "./public/assets/vendor/tf.min.js",
  "./public/assets/vendor/pdf.min.js",
  "./public/assets/vendor/pdf.worker.min.js",
  // モデル・設定
  "./public/assets/model/model.json",
  "./public/assets/model/group1-shard1of1.bin",
  "./public/assets/config.json",
  "./public/assets/ROI_coordinate.csv",
  "./public/assets/product_list.csv",
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

// キャッシュ優先（オフライン最優先）。無ければネットワーク取得し、成功時はキャッシュに追加。
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        if (resp && resp.status === 200 && resp.type === "basic") {
          const clone = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
