# グッズ交換・月締めシステム（PWA）

塾のグッズ交換の**月締め（棚卸）業務がブラウザだけで完結する** PWA。
旧Python製デスクトップ版の全機能（AI読み取り・集計・Excelレポート）に加え、
商品入れ替え・交換票の生成印刷にも対応した。iPad Safari / Chrome の両方で
**オフライン・端末内処理**で動作する。

**運用者向けの説明は [HANDOVER.md](HANDOVER.md) を参照**（このREADMEは開発向け）。

## 対応機能

### 読み取り（AI-OCR）
- PDF/画像アップロード → AI 文字認識（OpenCV.js 前処理 + TensorFlow.js 推論）
- **検算・日付妥当性チェック**（商品単価×個数の合計を記入合計欄と照合／日付が月内か判定）
- **訂正UI**：台形補正画像＋認識値のオーバーレイ表示、ライブ検算しながら編集
- **マーカー検出失敗時の救済**：パラメータ調整スライダー／四隅の手動タップ
- ✓OK のページは対象年月の月データ（IndexedDB）へ自動保存

### 月締め（棚卸）
- **繰越在庫・入庫・ノート購入（現金/口座振替/ポイント）の入力画面**
- 日次台帳の計算（繰越＋入庫−交換−ノート購入、旧 template.xlsx の数式と同一）
- **棚卸表**：帳簿残 vs 実棚数の突合・差異表示
- **差異の調整**：不足分は検算が成立する交換記録（99個/990点の記入欄制約で自動分割）、
  余剰分は入庫記録として自動生成し、帳簿を実棚に合わせる（出力上は通常の記録と区別されない）
- **Excelレポート出力**（`report_YYYYMM.xlsx`、ExcelJSで動的生成）
- 旧Python版互換のCSV5種（recognition_results / summary / carryover_inventory / arrival / other_manual_entries）

### 商品マスタ・交換票
- 商品の追加・削除・点数変更（バージョン管理。過去の月は当時のマスタで保持）
- 主キーは半角英字の商品ID（例: `notes_Y`）。旧2桁数字コードは廃止
- **交換票の生成・印刷**（A5横・四隅マーカー付き）。ROI座標は同一レイアウトモデルから自動導出
- **ROIエディタ**：Excel等で自作した交換票のスキャンから座標を設定。マーカー補正後に
  記入枠を自動検出（候補表示）し、クリックで項目に割り当て。自作票なら商品数の上限なし

### データ管理
- 全データのJSON一括エクスポート/インポート（バックアップ・後任への引き継ぎ）
- 月ごとのCSV一括ダウンロード
- オフライン動作（Service Worker が全アセットをキャッシュ）

データはすべて端末内（IndexedDB）に保存され、サーバ送信は一切ない。

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
リポジトリ一式を HTTPS の静的ホスティング（GitHub Pages）に置くだけ。
初回アクセスで全アセット（約15MB）がキャッシュされ、以降オフラインで起動する。
iPad は Safari の「ホーム画面に追加」でインストール可能。
**デプロイ時は `sw.js` の CACHE バージョンを必ず上げる。**

## 構成
```
index.html            アプリシェル（タブナビゲーション）
manifest.json         PWA マニフェスト
sw.js                 Service Worker（オフラインキャッシュ）
src/
  main.js             アプリシェル：ルーティング・対象年月・エンジン初期化・マスタシード
  db.js               IndexedDB 保存層（months/masters/settings、一括エクスポート/インポート）
  ledger.js           月次台帳の計算・旧Python版互換CSV5種の生成（純ロジック）
  layout.js           交換票レイアウトモデル（ROI座標と印刷用HTMLを同一モデルから導出）
  roiEditor.js        ROIエディタ（自作票のスキャン→枠自動検出→座標割り当て）
  excelReport.js      Excel棚卸レポート生成（ExcelJS・動的生成）
  views/
    home.js           ホーム（進捗ダッシュボード）
    reader.js         読み取りタブ（旧main.jsのOCRフロー＋月データ保存）
    carryover.js      繰越在庫入力            ← GUI_tool_1_enter_carryover.py
    arrivals.js       入庫入力                ← GUI_tool_4_enter_arrivals.py
    specials.js       ノート購入入力           ← GUI_tool_3_enter_notes_cdp_hybrid.py
    closing.js        月締め（棚卸表・実棚入力・レポート出力）← tool_5_create_report.py
    masters.js        商品マスタ編集・交換票印刷
    backup.js         データ管理（バックアップ・CSV一括）
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
  vendor/             opencv.js / tf.min.js / pdf.min.js(+worker) / exceljs.min.js
  config.json         認識閾値（初回シード用）
  ROI_coordinate.csv  記入枠座標（初回シード用 → 以後は IndexedDB のマスタで管理）
  product_list.csv    商品・単価・日本語名（初回シード用 → 同上）
  icon.png
tools/                変換・検証スクリプト（配布不要）
```

