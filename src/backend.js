// TensorFlow.js バックエンド初期化。
//
// なぜ CPU 固定か:
//   既定の WebGL バックエンドは、コールドスタート時にごく稀に「信頼度1.0のまま
//   argmax を誤る」非決定的な計算誤りを起こすことを Phase 1 検証で観測した
//   （同一入力・同一モデルなのに再実行で結果が変わる）。数値入力OCRでは
//   1桁の誤読が致命的なため、GPUドライバ依存の揺らぎが無い決定的な CPU
//   バックエンドに固定する。モデルは 225K パラメータと小さく、1ページ数十桁の
//   バッチ推論は CPU でも数ミリ秒で完了するため速度上の問題はない。
//
// 将来さらに高速化したい場合は WASM バックエンド（要 .wasm 同梱）へ差し替え可能。
export async function initBackend() {
  const tf = window.tf;
  await tf.setBackend("cpu");
  await tf.ready();
  return tf.getBackend();
}
