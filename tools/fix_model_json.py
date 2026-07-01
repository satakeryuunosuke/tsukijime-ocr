"""
Keras 3 で書き出した .h5 を tensorflowjs で変換すると、InputLayer の設定キーが
`batch_shape` になり、TensorFlow.js の loadLayersModel が理解できない
（`batchInputShape` を期待する）。この不整合を model.json 側で吸収する。

使い方:
    python fix_model_json.py <model.jsonのパス>
再変換のたびに実行すること。
"""
import json
import sys
import os

def fix(model_json_path):
    with open(model_json_path, "r", encoding="utf-8") as f:
        m = json.load(f)

    model_cfg = m["modelTopology"]["model_config"]["config"]
    layers = model_cfg["layers"]
    changed = 0
    for layer in layers:
        cfg = layer.get("config", {})
        if layer.get("class_name") == "InputLayer":
            if "batch_shape" in cfg and "batchInputShape" not in cfg:
                cfg["batchInputShape"] = cfg.pop("batch_shape")
                changed += 1
            # tfjs の InputLayer は ragged を受け付けない
            cfg.pop("ragged", None)
        # tfjs が解釈できない Keras3 固有キーを各層から除去
        cfg.pop("synchronizable", None)

    # Keras3 は重み名をモデル名で前置する（例: "sequential/conv2d/kernel"）。
    # tfjs は層名基準（"conv2d/kernel"）を期待するため、先頭プレフィックスを除去する。
    model_name = model_cfg.get("name")
    stripped = 0
    if model_name:
        prefix = model_name + "/"
        for grp in m.get("weightsManifest", []):
            for w in grp.get("weights", []):
                if w["name"].startswith(prefix):
                    w["name"] = w["name"][len(prefix):]
                    stripped += 1
    print(f"重み名プレフィックス除去: {stripped} 件 (prefix='{model_name}/')")

    with open(model_json_path, "w", encoding="utf-8") as f:
        json.dump(m, f)
    print(f"修正完了: {model_json_path}  (InputLayer修正 {changed} 件)")

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(__file__), "..", "public", "assets", "model", "model.json")
    fix(os.path.abspath(path))
