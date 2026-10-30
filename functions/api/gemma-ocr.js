// No receipt images or extracted payment data are persisted on the server.
export const GEMMA_MODEL = '@cf/google/gemma-4-26b-a4b-it'
export function normalizeGemmaText(result) {
  const raw = typeof result === 'string' ? result : (result?.response || result?.description || result?.output_text || result?.choices?.[0]?.message?.content || '')
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('画像から文字を読み取れませんでした')
  // Preserve lines so the existing Japanese receipt/statement parser can handle them.
  return raw.trim().slice(0, 16000)
}
export async function recognizeWithGemma(ai, bytes, mime, mode) {
  if (!ai?.run) throw new Error('AIの接続が設定されていません')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('対応していない画像形式です')
  if (bytes.byteLength > 4 * 1024 * 1024) throw new Error('画像は4MB以下にしてください')
  const base64 = Array.from(new Uint8Array(bytes), b => String.fromCharCode(b)).join('')
  const imageUrl = 'data:' + mime + ';base64,' + btoa(base64)
  const instruction = mode === 'portfolio-detail'
    ? [
      'これはSBI証券の投資信託「銘柄詳細」画面です。1銘柄の下にNISA（成長）とNISA（つみたて）が別々のカードで表示される場合があります。',
      '画面上の8桁の銘柄コードを読み、口座カードごとに保有数量と取得金額だけを読み取ってください。',
      '各口座につき1行を「銘柄コード|口座区分|保有口数|取得金額」の順番で出力してください。',
      '口座区分は成長投資枠ならgrowth、つみたて投資枠ならtsumitate。成長とつみたての両方があれば必ず2行を出してください。',
      '画面上の共通見出しに両口座名が並んでいても、それだけでは口座区分を判定せず、各カード左上のNISAラベルを使用してください。',
      '保有数量は口数、取得金額は円の整数です。4桁以上の数値に付くカンマを除いてください。',
      '評価額、基準価額、取得単価、前日比、売却注文中、評価損益は絶対に取得金額や口数として使用しないでください。',
      '保有数量・取得金額・口座区分のいずれかが読めないカードは行を補完せず、推測は禁止です。',
      '各カードを画像上から正確に転記してください。説明、見出し、コードフェンス、Markdownなどは一切不要です。'
    ].join('\n')
    : mode === 'portfolio-profit'
    ? [
      'これはSBI証券の投資信託一覧で、各銘柄の「基準価額 / 取得単価 / 評価損益(%)」を表示した画面です。',
      '画面の「更新日時」「評価額 合計」「評価損益(%)の合計」を必ず読んでください。',
      '最初の行は「META|YYYY-MM-DD HH:mm|評価額合計(円)|評価損益合計(円)」のみ。例：META|2026-10-30 17:48|71560|121。',
      '銘柄ごとに「8桁の銘柄コード|口座区分|評価損益の円金額(符号付き)|取得単価(1万口当たり円)」を1行。',
      '口座区分はNISA成長とNISAつみたて両方の表示ならcombined、成長だけならgrowth、つみたてだけならtsumitateです。',
      '必ず「評価損益」の円金額を読み、「前日比」「基準価額」と取り違えないでください。',
      '取得単価は基準価額と異なる数字です。元画像にない価格や口数は推測しないでください。',
      '全銘柄のコードと円金額を、表示順通り正確に転記してください。',
      '不明なら不明と書き、数値を補わないでください。Markdown・見出し・説明は不要です。'
    ].join('\n')
    : mode === 'portfolio-positions'
    ? [
      'これはSBI証券の投資信託一覧で、各銘柄の「保有数量 / 売却注文中 / 評価額 / 評価額前日比」を表示した画面です。',
      '画面の「更新日時」と「評価額 合計」を読み、最初の行を「META|YYYY-MM-DD HH:mm|評価額合計(円)」にしてください。',
      '銘柄ごとに「8桁の銘柄コード|口座区分|保有数量(口)|評価額(円)」を1行にしてください。',
      '口座区分はNISA成長とNISAつみたて両方の表示ならcombined、成長だけならgrowth、つみたてだけならtsumitateです。',
      '売却注文中の0を保有口数として使わないでください。評価額前日比も評価額と混同しないでください。',
      '読めない項目は不明とし、推定・計算・補完せず、実際に印字された値だけを転記してください。',
      '全銘柄のコードと口数と評価額を表示順に、Markdown・見出しなしで転記してください。'
    ].join('\n')
    : mode === 'portfolio'
    ? [
      'SBI証券の投資信託保有一覧の画像から、各銘柄の「現在の保有口数」と「累計取得金額」を正確に文字起こししてください。',
      '読める銘柄ごとに1行、形式は「銘柄名または8桁の銘柄コード|口座区分|保有口数|取得金額」としてください。',
      '口座区分は画像に明記されている場合のみ「成長」「つみたて」「合算」のいずれかを使い、それ以外は「不明」。',
      '保有口数は「口」単位の整数、取得金額は円単位の整数です。数字の桁区切りカンマは省略してください。',
      '評価額、評価損益、平均取得単価、基準価額、月額積立予定額を取得金額と混同しないでください。',
      '口数または取得金額が欠ける銘柄は出力しないでください。推定・計算・補完は禁止です。',
      '説明、ヘッダー、Markdown、余分な行は書かないでください。'
    ].join('\n')
    : mode === 'receipt'
    ? [
      '日本語レシートから購入取引を1件だけ、印字された内容に従って正確に読み取ってください。',
      '次の5項目を必ずこの順番で書いてください（各行1項目、説明不要）：',
      '店名: <正式な店名と支店名、読めなければ不明>',
      '日付: <購入日 YYYY-MM-DD、読めなければ不明>',
      '時刻: <購入時刻 HH:mm、印字がない・読めなければ不明>',
      '合計: <税込み購入合計額、読めなければ不明>',
      '支払方法: <印字された支払方法名、読めなければ不明>',
      '時刻はレジ付近の購入日時（例：レジ番号 2026/10/30(金) 12:36）から読み取ってください。',
      'スキャン時刻や現在時刻を補わず、営業時間・レジ番号・カード番号を取引時刻にしないでください。',
      'クーポン開始日・有効期限・引換期間・カード処理控えの日付は購入日として使わないでください。',
      '小計、税額、個別商品の金額、残高、釣銭、重複印字された決済金額は税込みの購入合計と混同しないでください。',
      '商品明細は上記5項目の後に改行で列挙してください。画像内の別の決済控えは新しい支出として扱わないでください。'
    ].join('\n')
    : '日本語のカード・決済明細画像を文字起こししてください。複数取引は各行を分け、各取引の日付、印字がある場合は時刻(HH:mm)、店舗名、税込金額、支払方法を対応させてください。時刻がない場合は推測せず空欄とし、クーポンの日付は取引日として扱わないでください。'
  const result = await ai.run(GEMMA_MODEL, {
    messages: [{ role: 'user', content: [
      { type: 'text', text: instruction + ' 読めない箇所は推測せず「不明」と書いてください。説明やMarkdownを追加しないでください。' },
      { type: 'image_url', image_url: { url: imageUrl } }
    ] }],
    max_completion_tokens: 2048,
    chat_template_kwargs: { enable_thinking: false },
    temperature: 0
  })
  return normalizeGemmaText(result)
}
