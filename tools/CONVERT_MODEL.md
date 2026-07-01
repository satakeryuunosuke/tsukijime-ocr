# モデル変換手順（.h5 → TensorFlow.js）

`config/handwritten_digit_recognizer.h5`（Keras 3 / TF 2.19 で保存）を
ブラウザ用の TensorFlow.js Layers モデルへ変換する手順。**Windows 固有の落とし穴**を含む。

## 前提
- Python 3.12
- 変換専用の隔離 venv を **短いパス**に作る（`C:\Users\<user>\tjenv`）
  - 理由: tensorflow の `include` 配下が非常に深く、scratchpad 等の長いパスだと
    Windows の 260 文字制限に当たり展開失敗する。

## セットアップ（一度だけ）
```powershell
python -m venv C:\Users\<user>\tjenv
$py = "C:\Users\<user>\tjenv\Scripts\python.exe"
# tensorflowjs 4.22 は Windows ホイールの無い TFDF/jax/flax に依存するため --no-deps で入れる
& $py -m pip install --no-deps "tensorflowjs==4.22.0"
& $py -m pip install "packaging~=23.1" "tensorflow-hub>=0.16.1" tf_keras "setuptools<81"
```

### インストール済みパッケージへの必須パッチ（Windows 対応）
`tensorflowjs` は import 時に TFDF / jax を読み込むが、どちらも Windows ホイールが無い。
Keras(.h5) → tfjs の変換には不要なので、以下 2 箇所を任意 import 化する。

1. `tjenv\Lib\site-packages\tensorflowjs\converters\tf_saved_model_conversion_v2.py`
   ```python
   try:
       import tensorflow_decision_forests
   except ModuleNotFoundError:
       tensorflow_decision_forests = None
   ```
2. `tjenv\Lib\site-packages\tensorflowjs\converters\__init__.py`
   ```python
   try:
       from tensorflowjs.converters.jax_conversion import convert_jax
   except ModuleNotFoundError:
       convert_jax = None
   ```

## 変換（モデル更新のたびに実行）
```powershell
$py = "C:\Users\<user>\tjenv\Scripts\python.exe"
& "C:\Users\<user>\tjenv\Scripts\tensorflowjs_converter.exe" `
    --input_format=keras `
    "config\handwritten_digit_recognizer.h5" `
    "tsukijime-ocr-pwa\public\assets\model"

# Keras3 由来の model.json 不整合を補正（必須）
python tsukijime-ocr-pwa\tools\fix_model_json.py
```

### fix_model_json.py が直す Keras3 ↔ tfjs 不整合（2 件）
- InputLayer の `batch_shape` → `batchInputShape`（`ragged` 除去）
- 重み名のモデル名プレフィックス除去（`sequential/conv2d/kernel` → `conv2d/kernel`）

## 検証
`tools/make_reference.py`（既存 TF 2.19 環境で実行）が出力する
`testdata/reference_vectors.json` と、ブラウザ側 tfjs 推論を突き合わせる。
`tools/phase0_check.html` をローカルサーバ経由で開くと自動照合する。

### Phase 0 検証結果（2026-07-01）
- OpenCV.js: 必要 28 関数・定数すべて存在、実行 OK
- モデル: tfjs 読み込み OK、Keras と argmax 全一致・最大誤差 2.09e-7（=一致）
