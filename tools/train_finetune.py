"""
抽出した実データ（疑似ラベル付き）を用いて
現行CNNモデルの重みをファインチューニングし、
更新後の重みを TensorFlow.js (group1-shard1of1.bin) に直接書き戻すスクリプト。
"""

import os
import sys
import json
import random
import shutil
import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader

from model_compat import DigitCNN, load_tfjs_weights, save_tfjs_weights

# シード固定
def set_seed(seed=42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

class DigitDataset(Dataset):
    def __init__(self, samples, images_dir, is_train=True):
        self.samples = samples
        self.images_dir = images_dir
        self.is_train = is_train

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        item = self.samples[idx]
        img_path = os.path.join(self.images_dir, item["file"])
        img = cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            img = np.zeros((28, 28), dtype=np.uint8)

        # データ拡張（訓練時のみ）
        if self.is_train:
            # 微小回転 (±6度)
            angle = random.uniform(-6, 6)
            # 微小移動 (±1.5px)
            tx = random.uniform(-1.5, 1.5)
            ty = random.uniform(-1.5, 1.5)
            # スケーリング (0.92〜1.08)
            scale = random.uniform(0.92, 1.08)

            M = cv2.getRotationMatrix2D((14, 14), angle, scale)
            M[0, 2] += tx
            M[1, 2] += ty
            img = cv2.warpAffine(img, M, (28, 28), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)

        # 0.0〜1.0 に正規化
        tensor = torch.tensor(img, dtype=torch.float32).unsqueeze(0) / 255.0
        label = torch.tensor(item["label"], dtype=torch.long)
        return tensor, label

def train_finetune(
    dataset_dir="dataset_extracted",
    epochs=15,
    batch_size=32,
    lr=1e-4,
    val_split=0.15
):
    set_seed(42)

    meta_json = os.path.join(dataset_dir, "dataset.json")
    if not os.path.exists(meta_json):
        print(f"Error: {meta_json} が見つかりません。先に抽出スクリプトを実行してください。")
        return

    with open(meta_json, "r", encoding="utf-8") as f:
        meta = json.load(f)

    samples = meta.get("samples", [])
    if len(samples) < 20:
        print(f"警告: 抽出サンプル数が少なすぎます ({len(samples)} 枚)。")
        return

    print(f"=== ファインチューニング開始 ===")
    print(f"利用可能サンプル総数: {len(samples)} 枚")

    # シャッフルして Train / Val に分割
    random.shuffle(samples)
    val_size = max(10, int(len(samples) * val_split))
    train_samples = samples[val_size:]
    val_samples = samples[:val_size]

    print(f"訓練データ: {len(train_samples)} 枚, 検証データ: {len(val_samples)} 枚")

    images_dir = os.path.join(dataset_dir, "images")
    train_ds = DigitDataset(train_samples, images_dir, is_train=True)
    val_ds = DigitDataset(val_samples, images_dir, is_train=False)

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False)

    # モデル構築 & 既存重みのロード
    bin_path = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "model", "group1-shard1of1.bin")
    model_json_path = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "model", "model.json")

    model = DigitCNN()
    load_tfjs_weights(model, bin_path, model_json_path)

    # 事前精度（現行モデルのベースライン）
    model.eval()
    correct = 0
    total = 0
    with torch.no_grad():
        for x, y in val_loader:
            preds = model(x).argmax(dim=1)
            correct += (preds == y).sum().item()
            total += y.size(0)
    baseline_acc = (correct / total) * 100.0 if total > 0 else 0
    print(f"\n現行モデルの検証データ精度 (Baseline Acc): {baseline_acc:.2f}%\n")

    # クラス重みの計算（少ない数字4, 6, 7, 8, 9の損失を重視）
    from collections import Counter
    train_counts = Counter([s["label"] for s in train_samples])
    total_train = len(train_samples)
    weights = []
    for c in range(10):
        cnt = train_counts.get(c, 1)
        # スムージング付き逆頻度
        w = total_train / (10.0 * cnt)
        weights.append(min(5.0, max(0.2, w))) # クリッピング
    class_weights_t = torch.tensor(weights, dtype=torch.float32)
    print(f"クラス重み: {[round(w, 2) for w in weights]}")

    # 損失関数 & オプティマイザ
    criterion = nn.CrossEntropyLoss(weight=class_weights_t)
    optimizer = optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)

    best_val_loss = float("inf")
    best_weights = None
    best_acc = 0.0

    for epoch in range(1, epochs + 1):
        # 訓練
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for x, y in train_loader:
            optimizer.zero_grad()
            logits = model(x)
            loss = criterion(logits, y)
            loss.backward()
            optimizer.step()

            train_loss += loss.item() * y.size(0)
            train_correct += (logits.argmax(dim=1) == y).sum().item()
            train_total += y.size(0)

        train_loss /= max(1, train_total)
        train_acc = (train_correct / train_total) * 100.0

        # 検証
        model.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0
        with torch.no_grad():
            for x, y in val_loader:
                logits = model(x)
                loss = criterion(logits, y)
                val_loss += loss.item() * y.size(0)
                val_correct += (logits.argmax(dim=1) == y).sum().item()
                val_total += y.size(0)

        val_loss /= max(1, val_total)
        val_acc = (val_correct / val_total) * 100.0

        print(f"Epoch [{epoch:02d}/{epochs:02d}] "
              f"Train Loss: {train_loss:.4f}, Acc: {train_acc:.1f}% | "
              f"Val Loss: {val_loss:.4f}, Acc: {val_acc:.1f}%")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_acc = val_acc
            # モデル状態をディープコピー
            best_weights = {k: v.cpu().clone() for k, v in model.state_dict().items()}

    print(f"\n最良検証精度: {best_acc:.2f}% (Loss: {best_val_loss:.4f})")

    # 最良モデルを復元
    if best_weights is not None:
        model.load_state_dict(best_weights)

    # 既存の group1-shard1of1.bin をバックアップ
    bak_path = bin_path + ".bak"
    if not os.path.exists(bak_path):
        shutil.copyfile(bin_path, bak_path)
        print(f"既存重みのバックアップを作成しました: {bak_path}")

    # 新しい重みを直接書き込み
    save_tfjs_weights(model, bin_path)
    print(f"新モデルの重みを保存しました: {bin_path}")
    print("TensorFlow.js へのデプロイ完了！Webアプリを再読み込みすれば即座に新モデルで推論されます。")

if __name__ == "__main__":
    ds_dir = os.path.join(os.path.dirname(__file__), "..", "dataset_extracted")
    train_finetune(dataset_dir=ds_dir)
