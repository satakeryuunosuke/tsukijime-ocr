// 全画面・全機能向け ヘルプ（取説・ヒント）システム
// 丸型「?」ボタンのクリックやショートカットキー（?キー）で該当機能の取説・Tipsモーダルを表示する。

export const HELP_TOPICS = {
  // === ヘッダー・共通 ===
  header_overview: {
    title: "グッズ交換・月締めシステム 全体概要",
    category: "システム共通",
    badge: "💡 基本",
    summary: "紙の交換票のAI-OCR読み取りから、繰越在庫・入庫・ノート購入・現金管理・月末棚卸・Excelレポート出力までをブラウザ内で完結して行う業務システムです。",
    steps: [
      "上部の「対象年月」で作業したい年月（例: 2026年08月）を選択します。",
      "ホーム画面の「次にやること」バナーや1〜6のカードの順に沿って作業を進めます。",
      "月末の実棚数を入力したら「月締め」画面から締め確定（ロック）し、Excelレポートを出力・保存します。",
    ],
    tips: [
      "本システムは端末内のブラウザ（IndexedDB）で安全にデータを保持し、オフラインでも完全に動作します。",
      "月末の締め完了後は「設定」→「データ管理」から定期的にバックアップ（JSON）をダウンロードして安全に保管してください。",
    ],
    related: ["header_ym", "home_overview", "closing_overview", "settings_backup"],
  },

  header_ym: {
    title: "対象年月の選択と切り替え",
    category: "システム共通",
    badge: "📅 日付操作",
    summary: "作業対象とする「年月（YYYY年MM月）」を切り替えます。全画面でこの対象年月のデータが表示・保存されます。",
    steps: [
      "◀ ボタン: 前の月に切り替えます。",
      "▶ ボタン: 次の月に切り替えます。",
      "テキスト入力欄: 「202608」や「2026/8」「2026-08」のようにキーボードで直接入力してEnterを押すと該当月にジャンプします。",
    ],
    tips: [
      "【起動時の自動判定】当月1日〜10日までは「前月締め作業中」とみなし前月が自動選択され、11日以降は「当月」が初期選択されます。",
      "月を切り替えても過去の確定データはIndexedDBに安全に残っています。",
    ],
    related: ["header_overview", "home_overview", "header_ai"],
  },

  header_ai: {
    title: "AI相談用レポート（状況のコピー）",
    category: "システム共通",
    badge: "🤖 AI連携",
    summary: "現在の画面、対象年月のデータ状況、エラーログ、システム仕様（README）を個人情報を完全に除外した状態でクリップボードにコピーします。",
    steps: [
      "ヘッダー右上の「🤖 AI相談」ボタンをクリックするか、キーボードで Ctrl + Shift + A（または Alt + A）を押します。",
      "質問や困りごとがある場合はモーダルに入力して「コピー」を押します。",
      "ChatGPTやClaude、GeminiなどのAIチャットにそのまま貼り付けて質問・相談してください。",
    ],
    tips: [
      "生徒名や手書き氏名・自由入力備考などの個人情報は自動的に完全除外されます。",
      "まっさらなAIでもアプリの全仕様を理解できるように、システム仕様書（README）が自動で付加されます。",
    ],
    related: ["header_overview", "home_overview"],
  },

  // === ホーム画面 ===
  home_overview: {
    title: "ホーム画面（月締めダッシュボード）",
    category: "ホーム",
    badge: "🏠 進行管理",
    summary: "対象年月の月締め作業の進捗状況が一目でわかるダッシュボードです。作業の流れ順に並んだカードと「次にやること」バナーが次のアクションをナビゲートします。",
    steps: [
      "画面上部の「次にやること」バナーを確認し、クリックして該当作業へ進みます。",
      "1.繰越在庫 → 2.交換票読み取り → 3.入庫 → 4.ノート購入 → 5.現金管理 → 6.月締め（棚卸）の順に進めます。",
      "すべての入力が完了したら、Excelレポートをダウンロードまたはブラウザでプレビュー確認します。",
    ],
    tips: [
      "カードの右上に「✓」が付いている項目は入力・保存済みです。",
      "月締めが確定（ロック）されると、画面全体に「🔒 締め確定済み」バッジが表示されます。",
    ],
    related: ["home_next_action", "home_report_preview", "closing_lock"],
  },

  home_next_action: {
    title: "「次にやること」バナーの仕組み",
    category: "ホーム",
    badge: "⚡ ナビゲーション",
    summary: "現在のデータの入力状況や未解決エラーを自動検知し、今最優先で行うべき作業を案内するインテリジェントバナーです。",
    steps: [
      "バナーをクリックすると、案内されている作業画面に直接ジャンプできます。",
      "未解決の読み取りエラー（要対応）がある場合は最優先で警告されます。",
      "1.繰越在庫 → 2.交換票読み取り → 3.入庫記録 → 4.ノート購入 → 5.現金管理 → 6.実棚数入力 → 月締め確定 の順で一本道で案内されます。",
      "交換票・入庫・ノート購入が0件（なし）の月は、該当画面内の「※今月は〜なし（スキップ）」ボタンを押すことでスムーズに次の工程へ進めます。",
    ],
    tips: [
      "何をすれば良いか迷ったときは、まずこのバナーに従って作業を進めるだけで月締めが完了します。",
    ],
    related: ["home_overview", "reader_needfix", "closing_lock"],
  },

  home_report_preview: {
    title: "Excelレポートの出力とプレビュー",
    category: "レポート",
    badge: "📊 出力",
    summary: "月締めの全データ（日別台帳・商品別受払・月末棚卸差異・金種計算など）を1つの公式Excelファイル（report_YYYYMM.xlsx）として出力します。",
    steps: [
      "「Excelレポート（.xlsx）」ボタンをクリックすると、端末へExcelファイルがダウンロードされます。",
      "「レポートをブラウザで見る」ボタンをクリックすると、Excelを開かずにブラウザ上で帳票内容をその場でプレビューできます。",
    ],
    tips: [
      "実棚数（棚卸）を入力するとホーム画面および月締め画面からダウンロード可能になります。",
      "フォーマットは本部指定の月締め集計表に完全対応しています。",
    ],
    related: ["closing_report", "modal_report_preview"],
  },

  // === 読み取り（AI-OCR） ===
  reader_overview: {
    title: "交換票のAI-OCR読み取り",
    category: "読み取り",
    badge: "📷 AI-OCR",
    summary: "スキャンした紙の交換票（PDFまたは画像）をブラウザ内蔵のAIエンジンで高速自動読み取りし、記入された日付・個数・合計を認識して保存します。",
    steps: [
      "ドロップゾーンに交換票のPDFファイル（複数ページOK）または画像ファイルをドラッグ＆ドロップします。",
      "AIが自動で四隅マーカーを検出し、台形歪みを補正して手書き数字を認識します。",
      "検算（チェックデジット）と日付が一致したページは自動的に「確定」としてIndexedDBに保存されます。",
      "エラーや低信頼度があったページは「要対応」にリストアップされるので、クリックして確認・訂正します。",
    ],
    tips: [
      "月内に何回かに分けて少しずつ読み取っても、同じ月のデータとして自動追記・集計されます。",
      "画像処理・AI推論はすべてお使いのPC/タブレット内で行われるため、外部サーバーへの画像流出の心配はありません。",
    ],
    related: ["reader_dropzone", "reader_needfix", "reader_approved", "reader_csv_export", "modal_review"],
  },

  reader_dropzone: {
    title: "ファイル選択と読み取り対応形式",
    category: "読み取り",
    badge: "📁 入力",
    summary: "交換票のファイルを取り込むエリアです。スキャナから出力されたPDFやスマホ写真を取り込めます。",
    steps: [
      "点線のエリアにファイルをドラッグ＆ドロップするか、「ファイルを選択」ボタンからファイルを選びます。",
      "複数ページを含む1つのPDFファイル、または複数個の画像/PDFファイルをまとめて一度に投入できます。",
    ],
    tips: [
      "対応形式: PDF (.pdf), JPEG (.jpg, .jpeg), PNG (.png)",
      "スキャン時の推奨解像度は200〜300dpi（A4サイズ）です。斜めに傾いていても四隅の黒四角マーカーがあれば自動補正されます。",
    ],
    related: ["reader_overview", "reader_needfix"],
  },

  reader_needfix: {
    title: "要対応リストの確認と訂正",
    category: "読み取り",
    badge: "⚠ 訂正",
    summary: "マーカー検出失敗、合計点数不一致（計算値≠記入値）、日付不正、低信頼度文字など、人間による確認が必要なページが一覧表示されます。",
    steps: [
      "行をクリックするか「まとめて修正」ボタンを押して、訂正モーダルを開きます。",
      "【マーカー失敗】生画像が表示されるので、交換票の四隅の黒四角を4点クリックして指定します。",
      "【合計不一致/日付不正】ハイライトされた赤枠の数字を確認し、実際の記入に合わせて修正します。",
      "「保存して確定」を押すと、確定リストへ移動して自動保存されます。",
      "「低信頼度のみのページをまとめて承認」ボタンで、検算が合っている低信頼度ページを一括確定することも可能です。",
    ],
    tips: [
      "検算（商品の点数×個数の合計と、記入された合計枠の照合）により、誤認識を見逃さず確実に防止できます。",
    ],
    related: ["reader_approved", "modal_review", "settings_reading"],
  },

  reader_approved: {
    title: "確定した読み取り結果（自動保存）",
    category: "読み取り",
    badge: "✓ 保存済み",
    summary: "検算をクリアして正しく確定・保存された交換票の一覧です。月別データに即時反映されています。",
    steps: [
      "行をクリックすると、保存済みの読み取り画像と認識結果をいつでも再確認・再編集できます。",
      "不要なページや誤って読み取ったページは、行右側の「削除」ボタンで取り消せます。",
    ],
    tips: [
      "ここで確定されたデータが、自動的に「月締め」の日別台帳や集計レポートに合算されます。",
    ],
    related: ["reader_overview", "closing_ledger", "closing_pages_list"],
  },

  reader_csv_export: {
    title: "読み取り結果CSVのダウンロード",
    category: "読み取り",
    badge: "📄 エクスポート",
    summary: "読み取った交換票のデータをCSV形式で出力します。外部集計や検算ログの確認に活用できます。",
    steps: [
      "「CSV ダウンロード」: 1行＝交換票1枚の全項目明細CSVを出力します。",
      "「日別集計CSV」: 日付ごとに各商品の交換個数をまとめた集計CSVを出力します。",
    ],
    tips: [
      "Excelで直接開いても文字化けしないUTF-8 BOM付き形式でダウンロードされます。",
    ],
    related: ["reader_overview", "backup_monthly_csv"],
  },

  // === 繰越在庫 ===
  carryover_overview: {
    title: "繰越在庫（月初在庫）の入力",
    category: "繰越在庫",
    badge: "📦 月初数",
    summary: "対象年月の「1日時点」で棚にある各商品の在庫数を登録します。当月の月締め計算の起点となる重要な数値です。",
    steps: [
      "商品ごとに、月初時点の在庫数を半角数字で入力します。",
      "前月のデータがある場合は、上部の「前月の帳簿残から自動入力」または「前月の実棚数から自動入力」ボタンを押すと一瞬で前月末の値が反映されます。",
      "入力後、下部の「保存」ボタンを押します。",
    ],
    tips: [
      "前月の月締めが完了している場合は「前月の帳簿残（または実棚数）から自動入力」を使うことで入力ミスをゼロにできます。",
      "キーボードの Enter キーまたは ↓↑ 矢印キーでテンキーから手を離さずに連続入力できます。",
    ],
    related: ["carryover_auto_fill", "carryover_keynav", "closing_ledger"],
  },

  carryover_auto_fill: {
    title: "前月データからのワンタップ自動入力",
    category: "繰越在庫",
    badge: "⚡ 自動化",
    summary: "前月の月締め結果から、当月の月初在庫数を自動計算して全入力欄に一括セットします。",
    steps: [
      "「前月の帳簿残から自動入力」: 前月の繰越＋入庫−出庫で計算された計算上の月末在庫数を引き継ぎます（通常はこちらを推奨）。",
      "「前月の実棚数から自動入力」: 前月末に実際に棚を数えた「実棚数」の値をそのまま引き継ぎたい場合に使用します。",
    ],
    tips: [
      "前月のデータが存在しない最初の月（運用開始月など）は、手動で各商品の在庫数を入力してください。",
    ],
    related: ["carryover_overview", "closing_physical_count"],
  },

  carryover_keynav: {
    title: "キーボードによる高速数値入力",
    category: "繰越在庫",
    badge: "⌨ 操作性",
    summary: "マウス操作なしで、テンキーだけでテンポよく在庫数を入力できるショートカット機能です。",
    steps: [
      "Enter キー / ↓ 矢印キー: 数値を確定して次の商品の入力欄へ移動します。",
      "↑ 矢印キー: 前の商品の入力欄に戻ります。",
      "入力欄フォーカス時に数値が自動全選択されるため、そのまま新しい数字を打ち込めます。",
    ],
    tips: [
      "入庫画面や実棚数入力画面でも同様のキーボード操作が可能です。",
    ],
    related: ["carryover_overview", "arrivals_input", "closing_physical_count"],
  },

  // === 入庫 ===
  arrivals_overview: {
    title: "入庫の記録（納品数の管理）",
    category: "入庫",
    badge: "🚚 納品",
    summary: "本部や業者からグッズ・ノートが納品された際に、納品日ごとに各商品の入荷個数を記録します。",
    steps: [
      "左側（スマホは上部）のカレンダー/日付一覧から、グッズが届いた「日付」を選択します。",
      "右側の入力カードで、届いた商品の個数を入力します（届いていない商品は0または空欄でOK）。",
      "「○日の入庫を保存」ボタンを押します。",
      "当月グッズの納品が一切なかった場合は、「今月は入庫なし（スキップしてノート購入へ）」を押して完了扱いにできます。",
    ],
    tips: [
      "入庫があった日には、日付ボタンの横に緑のチェック「✓」と合計個数が表示されます。",
      "1ヶ月に複数回納品がある場合でも、日付ごとに正確に管理できます。",
      "スキップ設定後でも、後から個数を入力して保存すれば自動的に入庫登録状態に切り替わります。",
    ],
    related: ["arrivals_calendar_nav", "arrivals_input", "closing_ledger"],
  },

  arrivals_calendar_nav: {
    title: "日付選択と入庫状況の確認",
    category: "入庫",
    badge: "📅 日付管理",
    summary: "当月の日付一覧です。どの日に何個の入庫があったかを俯瞰できます。",
    steps: [
      "日付ボタンをクリックすると、その日の入庫入力フォームに切り替わります。",
      "緑色の枠・バッジが付いている日付は、すでに入庫数が登録されている日です。",
      "右上の「当月の入庫合計」で月全体の入荷総数を確認できます。",
    ],
    tips: [
      "特定の日付の入庫をまるごと取り消したい場合は、その日を選択して「○日の入庫を削除」ボタンを押します。",
    ],
    related: ["arrivals_overview", "arrivals_input"],
  },

  arrivals_input: {
    title: "商品ごとの入庫数入力",
    category: "入庫",
    badge: "📝 入力",
    summary: "選択した日付に納品された商品の個数を商品カードに入力します。",
    steps: [
      "届いた商品の枠に個数を入力します。数字が入るとカードがハイライトされます。",
      "Enterキーで次の商品枠へスムーズにフォーカス移動できます。",
      "入力が終わったら「保存」ボタンを押します。合計が0の場合は自動的に記録がクリアされます。",
    ],
    tips: [
      "ここで入力した入庫数は、月締めの日別台帳およびExcelレポートの「入庫」列に正しく反映されます。",
    ],
    related: ["arrivals_overview", "closing_ledger"],
  },

  // === ノート購入 ===
  specials_overview: {
    title: "ノート購入の記録（現金・振替・ポイント）",
    category: "ノート購入",
    badge: "📓 特殊出庫",
    summary: "交換票（ポイント交換）以外で行われた「ノートの購入（販売）」を記録します。現金販売・口座振替・栄冠ポイントの3種類の決済方法に対応しています。",
    steps: [
      "購入があった「日付」を選択します。",
      "決済種別（現金 / 口座振替 / 栄冠ポイント）を選択します。",
      "購入されたノートの種類と「冊数」を入力します。",
      "「記録を追加」ボタンを押します。下の履歴一覧に明細が追加されます。",
    ],
    tips: [
      "【重要】「現金」で購入されたノートの売上は、自動的に「5. 現金管理」画面の売上金額に加算され、金庫の現金とのつじつまチェックに使用されます。",
      "口座振替や栄冠ポイントでの購入は現金増減には影響せず、在庫の出庫として正しく台帳に計上されます。",
    ],
    related: ["specials_methods", "cash_overview", "closing_ledger"],
  },

  specials_methods: {
    title: "購入種別（現金・口座振替・栄冠ポイント）の違い",
    category: "ノート購入",
    badge: "💳 決済種別",
    summary: "ノート購入における各支払方法の特徴と、在庫・現金への連動関係です。",
    steps: [
      "【現金】: 現金でノートが購入された場合。在庫が減少し、同額の現金売上が「現金管理」に計上されます。",
      "【口座振替】: 会費等と一緒に引き落とされる場合。在庫のみ減少し、金庫の現金には影響しません。",
      "【栄冠ポイント】: 栄冠ポイントで購入された場合。在庫のみ減少し、金庫の現金には影響しません。",
    ],
    tips: [
      "誤って登録した場合は、履歴一覧の右側にある「削除」ボタンでいつでも取り消し・再登録が可能です。",
    ],
    related: ["specials_overview", "cash_reconciliation"],
  },

  // === 現金管理 ===
  cash_overview: {
    title: "現金管理と金庫つじつまチェック",
    category: "現金管理",
    badge: "💴 金銭照合",
    summary: "ノートの現金販売による売上現金と、金庫の実際の現金を照合（つじつまチェック）し、差異がないかを検証する機能です。本部報告用の日別金種表も自動生成できます。",
    steps: [
      "月初と月末に金庫の現金を数え、「月初現金」「月末現金」の金種別枚数を入力します。",
      "月内に売上金を本部へ持参・送金した場合は「売上持ち出し（入金）」を登録します。",
      "「売上とのつじつまチェック」欄で差異が 0円（完全一致 ✓）になっているか確認します。",
      "必要に応じて「本部報告用 日別金種表」を確認・CSVダウンロードします。",
    ],
    tips: [
      "計算式: 【月末現金】 ＝ 【月初現金】 ＋ 【ノート現金売上】 − 【売上持ち出し】",
      "1円でもズレがある場合は赤字で差異警告が表示されるため、数え間違いや未記帳をすぐに発見できます。",
    ],
    related: ["cash_denoms", "cash_reconciliation", "cash_withdrawals", "cash_daily_report", "cash_unit_price"],
  },

  cash_denoms: {
    title: "金種別枚数の入力（月初・月末）",
    category: "現金管理",
    badge: "🔢 金種表",
    summary: "一万円札から一円玉までの金種ごとに、金庫にある硬貨・紙幣の枚数を入力します。",
    steps: [
      "各金種の枚数を半角数字で入力します。合計金額がリアルタイムに自動計算されます。",
      "前月の月末現金データがある場合、「前月の月末現金から自動入力」ボタンで月初の値を一括入力できます。",
      "入力後は「保存」ボタンを押します。",
    ],
    tips: [
      "Enterキーまたは矢印キーで、10,000円から1円まで順番に入力フォーカスが移動します。",
    ],
    related: ["cash_overview", "cash_reconciliation"],
  },

  cash_reconciliation: {
    title: "つじつまチェック（売上と現金の照合）",
    category: "現金管理",
    badge: "⚖ 検算",
    summary: "帳簿上の現金計算と、実際に金庫を数えた月末現金の金額を自動突合します。",
    steps: [
      "【月初現金】: 月初の金庫残高",
      "＋【ノート現金売上】: 「4. ノート購入」で記録した現金販売の合計金額",
      "−【売上持ち出し】: 本部へ入金・持ち出した金額の合計",
      "＝【計算上の月末現金】 と 【実際の月末現金（実査）】を比較します。",
    ],
    tips: [
      "「一致 ✓」になれば現金管理は完璧です。",
      "もし不一致（差異あり）となった場合は、ノート購入の記帳漏れ、金種の数え間違い、持ち出し金額の記録漏れを確認してください。",
    ],
    related: ["cash_overview", "specials_overview", "cash_withdrawals"],
  },

  cash_withdrawals: {
    title: "売上持ち出し（本部入金）の記録",
    category: "現金管理",
    badge: "💼 持ち出し",
    summary: "金庫に溜まったノートの現金売上を、月内に本部へ持参したり口座へ入金したりした記録を管理します。",
    steps: [
      "持ち出した「日付」と「金額（円）」を入力します（メモも任意で記入可能）。",
      "「持ち出しを記録」ボタンを押すとリストに追加され、つじつまチェックの引き算対象として自動計算されます。",
    ],
    tips: [
      "月内に持ち出しを行わなかった月は、何も登録しなくてOKです。",
    ],
    related: ["cash_overview", "cash_reconciliation"],
  },

  cash_daily_report: {
    title: "本部報告用 日別金種表（自動補間ロジック）",
    category: "現金管理",
    badge: "📑 本部報告",
    summary: "ノートの現金売上日および持ち出し日に応じて、日ごとの金種別内訳を自動推計・補間して作成する帳票です。",
    steps: [
      "「日別金種表を表示」ボタンを押すと、1日〜月末までの日別現金残高・金種内訳テーブルが表示されます。",
      "「日別金種表CSV」ボタンでExcel等で開けるCSVファイルを出力できます。",
    ],
    tips: [
      "月初と月末の金種実査データ、および日々の売上・持ち出しデータから整合性の取れた金種推移を自動シミュレーションします。",
    ],
    related: ["cash_overview", "reader_csv_export"],
  },

  cash_unit_price: {
    title: "ノート単価の設定",
    category: "現金管理",
    badge: "⚙ 単価",
    summary: "ノート購入時の1冊あたりの販売価格を設定します。既定値は100円ですが、商品ごとの個別単価も設定可能です。",
    steps: [
      "「単価設定」ボタンを押してポップアップを開きます。",
      "全体の既定単価（標準: 100円）または商品ごとの個別単価を設定して保存します。",
    ],
    tips: [
      "一度設定した単価はブラウザに保存され、翌月以降も自動的に引き継がれます。",
    ],
    related: ["cash_overview", "specials_overview"],
  },

  // === 月締め（棚卸） ===
  closing_overview: {
    title: "月締め・棚卸作業の全体フロー",
    category: "月締め",
    badge: "🏁 月締め",
    summary: "当月の全出納（繰越・交換票読み取り・入庫・ノート購入）を集計した「日別台帳」を確認し、月末の「実棚数」を入力して差異（棚卸差）を確定させる総仕上げ画面です。",
    steps: [
      "1. 日別台帳で、各商品の当月受払（繰越＋入庫−交換出庫−ノート出庫＝月末帳簿残）を確認します。",
      "2. 月末に実際の棚を数え、「実棚数」欄に個数を入力して保存します。",
      "3. 帳簿残と実棚数の差異（過不足）を確認します。",
      "4. 「月締めを確定（ロック）」ボタンを押して、当月のデータを確定・保護します。",
      "5. Excelレポートをダウンロードし、バックアップを保存します。",
    ],
    tips: [
      "月締め確定後は誤操作によるデータ書き換えが防止されます（必要に応じていつでもロック解除可能）。",
    ],
    related: ["closing_ledger", "closing_physical_count", "closing_report", "closing_lock", "closing_reorder"],
  },

  closing_ledger: {
    title: "日別台帳と帳簿残の確認",
    category: "月締め",
    badge: "📖 台帳",
    summary: "1日〜月末までの日々の出納履歴と、計算上の月末在庫数（帳簿残）を商品別に集計した表です。",
    steps: [
      "表の各列: 【繰越】＋【入庫】−【交換（読み取り）】−【ノート購入】＝【月末帳簿残】",
      "商品名をクリックすると、その商品の1日ごとの日別出納内訳ポップアップが開きます。",
    ],
    tips: [
      "交換票の読み取りや入庫の入力を行うと、リアルタイムにこの台帳の数値が再計算されます。",
    ],
    related: ["closing_overview", "closing_physical_count"],
  },

  closing_physical_count: {
    title: "実棚数（実際の棚卸し数）の入力と差異計算",
    category: "月締め",
    badge: "🔍 棚卸",
    summary: "月末に倉庫・棚にある実際の商品数を数えて入力し、帳簿上の在庫数との「差異（棚卸差）」を自動計算します。",
    steps: [
      "「実棚数」列に、実際に数えた個数を半角数字で入力します。",
      "「帳簿残からコピー」ボタンを押すと、計算上の数値を一括コピーして微調整することも可能です。",
      "「実棚数を保存」ボタンを押します。差異（過不足数・差異点数）が自動算出されます。",
    ],
    tips: [
      "差異が0個（緑色）であれば帳簿と実在庫が完全に一致しています。",
      "マイナス（赤字）の場合は実物が帳簿より少ない状態（紛失・交換票未読み取りの可能性）、プラスの場合は実物が多い状態です。",
    ],
    related: ["closing_overview", "closing_lock", "closing_reorder"],
  },

  closing_reorder: {
    title: "発注推奨数（安全在庫計算）",
    category: "月締め",
    badge: "📈 発注支援",
    summary: "過去の平均消費ペースに基づき、次回発注すべき推奨数量を自動提案する機能です。",
    steps: [
      "直近の月間消費データから、翌月以降に必要な推奨在庫数を自動計算して表示します。",
      "在庫切れを起こさないための発注目安としてご活用ください。",
    ],
    tips: [
      "数ヶ月分のデータが蓄積されるほど、より精度の高い発注推奨数が算出されます。",
    ],
    related: ["closing_overview", "closing_physical_count"],
  },

  closing_report: {
    title: "公式Excel月締めレポート（.xlsx）",
    category: "月締め",
    badge: "📊 Excel出力",
    summary: "日別台帳・商品別受払表・棚卸差異表・金種計算表などをすべて網羅した公式Excel月締めレポートを出力します。",
    steps: [
      "「Excelレポート（report_YYYYMM.xlsx）」ボタンをクリックしてダウンロードします。",
      "「レポートをブラウザで見る」ボタンで、ブラウザ上で全シートのプレビューも可能です。",
    ],
    tips: [
      "ダウンロードしたExcelファイルは本部の提出フォーマットに準拠しており、そのままメール添付や印刷・提出が可能です。",
    ],
    related: ["closing_overview", "home_report_preview", "modal_report_preview"],
  },

  closing_lock: {
    title: "月締め確定（ロック）と保護",
    category: "月締め",
    badge: "🔒 保護",
    summary: "月締め作業が完了した月のデータを確定し、以降の誤操作による変更や削除を防止する機能です。",
    steps: [
      "実棚数の保存後、「月締めを確定（ロック）」ボタンを押します。",
      "確定すると画面に「🔒 締め確定済み」バッジがつき、各画面の保存・削除・追加ボタンが無効化されます。",
      "確定直後には最新データのバックアップ（JSON）ダウンロード案内が表示されます。",
    ],
    tips: [
      "万が一修正が必要になった場合は、同じボタン（「月締めロックを解除」）を押すことでいつでも解除して再編集できます。",
    ],
    related: ["closing_overview", "settings_backup"],
  },

  closing_pages_list: {
    title: "保存済み交換票一覧の管理",
    category: "月締め",
    badge: "📋 票管理",
    summary: "当月に確定・保存された交換票（ページ）の一覧です。日付や認識結果を確認したり、個別削除したりできます。",
    steps: [
      "「保存済みページ一覧を表示」をクリックするとアコーディオンが展開します。",
      "各行をクリックすると、読み取り画像と認識結果をポップアップで確認できます。",
      "不要なページがある場合は「削除」ボタンで取り消せます。",
    ],
    tips: [
      "読み取り画面の確定リストと同じデータを共有しています。",
    ],
    related: ["reader_approved", "modal_review"],
  },

  // === 設定画面 ===
  settings_overview: {
    title: "システム設定の概要",
    category: "設定",
    badge: "⚙ 設定",
    summary: "読み取り検算ルール、商品マスタ・交換票テンプレート、および全データのバックアップ・復元を管理する画面です。",
    steps: [
      "上部のサブタブで「読み取り・検算設定」「商品・交換票」「データ管理（バックアップ）」を切り替えます。",
    ],
    tips: [
      "商品のラインナップ変更や価格改定、交換票のレイアウト変更があった際も本画面で柔軟に対応できます。",
    ],
    related: ["settings_reading", "settings_masters", "settings_backup"],
  },

  settings_reading: {
    title: "合計点数の検算判定（チェックデジット）設定",
    category: "設定",
    badge: "🔍 検算基準",
    summary: "交換票を読み取る際、記入された合計枠と計算合計の照合基準を設定します。",
    steps: [
      "【上2桁で照合（一の位を無視・推奨）】: 商品点数が25の倍数の場合、一の位は判定に使わず百・十の位のみで一致を判定します。",
      "【3桁完全一致】: 百・十・一の全3桁が計算値と完全一致しているかを判定します。",
    ],
    tips: [
      "交換票の合計枠の一の位が記入省略されたり掠れたりする場合でも、上2桁照合にしておくことでスムーズに自動認識されます。",
    ],
    related: ["reader_needfix", "reader_overview"],
  },

  settings_masters: {
    title: "商品マスタ・交換票の管理",
    category: "設定",
    badge: "🏷 マスタ",
    summary: "取り扱うグッズ・ノートの商品名・必要点数・商品ID、および交換票（Excelテンプレート/ROI枠）をバージョン管理します。",
    steps: [
      "新しい商品を追加したり点数を変更する場合は「新しいバージョンを作成」を押します。",
      "適用開始年月（例: 2026年09月から適用）を指定できるため、月途中の改定でも過去月のデータに影響を与えません。",
    ],
    tips: [
      "商品ID（英字キー）は過去の繰越在庫の引き継ぎキーとして使われるため、既存商品のID変更はできません。",
    ],
    related: ["settings_master_edit", "settings_xlsx_template", "settings_scan_roi"],
  },

  settings_master_edit: {
    title: "商品の追加・点数変更と適用開始月",
    category: "設定",
    badge: "✏ 編集",
    summary: "商品マスタの新規作成・編集フォームの操作手順です。",
    steps: [
      "「＋ 商品を追加」ボタンで新しい商品行を追加します。",
      "商品ID（半角英数字）、商品名、必要点数を入力します。",
      "「適用開始月」に、このマスタを有効にする年月（例: 202609）を入力します。",
      "交換票のExcelファイルまたはスキャン画像を登録して保存します。",
    ],
    tips: [
      "商品IDの例: `notes_B` (ノートB), `bag` (バッグ), `pen_red` (赤ペン) など。",
    ],
    related: ["settings_masters", "settings_xlsx_template"],
  },

  settings_xlsx_template: {
    title: "Excel交換票テンプレートによる自動ROI割り当て",
    category: "設定",
    badge: "📑 Excel連携",
    summary: "Excel形式の交換用紙（.xlsx）を編集してアップロードするだけで、AI読み取り用の枠座標（ROI）を全自動抽出・割り当てする最新機能です。",
    steps: [
      "「交換用紙テンプレート（.xlsx）をダウンロード」ボタンを押してExcelファイルを保存します。",
      "Excel上で商品名や点数を編集・保存します（四隅の黒四角マーカーと罫線枠はそのまま維持してください）。",
      "「編集したExcelファイルをアップロード」にドロップすると、枠の座標と商品が自動解析されます。",
    ],
    tips: [
      "座標のミリ単位の微調整を手動で行う必要がなく、Excel上で票を作るだけでAI読み取りの準備が完了します。",
    ],
    related: ["settings_masters", "settings_scan_roi"],
  },

  settings_scan_roi: {
    title: "スキャン画像からのROI手動エディタ",
    category: "設定",
    badge: "📐 手動調整",
    summary: "印刷した交換票のスキャン画像をもとに、画面上でドラッグして読み取り枠（日付・個数・合計）を微調整・手動設定する予備機能です。",
    steps: [
      "スキャンした画像をアップロードしてROIエディタを起動します。",
      "四隅マーカーを指定後、日付枠・各商品枠・合計枠をドラッグ＆ドロップで配置・調整します。",
    ],
    tips: [
      "通常はExcelテンプレート自動割り当て機能を使用すれば、この手動調整は不要です。",
    ],
    related: ["settings_xlsx_template", "modal_roi_editor"],
  },

  settings_backup: {
    title: "データ管理とバックアップ（JSON / CSV）",
    category: "設定",
    badge: "💾 バックアップ",
    summary: "ブラウザのIndexedDBに保存されている全データ（全月の月締めデータ・商品マスタ・設定）を一括バックアップ・復元する最重要機能です。",
    steps: [
      "【バックアップ保存】「全データをJSONでバックアップ」ボタンを押すと、全期間のデータが1つのファイルとしてダウンロードされます。",
      "【復元（インポート）】「バックアップファイルを復元」にJSONファイルを投入すると、別PCや新規端末にデータを完全移行できます。",
      "【過去月CSV】過去の各月の行にある「CSV一式」ボタンで、その月の台帳・交換・入庫・ノート・現金のCSVをまとめて保存できます。",
    ],
    tips: [
      "【重要】iPadやブラウザの「履歴・ウェブサイトデータ削除」を行うとブラウザ内データが消去される場合があります。月末締め完了時は必ずバックアップを保存してください。",
    ],
    related: ["backup_export_import", "backup_monthly_csv", "header_overview", "closing_lock"],
  },

  backup_export_import: {
    title: "全データJSONバックアップの保存と復元",
    category: "データ管理",
    badge: "💾 保存・復元",
    summary: "全期間の月締めデータ、過去の交換票、商品マスタ、設定を丸ごと1つのJSONファイルとして保存・復元します。",
    steps: [
      "「バックアップを保存（JSON）」: 最新の全データをJSONファイルとしてダウンロードします。",
      "「バックアップから復元（インポート）」: ダウンロード済みのJSONファイルを選択して読み込むと、現在の端末に過去データを完全に復元・引き継ぎできます。",
    ],
    tips: [
      "PCの買い替え時や担当者の引き継ぎ時にも、このJSONファイルをメール等で渡すだけで移行完了します。",
    ],
    related: ["settings_backup", "backup_monthly_csv"],
  },

  backup_monthly_csv: {
    title: "月ごとのCSV一式ダウンロード",
    category: "データ管理",
    badge: "📑 CSV出力",
    summary: "過去の各月について、台帳・交換票読み取り結果・日別集計・繰越・入庫・ノート購入の全CSVを一括ダウンロードします。",
    steps: [
      "一覧の該当月の行にある「CSV一式」ボタンをクリックします。",
      "月締め台帳や出納明細のCSVがまとめてダウンロードされます。",
    ],
    tips: [
      "Excelや外部システムでの二次加工・長期保存用アーカイブとしてご活用いただけます。",
    ],
    related: ["settings_backup", "reader_csv_export"],
  },

  // === モーダル・エディタ関連 ===
  modal_review: {
    title: "交換票の訂正・手動補正モーダル",
    category: "訂正モーダル",
    badge: "🔧 訂正操作",
    summary: "AIの読み取り結果画像を確認し、誤認識の修正やマーカー検出の補正を行うモーダル画面です。",
    steps: [
      "【マーカー補正】四隅の黒四角が検出できなかった場合、画像上の4つの角を順番にクリックして枠を指定します。",
      "【数値修正】日付や各商品の個数入力欄を修正すると、合計点数の検算がリアルタイムに再計算されます。",
      "【枠ズレ調整】「枠位置の調整」ボタンを押すと、読み取り枠の微細な位置ずれをスライダーで補正できます。",
      "検算が一致したら「保存して確定」ボタンを押します。",
    ],
    tips: [
      "低信頼度の数字（自信がない文字）は黄色、検算不一致は赤色のバッジで強調表示されます。",
      "キーボードの Enter / Tab キーで次の入力枠へサクサク移動できます。",
    ],
    related: ["reader_needfix", "reader_approved"],
  },

  modal_report_preview: {
    title: "月締めレポート ブラウザ内プレビュー",
    category: "プレビュー",
    badge: "👀 閲覧",
    summary: "Excelを開かなくても、ブラウザ上で月締めレポートの全シート（日別台帳・商品別受払・月末棚卸・金種計算など）を忠実にプレビューできるビューアーです。",
    steps: [
      "上部のシート切り替えタブで各帳票を切り替えて閲覧できます。",
      "確認後、右上の「Excelダウンロード」ボタンからそのままファイル保存も可能です。",
    ],
    tips: [
      "印刷前の最終チェックや、タブレットでの閲覧に便利です。",
    ],
    related: ["closing_report", "home_report_preview"],
  },

  modal_roi_editor: {
    title: "ROI（認識枠）エディタの使い方",
    category: "エディタ",
    badge: "📐 枠設定",
    summary: "交換票上の文字認識エリア（ROI）を視覚的に配置・設定するツールです。",
    steps: [
      "画像上の枠をマウスでドラッグして移動、端をドラッグしてサイズ変更します。",
      "各枠に対応する項目（日付・商品名・合計）をプルダウンで割り当てます。",
      "「保存」を押してマスタに反映します。",
    ],
    tips: [
      "Excelテンプレート機能を利用している場合は、自動設定されるため手動操作は不要です。",
    ],
    related: ["settings_scan_roi", "settings_xlsx_template"],
  },
};

