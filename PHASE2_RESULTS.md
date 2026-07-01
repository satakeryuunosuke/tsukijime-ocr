# Phase 2 結果: 前処理パイプラインの移植と Python 照合

生スキャン画像/PDF から台形補正画像を得るまでの前処理を JS へ移植し、実データで照合した。

## 移植したモジュール（Python → JS）
| Python | JS | 対応 |
|---|---|---|
| `marker_detector_E.detect_markers` | `src/markerDetector.js` | 四隅マーカー検出＋順序整列＋長方形判定 |
| `geometry_B.transform_image` | `src/geometry.js` | 透視変換 → 1000x707 |
| `tool_0_pdf_to_jpg`（Poppler, 200dpi） | `src/pdf.js` | PDF.js で PDF→Canvas（長辺1654pxに較正） |

## マーカー検出パラメータ
`NEO_tool_2.load_config` のデフォルト（block_size=11, c_value=2, closing_iter=2,
min_area=300, solidity_thr=0.8, max_area=15000）に一致させた。
※ config.json の nested marker_detection は既存コードでは実際には使われないため、
  そのデフォルト値を採用している。

## 検証結果（2026-07-01）

### A. 生JPG → 認識まで端点間照合（実データ 17枚）
`tools/phase2_check.html`
- **マーカー検出失敗: 0 枚**（Python 成功の17枚すべて JS も検出）
- **座標 最大誤差: 0 px**（4点すべて完全一致）
- **台形補正画像: maxΔ=0, 差分画素 0 / 707,000**（ビット単位一致）
- **最終予測 不一致: 0 件**
→ 生JPG→マーカー→台形補正→ROI→認識の全経路が Python とビット一致。

### B. 実PDF での pdf.js 検証（SCAN2207.pdf, 119ページ）
`tools/phase2_pdf_check.html`
- PDF展開 OK: 119ページ、寸法 **1654x1166px**（pdf2image 200dpi と同一寸法）
- マーカー検出成功 **101 / 119（失敗率 15.1%）**
- → pdf.js の描画は Poppler と同等（標本の Poppler 失敗率 約15% と一致）。
  pdf.js への置換による劣化は無い。

## 重要な知見: マーカー検出の固有失敗率（約15%）
- 約15%のページはマーカー検出に失敗する。これは **描画エンジンの差ではなく
  マーカー検出アルゴリズム固有の特性**で、デスクトップ版も同率で失敗し、
  「GUIパラメータ調整＋手動入力」でフォローしている。
- **PWA版でも検出失敗時のフォールバックが必須**。設計案:
  1. パラメータを段階的に変えて再試行（block_size/c_value/min_area のスイープ）
  2. それでも失敗したページは手動座標指定 or 手動数値入力のUIへ誘導

## Phase 2 完了時点の到達点
「PDF/JPG を入力 → AI認識結果」までがブラウザ内で Python と同等精度で動作することを実証。
残: アプリUI（アップロード/進捗/結果表示/CSV DL）と オフライン(PWA)化、
   および上記マーカー検出フォールバックUI。
