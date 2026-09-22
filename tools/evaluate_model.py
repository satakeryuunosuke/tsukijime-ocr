"""
旧モデル（.bak）とファインチューニング後モデルの推論精度を
全PDF（全606ページ）の検算完全一致率で比較・評価するスクリプト。
"""

import os
import sys
import json
import fitz
import cv2
import numpy as np
import torch
import torch.nn.functional as F

from extract_dataset import (
    load_config,
    load_products,
    load_rois,
    auto_detect_markers,
    transform_image,
    segment_digit,
)
from model_compat import DigitCNN, load_tfjs_weights

def evaluate(pdf_paths, model_bin, label="Model"):
    cfg = load_config()
    products = load_products()
    rois = load_rois()

    meta_path = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "model", "model.json")
    model = DigitCNN()
    load_tfjs_weights(model, model_bin, meta_path)
    model.eval()

    total_pages = 0
    marker_success = 0
    checksum_passed = 0
    confidences = []

    for pdf_path in pdf_paths:
        if not os.path.exists(pdf_path):
            continue
        doc = fitz.open(pdf_path)
        for page in doc:
            total_pages += 1
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
            img_np = np.frombuffer(pix.samples, dtype=np.uint8).reshape((pix.height, pix.width, pix.n))
            if pix.n == 4:
                img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGBA2BGR)
            elif pix.n == 3:
                img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
            elif pix.n == 1:
                img_bgr = cv2.cvtColor(img_np, cv2.COLOR_GRAY2BGR)

            coords = auto_detect_markers(img_bgr)
            if coords is None:
                continue
            marker_success += 1

            transformed = transform_image(img_bgr, coords, w=1000, h=707)

            batch_segs = []
            meta = []
            predictions = {}
            for r in rois:
                name = r["name"]
                x, y, w, h = r["x"], r["y"], r["w"], r["h"]
                is_tens = not (name.startswith("total") or name.startswith("date")) and name.endswith("1")

                roi_crop = transformed[y:y+h, x:x+w]
                if roi_crop.size == 0:
                    predictions[name] = ""
                    continue

                seg, dark = segment_digit(roi_crop, cfg)
                if seg is not None:
                    if is_tens and dark < cfg.get("digit_recognition", {}).get("tens_place_min_ink", 15):
                        predictions[name] = ""
                        continue
                    batch_segs.append(seg)
                    meta.append((name, is_tens))
                else:
                    predictions[name] = ""

            if batch_segs:
                x_tensor = torch.tensor(np.array(batch_segs, dtype=np.float32) / 255.0).unsqueeze(1)
                with torch.no_grad():
                    logits = model(x_tensor)
                    probs = F.softmax(logits, dim=1).numpy()

                valid_tens = cfg.get("inference", {}).get("tens_place_valid_classes", [1, 2])
                for i, (name, is_tens) in enumerate(meta):
                    p_row = probs[i]
                    c = int(np.argmax(p_row))
                    conf = float(p_row[c])
                    if is_tens and c not in valid_tens:
                        predictions[name] = ""
                    else:
                        predictions[name] = str(c)
                        confidences.append(conf)

            # 検算
            def to_int(v):
                try: return int(v) if v else 0
                except: return 0

            computed = 0
            for prod in products:
                k = prod["key"]
                q = to_int(predictions.get(f"{k}_1", "")) * 10 + to_int(predictions.get(f"{k}_0", ""))
                computed += prod["points"] * q

            total_box = (
                to_int(predictions.get("total_2", "")) * 100
                + to_int(predictions.get("total_1", "")) * 10
                + to_int(predictions.get("total_0", ""))
            )
            computed_tens = computed // 10
            box_tens = to_int(predictions.get("total_2", "")) * 10 + to_int(predictions.get("total_1", ""))
            ok = (computed == total_box) or (computed_tens == box_tens and computed > 0)
            if ok and computed > 0:
                checksum_passed += 1

        doc.close()

    avg_conf = np.mean(confidences) if confidences else 0.0
    pass_rate = (checksum_passed / max(1, marker_success)) * 100.0
    print(f"[{label}]")
    print(f"  マーカー検出成功: {marker_success}/{total_pages} ページ")
    print(f"  検算一致数: {checksum_passed} ページ ({pass_rate:.2f}%)")
    print(f"  平均推論信頼度 (Confidence): {avg_conf * 100.0:.2f}%")
    return {"passed": checksum_passed, "rate": pass_rate, "conf": avg_conf}

if __name__ == "__main__":
    pdfs = [
        r"C:\Users\sd23048\Downloads\SCAN2083.pdf",
        r"C:\Users\sd23048\Downloads\SCAN2086.pdf",
        r"C:\Users\sd23048\Downloads\SCAN2085.pdf",
        r"C:\Users\sd23048\Downloads\20260531.pdf",
        r"C:\Users\sd23048\Downloads\SCAN2207.pdf",
    ]
    model_dir = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "model")
    cur_bin = os.path.join(model_dir, "group1-shard1of1.bin")
    bak_bin = os.path.join(model_dir, "group1-shard1of1.bin.bak")

    if os.path.exists(bak_bin):
        evaluate(pdfs, bak_bin, label="旧モデル (Before Fine-tuning)")
    evaluate(pdfs, cur_bin, label="新モデル (After Fine-tuning)")
