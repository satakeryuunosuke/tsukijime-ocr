"""
PDF交換票から数字セグメント画像 (28x28) を抽出し、
現行モデルの推論と合計検算ルールを用いて高信頼度疑似ラベル付きデータセットを作成するスクリプト。
"""

import os
import sys
import json
import math
import cv2
import numpy as np
import fitz  # PyMuPDF

# 設定読み込み
def load_config():
    cfg_path = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "config.json")
    with open(cfg_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    return cfg

def load_products():
    csv_path = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "product_list.csv")
    products = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        lines = [line.strip() for line in f if line.strip()]
    header = [h.strip() for h in lines[0].split(",")]
    i_key = header.index("product_key")
    i_pts = header.index("point_values")
    for line in lines[1:]:
        parts = line.split(",")
        products.append({
            "key": parts[i_key].strip(),
            "points": int(parts[i_pts].strip())
        })
    return products

def load_rois():
    csv_path = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "ROI_coordinate.csv")
    rois = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        lines = [line.strip() for line in f if line.strip()]
    header = [h.strip() for h in lines[0].split(",")]
    i_name = header.index("ROI_name")
    i_x = header.index("x")
    i_y = header.index("y")
    i_h = header.index("h")
    i_w = header.index("w")
    for line in lines[1:]:
        parts = line.split(",")
        rois.append({
            "name": parts[i_name].strip(),
            "x": int(parts[i_x].strip()),
            "y": int(parts[i_y].strip()),
            "w": int(parts[i_w].strip()),
            "h": int(parts[i_h].strip())
        })
    return rois

# マーカー検出 (markerDetector.js 移植)
def order_points(pts):
    pts = np.array(pts, dtype=np.float32)
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).reshape(-1)
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(diff)]
    bl = pts[np.argmax(diff)]
    return [tl.tolist(), tr.tolist(), br.tolist(), bl.tolist()]

def is_rectangle(pts, tol=15.0):
    def angle(p1, p2, p3):
        v1 = np.array([p1[0] - p2[0], p1[1] - p2[1]], dtype=np.float32)
        v2 = np.array([p3[0] - p2[0], p3[1] - p2[1]], dtype=np.float32)
        n1 = np.linalg.norm(v1)
        n2 = np.linalg.norm(v2)
        if n1 == 0 or n2 == 0:
            return 0
        dot = np.dot(v1, v2) / (n1 * n2)
        dot = max(-1.0, min(1.0, dot))
        return math.degrees(math.acos(dot))

    angles = [
        angle(pts[3], pts[0], pts[1]),
        angle(pts[0], pts[1], pts[2]),
        angle(pts[1], pts[2], pts[3]),
        angle(pts[2], pts[3], pts[0]),
    ]
    return all(abs(a - 90.0) <= tol for a in angles)

def is_marker_rectangle(ordered, img_w=0, img_h=0, tol=12.0):
    if len(set(f"{p[0]},{p[1]}" for p in ordered)) != 4:
        return False
    if not is_rectangle(ordered, tol):
        return False
    def dist(a, b):
        return math.hypot(a[0] - b[0], a[1] - b[1])
    top = dist(ordered[0], ordered[1])
    bottom = dist(ordered[3], ordered[2])
    left = dist(ordered[0], ordered[3])
    right = dist(ordered[1], ordered[2])
    if min(top, bottom) / max(top, bottom) < 0.85:
        return False
    if min(left, right) / max(left, right) < 0.85:
        return False
    if img_w > 0 and img_h > 0:
        w = (top + bottom) / 2
        h = (left + right) / 2
        if w < img_w * 0.4 or h < img_h * 0.3:
            return False
    return True

def detect_marker_candidates(gray, block_size=11, c_value=2, closing_iter=2, min_area=300, max_area=15000, solidity_thr=0.85):
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    bs = max(3, int(round(block_size)))
    if bs % 2 == 0:
        bs += 1
    thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, bs, c_value)
    if closing_iter > 0:
        kernel = np.ones((3, 3), np.uint8)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=closing_iter)

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    centers = []
    metrics = []
    for cnt in contours:
        hull = cv2.convexHull(cnt)
        area = cv2.contourArea(hull)
        if area < min_area or area > max_area:
            continue
        peri = cv2.arcLength(hull, True)
        approx = cv2.approxPolyDP(hull, 0.04 * peri, True)
        if len(approx) == 4:
            x, y, w, h = cv2.boundingRect(approx)
            if h == 0 or w == 0:
                continue
            aspect = w / float(h)
            solidity = cv2.contourArea(cnt) / float(w * h)
            if 0.7 <= aspect <= 1.3 and solidity > solidity_thr:
                M = cv2.moments(hull)
                if M["m00"] != 0:
                    cx = int(round(M["m10"] / M["m00"]))
                    cy = int(round(M["m01"] / M["m00"]))
                    centers.append([cx, cy])
                    metrics.append({"center": [cx, cy], "area": area, "solidity": solidity})
    return centers, metrics

