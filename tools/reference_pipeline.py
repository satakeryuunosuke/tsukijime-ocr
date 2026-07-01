"""
既存 Python パイプラインをそのまま実行し、JS 移植の照合基準（正解データ）を書き出す。
既存環境 (TF 2.19) のプロジェクトルートで実行すること。

出力（testdata/ 配下）:
  <stem>_transformed.png   : 台形補正後の 1000x707 画像（JS が同一入力を得るため PNG 可逆保存）
  <stem>_reference.json    : { predictions, rois:{name:{dark_pixels, seg28|null}} }
"""
import os, sys, json
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

# プロジェクトルートを import パスに追加
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

import shutil
import cv2
import numpy as np
import tensorflow as tf
import constants
from marker_detector_E import detect_markers
from geometry_B import transform_image
from extractor_A import extract_rois
from predictor_C import segment_digits_internal, predict_numbers_from_extracted_data, load_digit_config

# NEO_tool_2.load_config と同じ挙動（nested config は無視されデフォルトが効く点も含め再現）
def load_marker_params():
    default_params = {"block_size": 11, "c_value": 2, "closing_iter": 2, "min_area": 300, "solidity_thr": 0.85}
    try:
        with open(constants.CONFIG_JSON_PATH, encoding="utf-8") as f:
            default_params.update(json.load(f))
    except Exception:
        pass
    return default_params

OUT_DIR = os.path.join(os.path.dirname(__file__), "testdata")

def dump_one(image_path, model, marker_params, digit_config):
    stem = os.path.splitext(os.path.basename(image_path))[0]
    coords = detect_markers(image_path, params=marker_params)
    if coords is None:
        print(f"  [skip] {stem}: マーカー検出失敗")
        return False

    transformed = transform_image(image_path, coords)  # BGR 1000x707
    png_path = os.path.join(OUT_DIR, f"{stem}_transformed.png")
    cv2.imwrite(png_path, transformed)

    # 生JPG をブラウザから読めるよう testdata へコピー（Phase 2 の端点入力）
    shutil.copyfile(image_path, os.path.join(OUT_DIR, f"{stem}_raw.jpg"))

    extracted = extract_rois(transformed, constants.ROI_COORDINATE_PATH)

    # 各 ROI のセグメント中間結果を記録
    rois = {}
    for name, roi in extracted.items():
        entry = {"dark_pixels": None, "seg28": None}
        if roi is not None and roi.size > 0:
            res = segment_digits_internal(roi, digit_config)
            if res is not None:
                seg, dark = res
                entry["dark_pixels"] = int(dark)
                entry["seg28"] = seg.astype(int).reshape(-1).tolist()  # 784 値(0-255)
        rois[name] = entry

    predictions = predict_numbers_from_extracted_data(extracted, model)
    # numpy 型を JSON 化
    predictions = {k: (float(v) if isinstance(v, (np.floating,)) else
                       int(v) if isinstance(v, (np.integer,)) else v)
                   for k, v in predictions.items()}

    with open(os.path.join(OUT_DIR, f"{stem}_reference.json"), "w", encoding="utf-8") as f:
        json.dump({"image": os.path.basename(image_path),
                   "coords": np.array(coords).tolist(),  # [TL,TR,BR,BL] の4点
                   "predictions": predictions, "rois": rois}, f)
    n_digits = sum(1 for k, v in predictions.items()
                   if not k.endswith(("_confidence", "_low_confidence_flag")) and v not in ("", None))
    print(f"  [ok] {stem}: 認識 {n_digits} 桁  -> {stem}_reference.json")
    return True

def main(samples):
    os.makedirs(OUT_DIR, exist_ok=True)
    model = tf.keras.models.load_model(constants.AI_MODEL_PATH)
    marker_params = load_marker_params()
    digit_config = load_digit_config()
    img_dir = os.path.join(constants.RESULTS_BASE_DIR, "202606", "input_images")
    ok = 0
    for s in samples:
        p = os.path.join(img_dir, s)
        if not os.path.exists(p):
            print(f"  [miss] {s} が見つかりません"); continue
        print(f"--- {s} ---")
        if dump_one(p, model, marker_params, digit_config):
            ok += 1
    print(f"\n完了: {ok}/{len(samples)} 件")

if __name__ == "__main__":
    samples = sys.argv[1:] or ["0101.jpg", "0201.jpg", "0301.jpg"]
    main(samples)
