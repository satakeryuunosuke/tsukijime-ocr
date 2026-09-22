"""
TensorFlow.js (Keras3) の group1-shard1of1.bin を PyTorch モデルへロードし、
相互変換（PyTorch -> TF.js）を行うモジュール。
"""

import os
import json
import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np

class DigitCNN(nn.Module):
    def __init__(self):
        super().__init__()
        # Conv2D(32, 3x3)
        self.conv1 = nn.Conv2d(1, 32, kernel_size=3)
        # Conv2D(64, 3x3)
        self.conv2 = nn.Conv2d(32, 64, kernel_size=3)
        # Dense(128) - input shape is 5x5x64 = 1600
        self.fc1 = nn.Linear(1600, 128)
        # Dense(10)
        self.fc2 = nn.Linear(128, 10)

    def forward(self, x):
        # x: [B, 1, 28, 28], values in [0, 1]
        x = F.relu(self.conv1(x))
        x = F.max_pool2d(x, 2, 2)
        x = F.relu(self.conv2(x))
        x = F.max_pool2d(x, 2, 2)
        # Keras flatten order: (H, W, C) -> permute from (C, H, W) to (H, W, C) before flatten
        x = x.permute(0, 2, 3, 1).contiguous().view(-1, 1600)
        x = F.relu(self.fc1(x))
        x = self.fc2(x)
        # softmax in inference, raw logits in training
        return x

def load_tfjs_weights(model, bin_path, meta_path):
    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    weights_info = meta["weightsManifest"][0]["weights"]
    with open(bin_path, "rb") as f:
        buf = f.read()

    weights = {}
    offset = 0
    for w in weights_info:
        name = w["name"]
        shape = w["shape"]
        count = int(np.prod(shape))
        arr = np.frombuffer(buf, dtype=np.float32, count=count, offset=offset).reshape(shape)
        weights[name] = arr
        offset += count * 4

    # conv2d: kernel [3, 3, 1, 32] -> PyTorch [32, 1, 3, 3]
    k_conv1 = torch.tensor(weights["conv2d/kernel"]).permute(3, 2, 0, 1).contiguous()
    b_conv1 = torch.tensor(weights["conv2d/bias"])
    model.conv1.weight.data.copy_(k_conv1)
    model.conv1.bias.data.copy_(b_conv1)

    # conv2d_1: kernel [3, 3, 32, 64] -> PyTorch [64, 32, 3, 3]
    k_conv2 = torch.tensor(weights["conv2d_1/kernel"]).permute(3, 2, 0, 1).contiguous()
    b_conv2 = torch.tensor(weights["conv2d_1/bias"])
    model.conv2.weight.data.copy_(k_conv2)
    model.conv2.bias.data.copy_(b_conv2)

    # dense: kernel [1600, 128] -> PyTorch [128, 1600]
    k_fc1 = torch.tensor(weights["dense/kernel"]).t().contiguous()
    b_fc1 = torch.tensor(weights["dense/bias"])
    model.fc1.weight.data.copy_(k_fc1)
    model.fc1.bias.data.copy_(b_fc1)

    # dense_1: kernel [128, 10] -> PyTorch [10, 128]
    k_fc2 = torch.tensor(weights["dense_1/kernel"]).t().contiguous()
    b_fc2 = torch.tensor(weights["dense_1/bias"])
    model.fc2.weight.data.copy_(k_fc2)
    model.fc2.bias.data.copy_(b_fc2)

    return model

def save_tfjs_weights(model, out_bin_path):
    """PyTorchモデルの重みを TF.js group1-shard1of1.bin 形式に保存"""
    # 順序: conv2d/kernel, conv2d/bias, conv2d_1/kernel, conv2d_1/bias, dense/kernel, dense/bias, dense_1/kernel, dense_1/bias
    tensors = []
    
    # conv2d/kernel: [32, 1, 3, 3] -> [3, 3, 1, 32]
    k1 = model.conv1.weight.data.permute(2, 3, 1, 0).contiguous().cpu().numpy()
    b1 = model.conv1.bias.data.cpu().numpy()
    tensors.extend([k1, b1])

    # conv2d_1/kernel: [64, 32, 3, 3] -> [3, 3, 32, 64]
    k2 = model.conv2.weight.data.permute(2, 3, 1, 0).contiguous().cpu().numpy()
    b2 = model.conv2.bias.data.cpu().numpy()
    tensors.extend([k2, b2])

    # dense/kernel: [128, 1600] -> [1600, 128]
    k3 = model.fc1.weight.data.t().contiguous().cpu().numpy()
    b3 = model.fc1.bias.data.cpu().numpy()
    tensors.extend([k3, b3])

    # dense_1/kernel: [10, 128] -> [128, 10]
    k4 = model.fc2.weight.data.t().contiguous().cpu().numpy()
    b4 = model.fc2.bias.data.cpu().numpy()
    tensors.extend([k4, b4])

    with open(out_bin_path, "wb") as f:
        for t in tensors:
            f.write(t.astype(np.float32).tobytes())

if __name__ == "__main__":
    bin_path = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "model", "group1-shard1of1.bin")
    meta_path = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "model", "model.json")
    model = DigitCNN()
    load_tfjs_weights(model, bin_path, meta_path)
    model.eval()

    # テスト入力
    dummy = torch.randn(2, 1, 28, 28)
    with torch.no_grad():
        out = F.softmax(model(dummy), dim=1)
    print("PyTorch model forward OK! Output shape:", out.shape)
    print("Probabilities sum:", out.sum(dim=1))
