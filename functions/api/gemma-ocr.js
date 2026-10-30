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
  const instruction = mode === 'receipt'
    ? [
      '日本語レシートから購入取引を1件だけ、印字された内容に従って正確に読み取ってください。',
      '最初の5行を必ずこの順番で書いてください（各行1項目、説明不要）：',
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
    ].join('\\n')
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
