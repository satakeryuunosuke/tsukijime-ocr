"""
Phase 0/1 検証用: 既存 Keras(.h5) モデルの推論結果を「正解ベクトル」として書き出す。
ブラウザ側 (TensorFlow.js) で同じ入力を推論し、出力が一致するかを確認するために使う。
既存環境 (TF 2.19) で実行すること。
"""
import os
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
import json
import numpy as np
import tensorflow as tf

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.abspath(os.path.join(HERE, "..", "..", "config", "handwritten_digit_recognizer.h5"))
OUT_PATH = os.path.join(HERE, "testdata", "reference_vectors.json")

def main():
    model = tf.keras.models.load_model(MODEL_PATH)
    model.summary()

    rng = np.random.default_rng(42)
    samples = []
    # 再現可能な 5 サンプル（0..1 正規化済み 28x28x1）
    for i in range(5):
        img = rng.random((28, 28, 1)).astype("float32")
        x = np.expand_dims(img, axis=0)
        pred = model.predict(x, verbose=0)[0]
        samples.append({
            "id": i,
            "input": img.reshape(-1).tolist(),   # 784 値
            "output": pred.tolist(),             # 10 値
            "argmax": int(np.argmax(pred)),
            "confidence": float(np.max(pred)),
        })

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "model": os.path.basename(MODEL_PATH),
            "input_shape": list(model.inputs[0].shape),
            "output_shape": list(model.outputs[0].shape),
            "samples": samples,
        }, f)
    print(f"\n書き出し完了: {OUT_PATH}  (samples={len(samples)})")

if __name__ == "__main__":
    main()
