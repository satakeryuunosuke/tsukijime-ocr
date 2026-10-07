// 棚卸差異商品のスキャン画像・読み取り内容照合モーダル。
// 月締め・棚卸で実棚数と差異があった商品に限定して、
// スキャン交換票画像および手書き枠（ROI）とAI認識内容を突き合わせて確認・訂正できる。
import { toInt, qtyOf, daysInMonth, computeTotalScore } from "./validate.js";
import { computeLedger, computeDiffs } from "./ledger.js";
import { formatYm } from "./dateUtils.js";
import { putMonth } from "./db.js";
import { openReview } from "./review.js";
import { openManualSlipModal } from "./manualSlipModal.js";
import { toast } from "./toast.js";
import { escapeHtml } from "./escape.js";

function ensureTotal0(roiRows) {
  if (!roiRows || roiRows.some((r) => r.name === "total_0")) return roiRows;
  const t1 = roiRows.find((r) => r.name === "total_1");
  const t2 = roiRows.find((r) => r.name === "total_2");
  if (t1 && t2) {
    const dx = t1.x - t2.x;
    return [...roiRows, { name: "total_0", x: t1.x + dx, y: t1.y, h: t1.h, w: t1.w }];
  }
  return roiRows;
}

// 画像の遅延読み込み（キャッシュ付き）
const imgCache = new Map();
function loadCachedImage(src) {
  if (!src) return Promise.resolve(null);
  if (imgCache.has(src)) return Promise.resolve(imgCache.get(src));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imgCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * 手書きセル（ROI）をスキャン画像から切り出して canvas に描画
 */
function renderRoiCrop(canvas, img, roiRows, productKey) {
  if (!canvas || !img || !roiRows) return;
  const rois = roiRows.filter((r) => r.name.startsWith(productKey + "_"));
  if (!rois.length) return;

  const minX = Math.min(...rois.map((r) => r.x));
  const minY = Math.min(...rois.map((r) => r.y));
  const maxX = Math.max(...rois.map((r) => r.x + r.w));
  const maxY = Math.max(...rois.map((r) => r.y + r.h));

  // 適度な余白をつけて見やすくする
  const padX = Math.max(12, Math.round((maxX - minX) * 0.2));
  const padY = Math.max(10, Math.round((maxY - minY) * 0.2));

  const cropX = Math.max(0, minX - padX);
  const cropY = Math.max(0, minY - padY);
  const cropW = Math.min(img.naturalWidth - cropX, (maxX - minX) + padX * 2);
  const cropH = Math.min(img.naturalHeight - cropY, (maxY - minY) + padY * 2);

  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  // 個別の枠線をハイライト
  rois.forEach((r) => {
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(r.x - cropX, r.y - cropY, r.w, r.h);
  });
}

/**
 * 全体画像を canvas に描画し、対象商品のROI枠をハイライト
 */
function renderFullSlipCanvas(canvas, img, roiRows, targetProducts) {
  if (!canvas || !img) return;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  if (!roiRows || !targetProducts || !targetProducts.length) return;

  const fs = Math.max(18, Math.round(canvas.width * 0.024));
  ctx.font = `bold ${fs}px system-ui, sans-serif`;
  ctx.textBaseline = "alphabetic";

  targetProducts.forEach((p) => {
    const pRois = roiRows.filter((r) => r.name.startsWith(p.key + "_"));
    pRois.forEach((r) => {
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 3.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      // 商品名ラベル
      const label = `${p.name}`;
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = "rgba(37, 99, 235, 0.9)";
      ctx.fillRect(r.x, r.y - fs - 6, tw, fs + 6);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, r.x + 4, r.y - 6);
    });
  });
}

/**
 * 画像拡大ライトボックスを表示
 */
