# 築地・極 AI-OCR（PWA版）

既存デスクトップ版（`AI_int_tsukijime_system`）の **AI文字認識機能だけ**を、
ブラウザ内で完結する PWA として切り出したもの。iPad Safari / Chrome の両方で
**オフライン・端末内処理**で動作する（ハイブリッド構成の認識フロント）。

## 対応機能
- PDF アップロード（ドラッグ&ドロップ / ファイル選択、複数可）
- PDF → 画像展開（PDF.js、Poppler不要）
- AI 文字認識（OpenCV.js 前処理 + TensorFlow.js 推論）
- 読み取り結果 CSV ダウンロード（デスクトップ版の `recognition_results_*.csv` と同一列順）
- オフライン動作（Service Worker が全アセットをキャッシュ）

集計・Excel生成・データ保存はデスクトップ版に残す（本アプリは認識とCSV出力に限定）。

## 実行方法（開発）
Node 不要・ビルド不要。任意の静的サーバでルートを配信するだけ。
```
python -m http.server 8778 --directory tsukijime-ocr-pwa
```
`http://localhost:8778/index.html` を開く。
※ Service Worker と PDF.js Worker のため file:// 直開きは不可。localhost か HTTPS が必要。

## デプロイ
`tsukijime-ocr-pwa/` 一式を HTTPS の静的ホスティングに置くだけ。
初回アクセスで全アセット（約14MB）がキャッシュされ、以降オフラインで起動する。
iPad は Safari の「ホーム画面に追加」でインストール可能。

## 構成
```
index.html            アプリシェル
manifest.json         PWA マニフェスト
sw.js                 Service Worker（オフラインキャッシュ）
src/
  main.js             UI/ワークフロー制御
  pdf.js              PDF→Canvas（PDF.js）
  markerDetector.js   四隅マーカー検出        ← marker_detector_E.py
  geometry.js         台形補正 1000x707       ← geometry_B.py
  extractor.js        ROI 切り出し            ← extractor_A.py
  segmenter.js        数字セグメント 28x28     ← predictor_C.segment_digits_internal
  predictor.js        バッチ推論+信頼度       ← predictor_C.predict_...
  csv.js              CSV 生成                ← save_to_csv_B.py
  config.js           設定/ROI 読込
  backend.js          tfjs バックエンド固定（CPU）
  pipeline.js         1ページ分の統合フロー
  styles.css
public/assets/
  model/              tfjs 変換済みモデル（model.json + *.bin）
  vendor/             opencv.js / tf.min.js / pdf.min.js(+worker)
  config.json         認識閾値（デスクトップ版と共有）
  ROI_coordinate.csv  記入枠座標（デスクトップ版と共有）
  icon.png
tools/                変換・検証スクリプト（配布不要）
```

## モデル/設定の更新
- モデル再学習時: `tools/CONVERT_MODEL.md` の手順で `.h5` → tfjs 変換し、
  `public/assets/model/` を差し替え、`sw.js` の CACHE 名を上げる。
- ROI 座標・閾値変更時: `public/assets/ROI_coordinate.csv` / `config.json` を差し替え。
  （デスクトップ版の `config/` と同じ内容を保つこと）

## 検証状況（Python との一致）
`tools/` の検証ページで、既存 Python パイプラインと実データ照合済み。
- Phase 0: モデル tfjs 変換 → Keras と argmax全一致・誤差 2e-7（`CONVERT_MODEL.md`）
- Phase 1: 認識コア → 実データ61桁でセグメント画素差0・予測不一致0（`PHASE1_RESULTS.md`）
- Phase 2: 前処理 → 生JPG17枚で座標誤差0・補正画像差分0・予測不一致0（`PHASE2_RESULTS.md`）
- Phase 3/4: 実PDF119ページを端点間処理し、CSV列順もデスクトップ版と一致。

## 既知の制約 / TODO
- **マーカー検出は約15%のページで失敗**（デスクトップ版と同率のアルゴリズム固有特性）。
  現状は該当ページを「マーカー検出失敗（要手動処理）」として一覧表示し、CSVからは除外する。
  → 手動フォールバックUI（パラメータ再試行 or 手動座標指定/手動入力）は今後の課題。
- 検算（合計・日付の妥当性チェック）と訂正UIは未移植（デスクトップ版側で担保）。
- tfjs は決定性確保のため CPU バックエンド固定（WebGL は稀に誤読するため）。
