# グッズ交換票・AI読み取り（PWA版）

既存デスクトップ版（`AI_int_tsukijime_system`）の **AI文字認識と訂正機能**を、
ブラウザ内で完結する PWA として切り出したもの。iPad Safari / Chrome の両方で
**オフライン・端末内処理**で動作する（ハイブリッド構成の認識フロント）。

## 対応機能
- PDF アップロード（ドラッグ&ドロップ / ファイル選択、複数可）
- PDF → 画像展開（PDF.js、Poppler不要）
- AI 文字認識（OpenCV.js 前処理 + TensorFlow.js 推論）
- **検算・日付妥当性チェック**（商品単価×個数の合計を記入合計欄と照合／日付が月内か判定）
- **訂正UI**：台形補正画像＋認識値のオーバーレイ表示、個数/日付/合計欄をライブ検算しながら編集
- **マーカー検出失敗時の手動フォールバック**：生画像の四隅を4点タップ→台形補正→再認識→訂正
- 読み取り結果 CSV ダウンロード（デスクトップ版の `recognition_results_*.csv` と同一列順）
- オフライン動作（Service Worker が全アセットをキャッシュ）

集計・Excel生成・データ保存はデスクトップ版に残す（本アプリは認識・訂正とCSV出力に限定）。

## セットアップ

### 機密ファイルの準備
このリポジトリは**商品単価と学習済みモデルを含みません**（非公開）。以下を自分で用意してください：

1. **商品リスト** → `public/assets/product_list.csv`
   ```csv
   code,product_key,japanese_name,point_values
   1,notes_Y,ノート(黄),10
   2,notes_B,ノート(青),10
   ...
   ```

2. **学習済みモデル** → `public/assets/model/` に以下を配置
   - `model.json` （TensorFlow.js 変換済み）
   - `group1-shard1of1.bin` （ウェイト）

3. **ROI座標** (`public/assets/ROI_coordinate.csv`) と **config.json** も同梱（デスクトップ版から同じファイルを使用可）

### 実行方法（開発）
Node 不要・ビルド不要。上記の機密ファイルを配置後、任意の静的サーバでルートを配信：
```bash
python -m http.server 8778
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
  products.js         商品リスト読込           ← product_list.csv
  validate.js         検算・日付判定           ← caluculate_total_score_A.py / NEO_tool_2
  overlay.js          認識値のオーバーレイ描画  ← visualizer_C.py
  review.js           訂正・手動フォールバックUI ← interactive_correction_A / manual_input_gui_B
  config.js           設定/ROI 読込
  backend.js          tfjs バックエンド固定（CPU）
  pipeline.js         1ページ分の統合フロー
  styles.css
public/assets/
  model/              tfjs 変換済みモデル（model.json + *.bin）
  vendor/             opencv.js / tf.min.js / pdf.min.js(+worker)
  config.json         認識閾値（デスクトップ版と共有）
  ROI_coordinate.csv  記入枠座標（デスクトップ版と共有）
  product_list.csv    商品・単価・日本語名（デスクトップ版と共有）
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

## 操作フロー
1. 年月を確認（日付妥当性チェックに使用）し、PDF/画像を投入
2. 一覧に各ページの状態が出る（✓OK / ⚠低信頼度 / ✗合計不一致 / ✗日付不正 / ✗マーカー失敗）
3. 行をクリックで訂正モーダル：
   - マーカー成功ページ → 台形補正画像＋認識値を見ながら個数/日付/合計欄を修正、検算をライブ確認
   - マーカー失敗ページ → まず**パラメータ調整**（5スライダー＋二値化/検出プレビュー、Python版の
     Marker Tuner 相当）で緑枠が4つ付く設定にして自動検出。うまくいかなければ**四隅を手動タップ**。
     いずれも→再認識→同じ訂正画面
4. 「保存」で確定（キャンセルは破棄）。CSV ダウンロードは確定済みページを出力

## 既知の制約 / TODO
- **マーカー検出は約15%のページで自動検出に失敗**（デスクトップ版と同率のアルゴリズム固有特性）。
  → 訂正モーダルで「パラメータ調整（スライダー）」または「四隅手動タップ」で救済可能（実装済み）。
- 検算NG・日付NG・低信頼度のページは一覧で色分け表示し、訂正モーダルで修正できる。
- CSV に含まれるのは「認識成功＋手動確定」ページのみ（未処理のマーカー失敗ページは除外）。
- tfjs は決定性確保のため CPU バックエンド固定（WebGL は稀に誤読するため）。
- 検算の連番（code_1/code_0）は日付ごとの処理順で採番。デスクトップ版のような
  既存ファイルとの重複回避までは行わない。
