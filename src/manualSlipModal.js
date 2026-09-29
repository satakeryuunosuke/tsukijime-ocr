// 交換票の手動登録・編集モーダル。
// スキャン画像なしで交換票を直接作成・保存・編集できる。
import { fillTotalFromQty, qtyOf, toInt } from "./validate.js";
import { formatYm } from "./dateUtils.js";

function generateDefaultName(existingNames, day) {
  let idx = 1;
  while (true) {
    const candidate = `手動_${day}日_${idx}`;
    if (!existingNames.has(candidate)) return candidate;
    idx++;
  }
}

/**
 * 手動登録モーダルを開く
 * @param {Object} options
 * @param {string} options.ym - 対象年月 (例: "2026-07")
 * @param {Array} options.products - 商品マスタ配列
 * @param {number} options.maxDays - 対象月の日数
 * @param {Set} options.existingNames - 既存伝票名セット
 * @param {Object} [options.initialPage] - 編集対象ページ（新規時はnull）
 * @param {Function} options.onSave - async (pageData) => void
 * @param {Function} [options.onDelete] - async (pageName) => void
 */
export function openManualSlipModal({
  ym,
  products,
  maxDays,
  existingNames = new Set(),
  initialPage = null,
  onSave,
  onDelete,
}) {
  return new Promise((resolve) => {
    const isEdit = !!initialPage;
    let currentRowId = 0;

    const overlay = document.createElement("div");
    overlay.className = "manual-slip-overlay";
    overlay.innerHTML = `
      <div class="manual-slip-modal" role="dialog" aria-modal="true" aria-labelledby="manualSlipTitle">
        <div class="manual-slip-head">
          <div class="manual-slip-title-wrap">
            <h3 id="manualSlipTitle" class="manual-slip-title">${isEdit ? "交換票の編集" : "交換票の手動登録"}</h3>
            <span class="manual-slip-ym-badge">${formatYm(ym)}</span>
          </div>
          <button type="button" class="manual-slip-close" title="閉じる" aria-label="閉じる">✕</button>
        </div>

        <div class="manual-slip-body">
          <div class="manual-slip-meta-grid">
            <div class="manual-field-group">
              <label for="manualSlipDay">交換日 <span class="manual-req">*</span></label>
              <div class="manual-day-wrap">
                <select id="manualSlipDay" class="manual-select-day">
                  ${Array.from({ length: maxDays }, (_, i) => i + 1)
                    .map((d) => `<option value="${d}">${d}日</option>`)
                    .join("")}
                </select>
              </div>
            </div>
            <div class="manual-field-group">
              <label for="manualSlipName">伝票名 <span class="manual-req">*</span></label>
              <input type="text" id="manualSlipName" class="manual-input-name" placeholder="伝票名を入力" />
            </div>
          </div>

          <div class="manual-slip-items-section">
            <div class="manual-items-heading">
              <span class="manual-items-title">交換（購入）商品</span>
              <span class="manual-items-hint">※商品を選び、右側の矢印または数値入力で個数を指定してください</span>
            </div>

            <div class="manual-items-header">
              <span class="manual-header-product">商品名</span>
              <span class="manual-header-qty">個数</span>
              <span class="manual-header-action"></span>
            </div>

            <div id="manualItemsContainer" class="manual-items-container"></div>

            <button type="button" id="manualAddRowBtn" class="manual-btn-add-row" title="入力行を増やす">
              <span class="manual-plus-icon">＋</span> 商品を追加
            </button>
          </div>

          <div class="manual-slip-summary-panel">
            <div class="manual-summary-stat">
              <span class="manual-summary-label">品目数:</span>
              <span id="manualTotalKinds" class="manual-summary-value">0 品目</span>
            </div>
            <div class="manual-summary-stat">
              <span class="manual-summary-label">合計点数:</span>
              <span id="manualTotalPoints" class="manual-summary-value highlight">0 点</span>
            </div>
          </div>

          <div id="manualSlipError" class="manual-slip-error" hidden></div>
        </div>

        <div class="manual-slip-foot">
          <div class="manual-foot-left">
            ${isEdit && onDelete ? `<button type="button" id="manualDeleteBtn" class="btn-sub manual-btn-delete">この交換票を削除</button>` : ""}
          </div>
          <div class="manual-foot-right">
            <button type="button" id="manualCancelBtn" class="btn-sub">キャンセル</button>
            <button type="button" id="manualSaveBtn" class="btn">${isEdit ? "更新する" : "登録する"}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const daySelect = overlay.querySelector("#manualSlipDay");
    const nameInput = overlay.querySelector("#manualSlipName");
    const container = overlay.querySelector("#manualItemsContainer");
    const addRowBtn = overlay.querySelector("#manualAddRowBtn");
    const totalKindsEl = overlay.querySelector("#manualTotalKinds");
    const totalPointsEl = overlay.querySelector("#manualTotalPoints");
    const errorEl = overlay.querySelector("#manualSlipError");
    const saveBtn = overlay.querySelector("#manualSaveBtn");
    const cancelBtn = overlay.querySelector("#manualCancelBtn");
    const deleteBtn = overlay.querySelector("#manualDeleteBtn");
    const closeBtn = overlay.querySelector(".manual-slip-close");

    const close = () => {
      overlay.remove();
      resolve(null);
    };

    closeBtn.addEventListener("click", close);
    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    const showError = (msg) => {
      if (!msg) {
        errorEl.hidden = true;
        errorEl.textContent = "";
      } else {
        errorEl.hidden = false;
        errorEl.textContent = msg;
      }
    };

    // 商品選択肢のHTMLキャッシュ（先頭に未選択肢を追加）
    const productOptionsHtml = [
      `<option value="">-- 商品を選択してください --</option>`,
      ...products.map((p) => `<option value="${p.key}">${p.name}（${p.points}点）</option>`),
    ].join("");

    // 行追加
    function addRow(initKey = "", initQty = 1) {
      currentRowId++;
      const rowId = currentRowId;
      const row = document.createElement("div");
      row.className = "manual-item-row";
      row.dataset.rowId = String(rowId);

      const defaultKey = initKey || "";
      row.innerHTML = `
        <div class="manual-col-product">
          <select class="manual-product-select" aria-label="商品">
            ${productOptionsHtml}
          </select>
        </div>
        <div class="manual-col-qty">
          <input type="number" class="manual-qty-input" min="1" max="99" step="1" value="${initQty}" aria-label="個数" />
        </div>
        <div class="manual-col-action">
          <button type="button" class="manual-row-remove-btn" title="この行を削除" aria-label="行を削除">✕</button>
        </div>
      `;

      const sel = row.querySelector(".manual-product-select");
      if (defaultKey) sel.value = defaultKey;

      const qtyInp = row.querySelector(".manual-qty-input");
      const removeBtn = row.querySelector(".manual-row-remove-btn");

      const onRowChange = () => {
        showError("");
        updateSummary();
      };

      sel.addEventListener("change", onRowChange);
      qtyInp.addEventListener("input", onRowChange);
      removeBtn.addEventListener("click", () => {
        row.remove();
        showError("");
        updateSummary();
        // もし行が0件になったら自動で1行追加
        if (container.children.length === 0) {
          addRow();
        }
      });

      container.appendChild(row);
      updateSummary();
      return row;
    }

    // 集計の更新
    function updateSummary() {
      const rows = Array.from(container.querySelectorAll(".manual-item-row"));
      const qtyMap = new Map();
      let totalPts = 0;

      rows.forEach((row) => {
        const sel = row.querySelector(".manual-product-select");
        const qtyInp = row.querySelector(".manual-qty-input");
        if (!sel || !qtyInp) return;
        const key = sel.value;
        const qty = toInt(qtyInp.value);
        if (key && qty > 0) {
          qtyMap.set(key, (qtyMap.get(key) || 0) + qty);
        }
      });

      const pMap = new Map(products.map((p) => [p.key, p]));
      for (const [key, q] of qtyMap.entries()) {
        const p = pMap.get(key);
        if (p) {
          totalPts += p.points * q;
        }
      }

      totalKindsEl.textContent = `${qtyMap.size} 品目`;
      totalPointsEl.textContent = `${totalPts} 点`;
    }

    // ＋ボタン押下
    addRowBtn.addEventListener("click", () => {
      const newRow = addRow();
      const sel = newRow.querySelector(".manual-product-select");
      if (sel) sel.focus();
    });

    // 日付変更時に自動伝票名を追従（未編集時のみ）
    let nameManuallyEdited = isEdit;
    nameInput.addEventListener("input", () => {
      nameManuallyEdited = true;
      showError("");
    });

    daySelect.addEventListener("change", () => {
      if (!nameManuallyEdited && !isEdit) {
        nameInput.value = generateDefaultName(existingNames, toInt(daySelect.value));
      }
      showError("");
    });

    // 初期値セット
    if (isEdit) {
      const p = initialPage.predictions || {};
      const day = toInt(p.date_1) * 10 + toInt(p.date_0) || 1;
      daySelect.value = String(day);
      nameInput.value = initialPage.name || "";

      let addedAny = false;
      for (const prod of products) {
        const q = qtyOf(p, prod.key);
        if (q > 0) {
          addRow(prod.key, q);
          addedAny = true;
        }
      }
      if (!addedAny) addRow();
    } else {
      const initialDay = 1;
      daySelect.value = String(initialDay);
      nameInput.value = generateDefaultName(existingNames, initialDay);
      addRow();
    }

    // 削除ボタン
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!window.confirm(`交換票「${initialPage.name}」を削除してもよろしいですか？`)) return;
        overlay.remove();
        if (onDelete) await onDelete(initialPage.name);
        resolve({ action: "deleted", name: initialPage.name });
      });
    }

    // 保存ボタン
    saveBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        showError("伝票名を入力してください。");
        nameInput.focus();
        return;
      }

      // 重複チェック（自分自身の名前以外で既存と被る場合）
      const origName = isEdit ? initialPage.name : null;
      if (name !== origName && existingNames.has(name)) {
        showError(`伝票名「${name}」は既に存在します。別の名前を入力してください。`);
        nameInput.focus();
        return;
      }

      const day = toInt(daySelect.value);
      if (day < 1 || day > maxDays) {
        showError(`交換日は 1日〜${maxDays}日 の範囲で選択してください。`);
        daySelect.focus();
        return;
      }

      // 商品データの集約
      const rows = Array.from(container.querySelectorAll(".manual-item-row"));
      const qtyMap = new Map();
      let hasUnselectedProduct = false;
      let hasInvalidQty = false;

      rows.forEach((row) => {
        const sel = row.querySelector(".manual-product-select");
        const qtyInp = row.querySelector(".manual-qty-input");
        if (!sel || !qtyInp) return;
        const key = sel.value;
        if (!key) {
          hasUnselectedProduct = true;
          return;
        }
        const rawVal = qtyInp.value.trim();
        const qty = toInt(rawVal);
        if (rawVal === "" || isNaN(qty) || qty <= 0) {
          hasInvalidQty = true;
        } else {
          qtyMap.set(key, (qtyMap.get(key) || 0) + qty);
        }
      });

      if (hasUnselectedProduct) {
        showError("商品が選択されていない行があります。商品を選択するか、右端の「✕」で行を削除してください。");
        return;
      }

      if (hasInvalidQty) {
        showError("すべての商品の個数に 1 以上の数値を入力してください。");
        return;
      }

      if (qtyMap.size === 0) {
        showError("商品を1品目以上選択してください。");
        return;
      }

      // 1商品あたり99個上限チェック（記入欄互換）
      for (const [key, q] of qtyMap.entries()) {
        if (q > 99) {
          const pObj = products.find((x) => x.key === key);
          showError(`「${pObj ? pObj.name : key}」の合計個数が99個を超えています（現在 ${q}個）。1伝票あたり最大99個まで登録可能です。`);
          return;
        }
      }

      // predictions オブジェクト構築
      const predictions = {
        date_1: String(Math.floor(day / 10)),
        date_0: String(day % 10),
      };

      for (const p of products) {
        const q = qtyMap.get(p.key) || 0;
        if (q > 0) {
          const tens = Math.floor(q / 10);
          predictions[`${p.key}_1`] = tens ? String(tens) : "";
          predictions[`${p.key}_0`] = String(q % 10);
        } else {
          predictions[`${p.key}_1`] = "";
          predictions[`${p.key}_0`] = "";
        }
      }

      // 合計点数 (total_0, total_1, total_2) を自動計算
      fillTotalFromQty(predictions, products);

      const resultPage = {
        name,
        predictions,
        savedAt: new Date().toISOString(),
        manual: true,
        ok: true,
      };

      overlay.remove();
      if (onSave) {
        await onSave({
          page: resultPage,
          previousName: isEdit ? origName : null,
        });
      }
      resolve({ action: isEdit ? "updated" : "created", page: resultPage });
    });
  });
}