function openImageLightbox(imgSrc, title) {
  const lb = document.createElement("div");
  lb.className = "disc-lightbox-overlay";
  lb.innerHTML = `
    <div class="disc-lightbox-content">
      <div class="disc-lightbox-header">
        <span class="disc-lightbox-title">${title || "交換票スキャン画像"}</span>
        <button class="disc-lightbox-close" title="閉じる">✕</button>
      </div>
      <div class="disc-lightbox-body">
        <img src="${imgSrc}" class="disc-lightbox-img" alt="全体スキャン画像" />
      </div>
    </div>`;
  document.body.appendChild(lb);
  const close = () => lb.remove();
  lb.querySelector(".disc-lightbox-close").onclick = close;
  lb.addEventListener("click", (e) => { if (e.target === lb) close(); });
}

/**
 * 棚卸差異照合モーダルを開く
 * @param {Object} options
 * @param {Object} options.month - 月レコード
 * @param {Array} options.products - 商品マスタ配列
 * @param {Object} options.master - マスタ情報 (roiRows, config等)
 * @param {Object} options.app - アプリ参照 (ym, engine等)
 * @param {string} [options.initialProductKey] - 初期選択する商品key（省略時は複数あれば全選択）
 * @param {Function} [options.onUpdated] - データ訂正時のコールバック
 */
