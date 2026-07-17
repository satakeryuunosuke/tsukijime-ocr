// 台形補正画像の上に ROI 枠と認識値を描画（visualizer_C.draw_predictions_on_image 相当）。
//   低信頼度: 赤（太）/ 選択中: 青 / 通常: 緑
// canvas には既に台形補正画像が描かれている前提。その上に重ね描きする。
export function drawOverlay(canvas, roiRows, predictions, selected) {
  const ctx = canvas.getContext("2d");
  // 表示時は縮小されるため、キャンバス幅に応じた大きめのフォントで描く
  const fs = Math.max(20, Math.round(canvas.width * 0.03));
  ctx.font = `bold ${fs}px system-ui, sans-serif`;
  ctx.textBaseline = "alphabetic";
  const boxH = fs + 8;

  for (const r of roiRows) {
    const val = predictions[r.name] ?? "";
    const low = predictions[`${r.name}_low_confidence_flag`] === true;
    if (val === "" && r.name !== selected && !low) continue;

    const color = r.name === selected ? "#2563eb" : low ? "#dc2626" : "#059669";
    ctx.strokeStyle = color;
    ctx.lineWidth = low ? 4 : 3;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    if (val !== "") {
      const label = String(val);
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = color;
      ctx.fillRect(r.x, r.y - boxH, tw, boxH);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, r.x + 5, r.y - 7);
    }
    if (low) {
      ctx.fillStyle = "#dc2626";
      ctx.fillText("!", r.x - fs, r.y - 5);
    }
  }
}