// ヘルプモーダルのDOM生成と表示
let currentModalOverlay = null;

export function showHelp(topicKey) {
  const topic = HELP_TOPICS[topicKey];
  if (!topic) {
    console.warn(`Help topic not found: ${topicKey}`);
    return;
  }

  // 既存モーダルがあれば閉じる
  if (currentModalOverlay) {
    currentModalOverlay.remove();
    currentModalOverlay = null;
  }

  const overlay = document.createElement("div");
  overlay.className = "help-modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const stepsHtml = topic.steps && topic.steps.length
    ? `
      <div class="help-section">
        <div class="help-section-title">
          <span class="help-sec-icon">📋</span> 操作手順・使い方
        </div>
        <ol class="help-steps-list">
          ${topic.steps.map((s) => `<li>${s}</li>`).join("")}
        </ol>
      </div>`
    : "";

  const tipsHtml = topic.tips && topic.tips.length
    ? `
      <div class="help-section help-section-tips">
        <div class="help-section-title">
          <span class="help-sec-icon">💡</span> ポイント・業務のヒント
        </div>
        <ul class="help-tips-list">
          ${topic.tips.map((t) => `<li>${t}</li>`).join("")}
        </ul>
      </div>`
    : "";

  const relatedHtml = topic.related && topic.related.length
    ? `
      <div class="help-section help-section-related">
        <div class="help-section-title">
          <span class="help-sec-icon">🔗</span> 関連する機能・取説
        </div>
        <div class="help-related-pills">
          ${topic.related.map((relKey) => {
            const relTopic = HELP_TOPICS[relKey];
            if (!relTopic) return "";
            return `<button type="button" class="help-pill-btn" data-help-jump="${relKey}">${relTopic.title}</button>`;
          }).join("")}
        </div>
      </div>`
    : "";

  overlay.innerHTML = `
    <div class="help-modal">
      <div class="help-modal-header">
        <div class="help-header-main">
          <span class="help-badge">${topic.badge || "💡 取説"}</span>
          <span class="help-category">${topic.category || "ヘルプ"}</span>
        </div>
        <h3 class="help-title">${topic.title}</h3>
        <button type="button" class="help-close-btn" title="閉じる (Esc)" aria-label="閉じる">✕</button>
      </div>
      <div class="help-modal-body">
        <div class="help-summary-box">
          <p class="help-summary-text">${topic.summary}</p>
        </div>
        ${stepsHtml}
        ${tipsHtml}
        ${relatedHtml}
      </div>
      <div class="help-modal-footer">
        <span class="help-footer-tip">⌨ ヒント: キーボードの <b>Esc</b> で閉じられます</span>
        <button type="button" class="btn help-ok-btn">理解した・閉じる</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  currentModalOverlay = overlay;

  const close = () => {
    overlay.classList.add("closing");
    setTimeout(() => {
      overlay.remove();
      if (currentModalOverlay === overlay) currentModalOverlay = null;
    }, 180);
  };

  overlay.querySelector(".help-close-btn").onclick = close;
  overlay.querySelector(".help-ok-btn").onclick = close;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  // 関連トピックのジャンプ
  overlay.querySelectorAll("[data-help-jump]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const nextKey = btn.dataset.helpJump;
      showHelp(nextKey);
    };
  });

  // フォーカスを閉じるボタンへ
  setTimeout(() => {
    const btn = overlay.querySelector(".help-ok-btn");
    if (btn) btn.focus();
  }, 50);
}

// Escキーで閉じる & ?キーで現在画面のヘルプを表示
export function initHelpShortcuts(getActiveViewFn) {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && currentModalOverlay) {
      currentModalOverlay.remove();
      currentModalOverlay = null;
      e.preventDefault();
      return;
    }

    // 入力欄にフォーカスしていない時に '?' (Shift + /) を押したら現在画面のヘルプを開く
    if (
      (e.key === "?" || (e.key === "/" && e.shiftKey)) &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) &&
      !currentModalOverlay
    ) {
      const view = getActiveViewFn ? getActiveViewFn() : "home";
      const map = {
        home: "home_overview",
        reader: "reader_overview",
        carryover: "carryover_overview",
        arrivals: "arrivals_overview",
        specials: "specials_overview",
        cash: "cash_overview",
        closing: "closing_overview",
        settings: "settings_overview",
        masters: "settings_masters",
        backup: "settings_backup",
      };
      const key = map[view] || "header_overview";
      showHelp(key);
      e.preventDefault();
    }
  });
}

// 丸型「?」ボタンのHTML生成ユーティリティ
// options: { size: 'sm'|'md'|'lg', title: string, className: string, label: string }
export function helpBtn(topicKey, options = {}) {
  const sizeCls = options.size ? `help-btn-${options.size}` : "";
  const extraCls = options.className || "";
  const title = options.title || "使い方・ヒントを見る";
  const label = options.label ? `<span class="help-btn-label">${options.label}</span>` : "";

  return `<button type="button" class="help-btn ${sizeCls} ${extraCls}" data-help="${topicKey}" title="${title}" aria-label="${title}"><span class="help-btn-icon">?</span>${label}</button>`;
}

// グローバルイベント委譲: document内の [data-help] ボタンのクリックを自動処理
export function initGlobalHelpListener() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-help]");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.getAttribute("data-help");
      if (key) showHelp(key);
    }
  });
}
