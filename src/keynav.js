// 入力欄のキーボード移動ヘルパー。
// inputs: 行優先（左→右、上→下）で並んだ入力欄の配列、cols: 1行あたりの列数。
// Enter / ↓ で下のセル、↑ で上のセル、cols>1 のときは ← → で左右のセルへ移動する。
export function bindGridNav(inputs, cols = 1) {
  inputs.forEach((inp, i) => {
    inp.addEventListener("keydown", (e) => {
      let j = null;
      if (e.key === "Enter" || e.key === "ArrowDown") j = i + cols;
      else if (e.key === "ArrowUp") j = i - cols;
      else if (cols > 1 && e.key === "ArrowRight") j = i + 1;
      else if (cols > 1 && e.key === "ArrowLeft") j = i - 1;
      if (j === null || j < 0 || j >= inputs.length) return;
      e.preventDefault();
      inputs[j].focus();
      if (inputs[j].select) inputs[j].select();
    });
  });
}
