// 台形補正画像の上に ROI 枠と認識値を描画（visualizer_C.draw_predictions_on_image 相当）。
//   低信頼度: 赤（太）/ 選択中: 青 / 通常: 緑
// canvas には既に台形補正画像が描かれている前提。その上に重ね描きする。
export function drawOverlay(canvas, roiRows, predictions, selected) {
  const ctx = canvas.getContext("2d");
  ctx.font = "bold 16px system-ui, sans-serif";
  ctx.textBaseline = "alphabetic";

  for (const r of roiRows) {
    const val = predictions[r.name] ?? "";
    const low = predictions[`${r.name}_low_confidence_flag`] === true;
    if (val === "" && r.name !== selected && !low) continue;

    const color = r.name === selected ? "#2563eb" : low ? "#dc2626" : "#059669";
    ctx.strokeStyle = color;
    ctx.lineWidth = low ? 3 : 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    if (val !== "") {
      const label = String(val);
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = color;
      ctx.fillRect(r.x, r.y - 20, tw, 20);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, r.x + 4, r.y - 5);
    }
    if (low) {
      ctx.fillStyle = "#dc2626";
      ctx.fillText("!", r.x - 14, r.y - 4);
    }
  }
}
