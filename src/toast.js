// 画面下部に一時的に表示する小さな通知トースト。
// 保存→ホームへ自動で戻ったときに「保存された」ことを知らせる用途。
export function toast(msg) {
  document.querySelectorAll(".app-toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "app-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 2600);
}
