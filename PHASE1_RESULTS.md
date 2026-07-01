# Phase 1 結果: 認識コアの移植と Python 照合

既存 Python パイプラインの認識コア（ROI切り出し・数字セグメント・バッチ推論）を
JS(OpenCV.js + TensorFlow.js) へ移植し、実データで 1対1 照合した。

## 移植したモジュール（Python → JS）
| Python | JS | 対応 |
|---|---|---|
| `extractor_A.extract_rois` | `src/extractor.js` | ROI座標で部分Mat切り出し |
| `predictor_C.segment_digits_internal` | `src/segmenter.js` | 二値化→モルフォロジー→輪郭統合→28x28整形 |
| `predictor_C.predict_numbers_from_extracted_data` | `src/predictor.js` | バッチ推論＋十の位フィルタ＋信頼度フラグ |
| `predictor_C.load_digit_config` / ROI CSV 読取 | `src/config.js` | 設定・ROI定義ロード |
| （新規）バックエンド初期化 | `src/backend.js` | tfjs を CPU に固定 |

## 検証方法
`tools/reference_pipeline.py`（既存 TF2.19 環境）で実スキャン画像を処理し、
台形補正画像(PNG)・各ROIの28x28セグメント・最終予測を正解として書き出す。
`tools/phase1_check.html` がブラウザで同じ台形補正画像を入力に JS 側を実行し、
セグメント配列・予測・信頼度を突き合わせる。

## 結果（2026-07-01, 実データ 202606 の 17 枚 / 61 桁）
- **セグメント: 全61 ROI が画素差 0（ビット単位一致）**、null判定も完全一致
- **予測: 不一致 0 件**、信頼度最大差 2.38e-7（浮動小数点誤差レベル）
- 認識桁の種類: 0,1,2,3,5,7 ＋ 十の位(total_2, date_1) — 多桁・十の位フィルタも網羅
- → OpenCV.js 前処理・tfjs 推論とも Python と実質同一と確認

## 重要な知見: WebGL バックエンドの非決定的誤り
初回検証で、tfjs 既定の **WebGL バックエンドが信頼度1.0のまま argmax を誤る**
非決定的な計算誤りを観測（同一入力で再実行すると結果が変わる）。
数値入力OCRでは致命的なため、`src/backend.js` で **CPU バックエンドに固定**して解消。
以後 3回連続実行で完全に決定的・正確。モデルは 225K パラメータと小さく速度問題なし。

## Phase 2 への申し送り
- 20枚中 **3枚（0104, 0403, 0502）が Python 側でもマーカー検出失敗**（約15%）。
  デスクトップ版は GUI パラメータ調整＋手動入力でフォールバックしている。
  PWA では「マーカー検出の移植」に加え、**検出失敗時の手動フォールバックUI**の設計が必要。
