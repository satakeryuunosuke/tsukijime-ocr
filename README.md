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
- **差異の調整**：不足分（帳簿＞実棚）のみ、検算が成立する交換記録を自動生成して帳簿を実棚に
  合わせる（99個/990点の記入欄制約で自動分割、出力上は通常の記録と区別されない）。
  余剰分（実棚＞帳簿）は帳簿に載せず隠し在庫として保管（調整対象外）
- **Excelレポート出力**（`report_YYYYMM.xlsx`、ExcelJSで動的生成）
- 旧Python版互換のCSV5種（recognition_results / summary / carryover_inventory / arrival / other_manual_entries）

### 商品マスタ・交換票
- 商品の追加・削除・点数変更（バージョン管理。過去の月は当時のマスタで保持）
- 主キーは半角英字の商品ID（例: `notes_Y`）。旧2桁数字コードは廃止
- **交換票はExcel（.xlsx）に一本化**。マスタに票ファイルを保存し、アプリからダウンロード →
  Excelで編集 → アップロードで更新（印刷もExcelから。A4縦・1枚に2票→切って使用）
- **xlsxからROI座標を自動抽出**：マーカー（黒塗り2×2セル）と罫線から記入枠を検出し、
  枠の並び規則（狭→広の2連=商品、等幅2連=日付、等幅3連=合計）で自動割り当て。
  模式図で確認・修正してから確定。A4に2票の構成に対応（上の票を使用）。
  現行の票で手調整済みROI CSVと最大差2ユニットの精度を確認済み
- 商品構成が変わらない変更（点数・名称のみ）は、票と座標を前のマスタから自動引き継ぎ
- 予備として、印刷物のスキャンから座標を設定するROIエディタも利用可能

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
  xlsxForm.js         Excel交換票の解析（マーカー・罫線からROI自動抽出・自動割り当て）
  roiEditor.js        座標割り当てUI（xlsx抽出の確認/修正・スキャンからの設定）
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
- 交換票（Excel）: マスタに `formXlsxB64`（base64・JSONバックアップに乗せるため文字列）と
  `roiSource`（'xlsx' | 'scan' | 'inherited'）を保持。v1 は同梱の
  `public/assets/exchange_form.xlsx` にフォールバック。
- `xlsxForm.js` の座標抽出: マーカー中心が補正後座標系 (0,0)-(1000,707) の四隅に対応。
  列幅・行高の累積位置から枠セル領域をユニット座標へ変換（軸ごとの比率のみ使うので
  物理単位への換算は不要）。検出枠はセル領域のまま → `insetRoi()` で各辺4〜5ユニット
  内側に縮めてROIにする（枠線のインクを除外。手調整済みCSVから逆算した値）。
  ExcelJSは結合セルがスタイルを共有するため単位ラベル（冊/個）等も枠として検出される
  → 商品行は3連チェーン [狭][広][最狭] になる点に注意（autoAssign が対応済み）。
- **票の記入枠のルール**: 四隅に黒塗り2×2セルのマーカー、記入枠は罫線で囲む。
  スキャン読み取りの都合上、10の位と1の位の枠は線を共有した連結ボックスにすること
  （孤立した正方形はマーカー誤検出を招く）。
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