export async function openDiscrepancyModal({
  month,
  products,
  master,
  app,
  initialProductKey = null,
  onUpdated = null,
}) {
  const roiRows = ensureTotal0(master.roiRows || []);
  const maxDays = daysInMonth(month.ym);
  const isLocked = !!month.locked;

  // 差異商品の抽出
  function getDiffProductsList(curMonth) {
    const ledger = computeLedger(curMonth, products);
    const phys = curMonth.physicalCount || {};
    const list = [];
    for (const p of products) {
      const book = ledger.closing[p.key];
      const physV = curMonth.physicalCount ? toInt(phys[p.key]) : null;
      if (physV === null) continue;
      const diff = physV - book;
      if (diff !== 0) {
        list.push({
          ...p,
          book,
          phys: physV,
          diff,
          shortage: diff < 0 ? -diff : 0,
          surplus: diff > 0 ? diff : 0,
        });
      }
    }
    return { list, ledger };
  }

  let { list: diffProducts, ledger } = getDiffProductsList(month);
  if (!diffProducts.length) {
    toast("実棚数と帳簿残に差異はありません ✓");
    return;
  }

  // 初期選択タブ（複数あれば "__all__"、特定商品指定があればそのkey）
  let activeTabKey = initialProductKey && diffProducts.some((p) => p.key === initialProductKey)
    ? initialProductKey
    : diffProducts.length > 1
      ? "__all__"
      : diffProducts[0].key;

  let showAllPagesFilter = false;

  const shell = document.createElement("div");
  shell.className = "rv-overlay disc-overlay";
  shell.innerHTML = `
    <div class="rv-modal disc-modal">
      <div class="rv-head disc-head">
        <div class="rv-title-wrap">
          <span class="rv-title">🔍 棚卸差異のスキャン照合・確認</span>
          <span class="disc-ym-badge">${formatYm(month.ym)}</span>
          ${isLocked ? '<span class="rv-badge err">🔒 月締めロック中（確認のみ）</span>' : ""}
        </div>
        <button class="rv-close disc-close" title="閉じる">✕</button>
      </div>
      <div class="rv-body disc-body">
        <div class="disc-tabs-wrap">
          <div class="disc-tabs-label">差異がある商品（選択して確認）:</div>
          <div class="disc-tabs" id="discTabs"></div>
        </div>
        <div class="disc-summary-wrap" id="discSummary"></div>
        <div class="disc-filter-bar">
          <div class="disc-filter-options">
            <button type="button" class="btn-sub disc-filter-btn active" id="discFilterOnly">該当商品の交換がある交換票のみ</button>
            <button type="button" class="btn-sub disc-filter-btn" id="discFilterAll">当月の全交換票を表示</button>
          </div>
          <div class="disc-filter-info" id="discFilterInfo"></div>
        </div>
        <div class="disc-cards-list" id="discCardsList"></div>
      </div>
    </div>`;

  document.body.appendChild(shell);

  const close = () => {
    shell.remove();
  };
  shell.querySelector(".disc-close").onclick = close;
  shell.addEventListener("click", (e) => {
    if (e.target === shell) close();
  });

  // レンダリング関数
  async function renderModalContent() {
    const diffInfo = getDiffProductsList(month);
    diffProducts = diffInfo.list;
    ledger = diffInfo.ledger;

    // もし全ての差異が解消された場合
    if (!diffProducts.length) {
      shell.querySelector("#discTabs").innerHTML = `<span class="ok">🎉 すべての商品の棚卸差異が解消されました！</span>`;
      shell.querySelector("#discSummary").innerHTML = `
        <div class="disc-summary-card ok-card">
          <p>棚卸差異はありません。実棚数と帳簿残がすべて一致しています ✓</p>
        </div>`;
      shell.querySelector("#discCardsList").innerHTML = "";
      shell.querySelector("#discFilterInfo").textContent = "";
      if (onUpdated) onUpdated(month);
      return;
    }

    // activeTabKey の妥当性確認
    if (activeTabKey !== "__all__" && !diffProducts.some((p) => p.key === activeTabKey)) {
      activeTabKey = diffProducts.length > 1 ? "__all__" : diffProducts[0].key;
    }

    // 1. タブ描画
    const tabsContainer = shell.querySelector("#discTabs");
    const tabsHtml = [];
    if (diffProducts.length > 1) {
      tabsHtml.push(`
        <button type="button" class="disc-tab ${activeTabKey === "__all__" ? "active" : ""}" data-tab="__all__">
          ✨ すべての差異商品（OR表示）
          <span class="disc-tab-badge">${diffProducts.length}品目</span>
        </button>
      `);
    }
    diffProducts.forEach((p) => {
      const diffStr = p.diff > 0 ? `+${p.diff}` : `${p.diff}`;
      const badgeCls = p.diff < 0 ? "badge-shortage" : "badge-surplus";
      tabsHtml.push(`
        <button type="button" class="disc-tab ${activeTabKey === p.key ? "active" : ""}" data-tab="${escapeHtml(p.key)}">
          ${escapeHtml(p.name)}
          <span class="disc-tab-badge ${badgeCls}">差異 ${diffStr}</span>
        </button>
      `);
    });
    tabsContainer.innerHTML = tabsHtml.join("");

    tabsContainer.querySelectorAll(".disc-tab").forEach((btn) => {
      btn.onclick = () => {
        activeTabKey = btn.dataset.tab;
        renderModalContent();
      };
    });

    // 2. 在庫・差異サマリー描画
    const summaryContainer = shell.querySelector("#discSummary");
    const isAll = activeTabKey === "__all__";

    if (isAll) {
      summaryContainer.innerHTML = `
        <div class="disc-summary-card">
          <div class="disc-summary-title">複数商品の差異まとめ（いずれかの交換を含む伝票を表示中）</div>
          <table class="result-table narrow disc-multi-table">
            <thead>
              <tr>
                <th>商品名</th>
                <th>帳簿残</th>
                <th>実棚数</th>
                <th>差異</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              ${diffProducts.map((p) => {
                const diffStr = p.diff > 0 ? `+${p.diff}` : `${p.diff}`;
                const diffCls = p.diff < 0 ? "err" : "warn";
                const statusText = p.diff < 0 ? `不足 ${p.shortage}個` : `余剰 ${p.surplus}個`;
                return `
                  <tr>
                    <td><b>${escapeHtml(p.name)}</b></td>
                    <td class="num">${p.book}</td>
                    <td class="num">${p.phys}</td>
                    <td class="num"><b class="${diffCls}">${diffStr}</b></td>
                    <td><span class="${diffCls}">${statusText}</span></td>
                  </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>`;
    } else {
      const curP = diffProducts.find((p) => p.key === activeTabKey) || diffProducts[0];
      const isNote = curP.key.startsWith("notes_");
      const rows = ledger.rows[curP.key] || [];
      const sum = (f) => rows.reduce((a, r) => a + (r[f] || 0), 0);
      const coVal = toInt((month.carryover || {})[curP.key]);
      const arrVal = sum("arrival");
      const exVal = sum("exchange");
      const cashVal = sum("cash");
      const debitVal = sum("debit");
      const pointVal = sum("point");
      const diffStr = curP.diff > 0 ? `+${curP.diff}` : `${curP.diff}`;
      const statusText = curP.diff < 0 ? `不足（実棚が ${curP.shortage}個 少ない）` : `余剰（実棚が ${curP.surplus}個 多い）`;

      summaryContainer.innerHTML = `
        <div class="disc-summary-card">
          <div class="disc-summary-header">
            <h4>${escapeHtml(curP.name)} <small>(${curP.points}点)</small></h4>
            <div class="disc-diff-banner ${curP.diff < 0 ? "err" : "warn"}">
              差異: <b>${diffStr}</b> （${statusText}）
            </div>
          </div>
          <div class="disc-breakdown-grid">
            <div class="disc-breakdown-item"><span class="lbl">月初繰越</span><span class="val">${coVal}</span></div>
            <div class="disc-breakdown-item"><span class="lbl">入庫計</span><span class="val">+${arrVal}</span></div>
            <div class="disc-breakdown-item"><span class="lbl">シール交換計</span><span class="val">-${exVal}</span></div>
            ${isNote ? `
              <div class="disc-breakdown-item"><span class="lbl">現金販売</span><span class="val">-${cashVal}</span></div>
              <div class="disc-breakdown-item"><span class="lbl">口座振替</span><span class="val">-${debitVal}</span></div>
              <div class="disc-breakdown-item"><span class="lbl">ポイント</span><span class="val">-${pointVal}</span></div>
            ` : ""}
            <div class="disc-breakdown-item highlight"><span class="lbl">月末帳簿残</span><span class="val"><b>${curP.book}</b></span></div>
            <div class="disc-breakdown-item highlight-phys"><span class="lbl">入力実棚数</span><span class="val"><b>${curP.phys}</b></span></div>
          </div>
        </div>`;
    }

    // 3. 交換票の抽出（ORロジックまたは単一商品ロジック）
    const targetProductsForFilter = isAll
      ? diffProducts
      : [diffProducts.find((p) => p.key === activeTabKey) || diffProducts[0]];

    const allPages = [...(month.pages || [])].sort((a, b) => {
      const da = toInt(a.predictions.date_1) * 10 + toInt(a.predictions.date_0);
      const db_ = toInt(b.predictions.date_1) * 10 + toInt(b.predictions.date_0);
      return da - db_ || (a.name < b.name ? -1 : 1);
    });

    const matchingPages = allPages.filter((page) =>
      targetProductsForFilter.some((p) => qtyOf(page.predictions, p.key) > 0)
    );

    const pagesToShow = showAllPagesFilter ? allPages : matchingPages;

    // フィルターボタンのアクティブ更新
    const filterOnlyBtn = shell.querySelector("#discFilterOnly");
    const filterAllBtn = shell.querySelector("#discFilterAll");
    filterOnlyBtn.classList.toggle("active", !showAllPagesFilter);
    filterAllBtn.classList.toggle("active", showAllPagesFilter);
    filterOnlyBtn.textContent = isAll
      ? `いずれかの差異商品の交換がある交換票のみ (${matchingPages.length}枚)`
      : `この商品の交換がある交換票のみ (${matchingPages.length}枚)`;
    filterAllBtn.textContent = `当月の全交換票を表示 (${allPages.length}枚)`;

    shell.querySelector("#discFilterInfo").textContent =
      `表示中: ${pagesToShow.length}枚 / 全${allPages.length}枚`;

    filterOnlyBtn.onclick = () => {
      showAllPagesFilter = false;
      renderModalContent();
    };
    filterAllBtn.onclick = () => {
      showAllPagesFilter = true;
      renderModalContent();
    };

    // 4. 交換票カード一覧の描画
    const cardsListContainer = shell.querySelector("#discCardsList");
    if (!pagesToShow.length) {
      cardsListContainer.innerHTML = `
        <div class="disc-empty-note">
          <p>対象となる交換票はありません。</p>
          ${!showAllPagesFilter && allPages.length > 0 ? `
            <p class="muted">※ 別の商品として誤読されていないか確認したい場合は、上の「当月の全交換票を表示」に切り替えてください。</p>
          ` : ""}
        </div>`;
      return;
    }

    cardsListContainer.innerHTML = pagesToShow.map((p, idx) => {
      const day = toInt(p.predictions.date_1) * 10 + toInt(p.predictions.date_0);
      const totalScore = computeTotalScore(p.predictions, products);

      // この伝票に含まれる差異商品
      const pageDiffProducts = targetProductsForFilter.filter(
        (tp) => qtyOf(p.predictions, tp.key) > 0
      );

      // 全商品のサマリー文字列
      const summaryItems = products
        .map((prod) => {
          const q = qtyOf(p.predictions, prod.key);
          return q ? `${prod.name}×${q}` : null;
        })
        .filter(Boolean);

      const badgesHtml = pageDiffProducts.length
        ? pageDiffProducts.map((dp) => `
            <span class="disc-slip-badge">
              ${escapeHtml(dp.name)}: <b>${qtyOf(p.predictions, dp.key)}個</b>
            </span>
          `).join(" ")
        : `<span class="disc-slip-badge muted">該当差異商品の交換なし (0個)</span>`;

      return `
        <div class="disc-card" data-page-idx="${idx}">
          <div class="disc-card-head">
            <div class="disc-card-meta">
              <span class="disc-card-name">${escapeHtml(p.name)}</span>
              <span class="disc-card-date">${day ? `${day}日` : "日付未入力"}</span>
              <span class="disc-card-total">合計: <b>${totalScore}</b>点</span>
            </div>
            <div class="disc-card-badges">${badgesHtml}</div>
            <div class="disc-card-actions">
              ${isLocked ? `
                <span class="muted" title="月締め確定済みのため編集不可">🔒 保護中</span>
              ` : `
                <button type="button" class="btn-sub disc-edit-btn" data-page-name="${escapeHtml(p.name)}">
                  ✏ 読み取り内容を訂正
                </button>
              `}
            </div>
          </div>
          <div class="disc-card-summary-row">
            <span class="lbl">伝票内の全読み取り:</span>
            <span class="val">${summaryItems.length ? summaryItems.join("、 ") : "（交換なし）"}</span>
          </div>
          <div class="disc-card-views">
            <div class="disc-rois-panel">
              <div class="disc-view-title">手書き枠の拡大プレビュー（手書き数字 vs AI読取）</div>
              <div class="disc-rois-container" id="discRois_${idx}"></div>
            </div>
            <div class="disc-full-panel">
              <div class="disc-view-title">
                <span>全体スキャン画像（該当枠をハイライト）</span>
                <small class="muted">※クリックで拡大表示</small>
              </div>
              <div class="disc-full-container" id="discFull_${idx}"></div>
            </div>
          </div>
        </div>`;
    }).join("");

    // 各カードのキャンバス描画（非同期画像ロード）
    pagesToShow.forEach(async (p, idx) => {
      const roisContainer = cardsListContainer.querySelector(`#discRois_${idx}`);
      const fullContainer = cardsListContainer.querySelector(`#discFull_${idx}`);
      if (!roisContainer || !fullContainer) return;

      if (!p.image) {
        roisContainer.innerHTML = `<div class="disc-no-img">スキャン画像なし（手動登録された交換票）</div>`;
        fullContainer.innerHTML = `<div class="disc-no-img">スキャン画像なし</div>`;
        return;
      }

      const img = await loadCachedImage(p.image);
      if (!img) {
        roisContainer.innerHTML = `<div class="disc-no-img">画像の読み込みに失敗しました</div>`;
        fullContainer.innerHTML = `<div class="disc-no-img">画像の読み込みに失敗しました</div>`;
        return;
      }

      // 手書き枠拡大の描画
      // 表示すべき差異商品: 伝票に含まれている差異商品、または0個でも選択されている商品
      const roisProductsToShow = isAll
        ? (diffProducts.filter((dp) => qtyOf(p.predictions, dp.key) > 0).length
            ? diffProducts.filter((dp) => qtyOf(p.predictions, dp.key) > 0)
            : diffProducts.slice(0, 3))
        : targetProductsForFilter;

      roisContainer.innerHTML = roisProductsToShow.map((dp) => {
        const qty = qtyOf(p.predictions, dp.key);
        return `
          <div class="disc-roi-box">
            <div class="disc-roi-meta">
              <span class="disc-roi-pname">${escapeHtml(dp.name)}</span>
              <span class="disc-roi-val">AI読取: <b>${qty}</b>個</span>
            </div>
            <canvas class="disc-roi-canvas" data-pkey="${escapeHtml(dp.key)}"></canvas>
          </div>`;
      }).join("");

      roisContainer.querySelectorAll(".disc-roi-canvas").forEach((c) => {
        const pkey = c.dataset.pkey;
        renderRoiCrop(c, img, roiRows, pkey);
      });

      // 全体画像の描画
      const fullCanvas = document.createElement("canvas");
      fullCanvas.className = "disc-full-canvas";
      renderFullSlipCanvas(fullCanvas, img, roiRows, roisProductsToShow);
      fullContainer.innerHTML = "";
      fullContainer.appendChild(fullCanvas);

      fullCanvas.onclick = () => {
        openImageLightbox(p.image, `${p.name} - スキャン画像`);
      };
    });

    // 訂正ボタンの紐付け
    cardsListContainer.querySelectorAll(".disc-edit-btn").forEach((btn) => {
      btn.onclick = async () => {
        const pageName = btn.dataset.pageName;
        const page = (month.pages || []).find((pg) => pg.name === pageName);
        if (!page) return;

        if (page.manual) {
          await openManualSlipModal({
            ym: month.ym,
            products,
            maxDays,
            existingNames: new Set(month.pages.map((pg) => pg.name)),
            initialPage: page,
            onSave: async ({ page: savedPage, previousName }) => {
              const curPages = [...(month.pages || [])];
              if (previousName && previousName !== savedPage.name) {
                const pIdx = curPages.findIndex((pg) => pg.name === previousName);
                if (pIdx >= 0) curPages.splice(pIdx, 1);
              }
              const existIdx = curPages.findIndex((pg) => pg.name === savedPage.name);
              const item = {
                name: savedPage.name,
                predictions: savedPage.predictions,
                savedAt: savedPage.savedAt,
                manual: true,
                image: null,
                coords: null,
              };
              if (existIdx >= 0) curPages[existIdx] = item;
              else curPages.push(item);

              month.pages = curPages;
              await putMonth(month);
              toast(`交換票「${savedPage.name}」を更新しました ✓`);
              await renderModalContent();
              if (onUpdated) onUpdated(month);
            },
            onDelete: async (delName) => {
              month.pages = (month.pages || []).filter((pg) => pg.name !== delName);
              await putMonth(month);
              toast(`交換票「${delName}」を削除しました`);
              await renderModalContent();
              if (onUpdated) onUpdated(month);
            },
          });
        } else {
          // 画像付き交換票の訂正モーダル起動
          const renderRaw = async (pRef) => {
            if (pRef.image) {
              const loadedImg = await loadCachedImage(pRef.image);
              if (loadedImg) {
                const c = document.createElement("canvas");
                c.width = loadedImg.naturalWidth;
                c.height = loadedImg.naturalHeight;
                c.getContext("2d").drawImage(loadedImg, 0, 0);
                return c;
              }
            }
            return null;
          };

          await openReview(page, {
            roiRows,
            products,
            model: app?.engine?.model || null,
            cfg: master.config || {},
            ym: month.ym,
            maxDays,
            checksumDigits: master.config?.checksumDigits ?? 2,
            renderRaw,
            onUpdate: async () => {
              // 訂正更新
            },
          });

          // 保存後に月データを更新
          await putMonth(month);
          toast(`交換票「${page.name}」の読み取り内容を更新しました ✓`);
          await renderModalContent();
          if (onUpdated) onUpdated(month);
        }
      };
    });
  }

  await renderModalContent();
}
