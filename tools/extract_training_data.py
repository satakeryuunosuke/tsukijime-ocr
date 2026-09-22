"""
5つのスキャンPDFから全ページを解析し、
合計検算ルールに完全一致した高信頼度ページから
「正解ラベル付き28x28数字画像データセット」を自動抽出するスクリプト。
"""

import os
import sys
import json
import fitz  # PyMuPDF
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

def to_int(v):
    if v is None or v == "":
        return 0
    try:
        return int(v)
    except:
        return 0

def run_extraction(pdf_paths, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    images_dir = os.path.join(output_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    cfg = load_config()
    products = load_products()
    rois = load_rois()

    bin_path = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "model", "group1-shard1of1.bin")
    meta_path = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "model", "model.json")
    model = DigitCNN()
    load_tfjs_weights(model, bin_path, meta_path)
    model.eval()

    total_pages = 0
    marker_success = 0
    checksum_passed_pages = 0
    extracted_samples = []

    print(f"=== 対象PDF: {len(pdf_paths)} 件 ===")

    for pdf_idx, pdf_path in enumerate(pdf_paths):
        if not os.path.exists(pdf_path):
            print(f"[Warn] 見つかりません: {pdf_path}")
            continue

        pdf_name = os.path.splitext(os.path.basename(pdf_path))[0]
        print(f"\n[{pdf_idx+1}/{len(pdf_paths)}] 処理中: {pdf_name}...")

        doc = fitz.open(pdf_path)
        n_pages = len(doc)
        total_pages += n_pages

        for p_idx in range(n_pages):
            page = doc[p_idx]
            # 2x レンダリング (~144 DPI)
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
            img_np = np.frombuffer(pix.samples, dtype=np.uint8).reshape((pix.height, pix.width, pix.n))
            if pix.n == 4:
                img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGBA2BGR)
            elif pix.n == 3:
                img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
            elif pix.n == 1:
                img_bgr = cv2.cvtColor(img_np, cv2.COLOR_GRAY2BGR)

            # マーカー検出
            coords = auto_detect_markers(img_bgr)
            if coords is None:
                continue
            marker_success += 1

            # 台形補正
            transformed = transform_image(img_bgr, coords, w=1000, h=707)

            # ROI切り出し & セグメンテーション
            batch_segs = []
            meta = [] # (roi_name, is_tens, dark, seg_img)

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
                    # 十の位フィルタ
                    if is_tens and dark < cfg.get("digit_recognition", {}).get("tens_place_min_ink", 15):
                        predictions[name] = ""
                        continue
                    batch_segs.append(seg)
                    meta.append((name, is_tens, dark, seg))
                else:
                    predictions[name] = ""

            # 推論実行
            if batch_segs:
                # [N, 1, 28, 28] に整形、0.0〜1.0 に正規化
                x_tensor = torch.tensor(np.array(batch_segs, dtype=np.float32) / 255.0).unsqueeze(1)
                with torch.no_grad():
                    logits = model(x_tensor)
                    probs = F.softmax(logits, dim=1).numpy()

                valid_tens = cfg.get("inference", {}).get("tens_place_valid_classes", [1, 2])
                conf_thr = cfg.get("inference", {}).get("confidence_threshold", 0.8)

                for i, (name, is_tens, dark, seg_img) in enumerate(meta):
                    p_row = probs[i]
                    pred_class = int(np.argmax(p_row))
                    confidence = float(p_row[pred_class])

                    if is_tens and pred_class not in valid_tens:
                        predictions[name] = ""
                        recog = ""
                    else:
                        recog = str(pred_class)
                        predictions[name] = recog

                    predictions[f"{name}_conf"] = confidence
                    predictions[f"{name}_seg"] = seg_img

            # 検算チェック
            # 計算合計 = Σ(単価 × 個数)
            computed_score = 0
            for prod in products:
                k = prod["key"]
                q = to_int(predictions.get(f"{k}_1", "")) * 10 + to_int(predictions.get(f"{k}_0", ""))
                computed_score += prod["points"] * q

            total_box = (
                to_int(predictions.get("total_2", "")) * 100
                + to_int(predictions.get("total_1", "")) * 10
                + to_int(predictions.get("total_0", ""))
            )

            # 検算判定 (下2桁または3桁一致)
            computed_tens = computed_score // 10
            box_tens = to_int(predictions.get("total_2", "")) * 10 + to_int(predictions.get("total_1", ""))
            # 2桁検算または3桁完全一致
            checksum_ok = (computed_score == total_box) or (computed_tens == box_tens and computed_score > 0)

            # 確信度判定: 記入された数字の確信度がすべて十分高いか
            has_digits = False
            all_high_conf = True
            page_samples = []

            for r in rois:
                name = r["name"]
                digit_str = predictions.get(name, "")
                if digit_str != "":
                    has_digits = True
                    conf = predictions.get(f"{name}_conf", 0.0)
                    seg_img = predictions.get(f"{name}_seg")
                    if conf < 0.85:
                        all_high_conf = False
                    page_samples.append({
                        "roi": name,
                        "label": int(digit_str),
                        "conf": conf,
                        "seg": seg_img,
                        "pdf": pdf_name,
                        "page": p_idx
                    })

            # 合計 > 0 かつ検算完全一致 かつ 高確信度
            if checksum_ok and computed_score > 0 and all_high_conf and has_digits:
                checksum_passed_pages += 1
                for s in page_samples:
                    sample_id = f"{pdf_name}_p{p_idx}_{s['roi']}_label{s['label']}.png"
                    img_out = os.path.join(images_dir, sample_id)
                    cv2.imwrite(img_out, s["seg"])
                    extracted_samples.append({
                        "file": sample_id,
                        "label": s["label"],
                        "roi": s["roi"],
                        "confidence": s["conf"],
                        "source": f"{pdf_name} p.{p_idx}"
                    })

        doc.close()
        print(f"  累計: マーカー検出 {marker_success}/{total_pages} ページ, 検算合格 {checksum_passed_pages} ページ, 抽出数字 {len(extracted_samples)} 枚")

    # メタデータを保存
    meta_json = os.path.join(output_dir, "dataset.json")
    with open(meta_json, "w", encoding="utf-8") as f:
        json.dump({
            "total_pages": total_pages,
            "marker_success": marker_success,
            "checksum_passed_pages": checksum_passed_pages,
            "samples_count": len(extracted_samples),
            "samples": extracted_samples
        }, f, indent=2, ensure_ascii=False)

    print("\n==========================================")
    print(f"抽出完了:")
    print(f"  総ページ数: {total_pages}")
    print(f"  マーカー検出成功: {marker_success} ({marker_success/max(1, total_pages)*100:.1f}%)")
    print(f"  検算完全一致合格ページ: {checksum_passed_pages} ({checksum_passed_pages/max(1, marker_success)*100:.1f}%)")
    print(f"  生成された正解ラベル付き数字画像: {len(extracted_samples)} 枚")
    print(f"  保存先: {output_dir}")
    print("==========================================")

    # クラスごとの分布を表示
    from collections import Counter
    counts = Counter([s["label"] for s in extracted_samples])
    print("クラス別数字分布:")
    for digit in range(10):
        print(f"  数字 {digit}: {counts.get(digit, 0)} 枚")

if __name__ == "__main__":
    pdfs = [
        r"C:\Users\sd23048\Downloads\SCAN2083.pdf",
        r"C:\Users\sd23048\Downloads\SCAN2086.pdf",
        r"C:\Users\sd23048\Downloads\SCAN2085.pdf",
        r"C:\Users\sd23048\Downloads\20260531.pdf",
        r"C:\Users\sd23048\Downloads\SCAN2207.pdf",
    ]
    out = os.path.join(os.path.dirname(__file__), "..", "dataset_extracted")
    run_extraction(pdfs, out)