def auto_detect_markers(img_bgr):
    img_h, img_w = img_bgr.shape[:2]
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    
    variants = [
        {"block_size": 11, "c_value": 2, "closing_iter": 2},
        {"closing_iter": 3}, {"closing_iter": 4}, {"closing_iter": 1},
        {"c_value": 4}, {"c_value": 6}, {"c_value": 1},
        {"block_size": 15}, {"block_size": 21},
    ]
    base = {"block_size": 11, "c_value": 2, "closing_iter": 2, "min_area": 150, "max_area": 15000, "solidity_thr": 0.5}

    solidity_steps = [0.96, 0.94, 0.92, 0.9, 0.88, 0.86, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6]
    min_area_steps = [1500, 1000, 700, 500, 300, 150]

    default_metrics = None
    for i, v in enumerate(variants):
        params = {**base, **v}
        _, metrics = detect_marker_candidates(
            gray,
            block_size=params["block_size"],
            c_value=params["c_value"],
            closing_iter=params["closing_iter"],
            min_area=params["min_area"],
            max_area=params["max_area"],
            solidity_thr=params["solidity_thr"]
        )
        if i == 0:
            default_metrics = metrics
        if len(metrics) < 4:
            continue

        for min_area in min_area_steps:
            for sol in solidity_steps:
                filtered = [m for m in metrics if m["area"] >= min_area and m["solidity"] > sol]
                if len(filtered) < 4:
                    continue
                if len(filtered) > 4:
                    break
                ordered = order_points([m["center"] for m in filtered])
                if is_marker_rectangle(ordered, img_w, img_h):
                    return ordered
                break

    # 4個以上の候補から総当たり
    if default_metrics and 4 <= len(default_metrics) <= 14:
        pool = [m for m in default_metrics if m["area"] >= 300 and m["solidity"] > 0.7]
        best = None
        n = len(pool)
        for a in range(n - 3):
            for b in range(a + 1, n - 2):
                for c in range(b + 1, n - 1):
                    for d in range(c + 1, n):
                        four = [pool[a], pool[b], pool[c], pool[d]]
                        areas = [m["area"] for m in four]
                        if max(areas) > min(areas) * 3:
                            continue
                        ordered = order_points([m["center"] for m in four])
                        if not is_marker_rectangle(ordered, img_w, img_h):
                            continue
                        w_d = math.hypot(ordered[0][0] - ordered[1][0], ordered[0][1] - ordered[1][1])
                        h_d = math.hypot(ordered[0][0] - ordered[3][0], ordered[0][0] - ordered[3][1])
                        score = w_d * h_d
                        if best is None or score > best["score"]:
                            best = {"score": score, "ordered": ordered}
        if best:
            return best["ordered"]

    return None

# 台形補正 (geometry.js 移植)
def transform_image(img_bgr, coords, w=1000, h=707):
    pts1 = np.array(coords, dtype=np.float32)
    pts2 = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(pts1, pts2)
    dst = cv2.warpPerspective(img_bgr, M, (w, h), flags=cv2.INTER_LINEAR)
    return dst

# 数字セグメント (segmenter.js 移植)
def segment_digit(roi_bgr, cfg):
    dr = cfg.get("digit_recognition", {})
    ink_thr = dr.get("ink_threshold", 9)
    aspect_max = dr.get("aspect_ratio_max", 1.85)
    k_open = tuple(dr.get("kernel_open_size", [2, 2]))
    k_close = tuple(dr.get("kernel_close_size", [3, 3]))

    gray = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2GRAY)
    dark = int(np.sum(gray < 150))
    if dark < ink_thr:
        return None, dark

    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    ko = np.ones(k_open, np.uint8)
    kc = np.ones(k_close, np.uint8)
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, ko)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, kc)

    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, dark

    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        min_x = min(min_x, x)
        min_y = min(min_y, y)
        max_x = max(max_x, x + w)
        max_y = max(max_y, y + h)

    x, y = int(min_x), int(min_y)
    w, h = int(max_x - min_x), int(max_y - min_y)
    if w == 0 or h == 0:
        return None, dark

    aspect = w / float(h)
    if aspect >= aspect_max:
        return None, dark

    pad = max(h, w) + 20
    padded = np.zeros((pad, pad), dtype=np.uint8)
    sx = (pad - w) // 2
    sy = (pad - h) // 2
    padded[sy:sy+h, sx:sx+w] = th[y:y+h, x:x+w]

    resized = cv2.resize(padded, (28, 28), interpolation=cv2.INTER_LINEAR)
    return resized, dark