## データ設計（IndexedDB `tsukijime`）
- `months`（key: `YYYYMM`）: `{ ym, masterVersion, pages[], carryover, arrivals, specials[], physicalCount, note }`
  - `pages[]` は確定済み読み取り結果（predictions をそのまま保存）。同名ページは上書き。
- `masters`（key: version）: `{ version, effectiveFrom, products[], roiRows[], config, layout }`
  - 商品マスタはバージョン管理。月レコードは作成時点の版をスナップショットとして保持し、
    月の途中でマスタが変わっても過去データが壊れない。
  - 初回起動時に `public/assets/` のCSVから v1 を自動シード。
- 交換票レイアウト: `layout.js` の単一モデルから ROI座標（認識用）と印刷HTML の両方を導出。
  マーカー中心が補正後座標系 (0,0)-(1000,707) の四隅に対応。既定レイアウトは
  現行 `ROI_coordinate.csv` を誤差0で再現することを確認済み。記入枠は2桁連結ボックスで
  描画し（アスペクト比>1.3）、マーカー誤検出を防ぐ。**自作票（Excel等）に枠を印刷する場合も
  同様に、10の位と1の位の枠を線でつなげた連結ボックスにすること**（孤立した正方形は
  マーカー検出の候補条件に入り誤検出を招く）。
- 自作票のROI座標は `roiEditor.js`（商品・交換票タブ→マスタ編集→スキャンから座標を設定）で登録。
  マスタの `roiSource` が `scan` のときアプリの票印刷は座標不一致のため警告を出す。
- 対象年月の既定値: 毎月15日〜翌月14日を「その月」とする（前月の棚卸を月初に行う運用）。

## モデル/設定の更新
- モデル再学習時: `tools/CONVERT_MODEL.md` の手順で `.h5` → tfjs 変換し、
  `public/assets/model/` を差し替え、`sw.js` の CACHE 名を上げる。
- 商品・ROI座標の変更は**アプリの「商品・交換票」タブで行う**（新マスタバージョンとして保存）。
  `public/assets/` のCSVは初回シード専用で、シード後の変更は既存端末には反映されない。
- **デプロイの度に `sw.js` の CACHE バージョンを上げること**（忘れると更新が反映されない）。

## 検証状況（Python との一致）
`tools/` の検証ページで、既存 Python パイプラインと実データ照合済み。
- Phase 0: モデル tfjs 変換 → Keras と argmax全一致・誤差 2e-7（`CONVERT_MODEL.md`）
- Phase 1: 認識コア → 実データ61桁でセグメント画素差0・予測不一致0（`PHASE1_RESULTS.md`）
- Phase 2: 前処理 → 生JPG17枚で座標誤差0・補正画像差分0・予測不一致0（`PHASE2_RESULTS.md`）
- Phase 3/4: 実PDF119ページを端点間処理し、CSV列順もデスクトップ版と一致。

## 操作フロー（読み取りタブ）
1. 画面上部の「対象年月」を確認（日付妥当性チェック・保存先の月に使用）し、PDF/画像を投入
2. 一覧に各ページの状態が出る（✓OK / ⚠低信頼度 / ✗合計不一致 / ✗日付不正 / ✗マーカー失敗）
3. 行をクリックで訂正モーダル：
   - マーカー成功ページ → 台形補正画像＋認識値を見ながら個数/日付/合計欄を修正、検算をライブ確認
   - マーカー失敗ページ → まず**パラメータ調整**（5スライダー＋二値化/検出プレビュー、Python版の
     Marker Tuner 相当）で緑枠が4つ付く設定にして自動検出。うまくいかなければ**四隅を手動タップ**。
     いずれも→再認識→同じ訂正画面
4. ✓OK になったページは対象年月の月データへ自動保存される（同名ページは上書き）。
   保存済みページの確認・削除は「月締め」タブから。

## 既知の制約 / TODO
- **マーカー検出は約15%のページで自動検出に失敗**（デスクトップ版と同率のアルゴリズム固有特性）。
  → 訂正モーダルで「パラメータ調整（スライダー）」または「四隅手動タップ」で救済可能（実装済み）。
- 検算NG・日付NG・低信頼度のページは一覧で色分け表示し、訂正モーダルで修正できる。
- 月データに保存されるのは「✓OK（認識成功＋確定）」ページのみ。
- tfjs は決定性確保のため CPU バックエンド固定（WebGL は稀に誤読するため）。
- 同じ交換票を別ファイル名で2回読み込むと二重集計になる（同名なら上書きで安全）。
  スキャンファイル名の付け方を運用でそろえること（HANDOVER.md 参照）。
- 生成した交換票での実運用前に「印刷 → スキャン → 読み取り」の一連を必ず一度検証すること。
- Excelレポートは値のみ（数式なし）。見た目は旧 template.xlsx 準拠だが完全一致ではない。
