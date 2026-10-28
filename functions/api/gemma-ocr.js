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
    ? '日本語レシートの印字内容を、元の順序で正確に文字起こししてください。店名、購入日、合計金額、支払方法を優先してください。各項目は「店名:」「日付:」「合計:」「支払方法:」で1行ずつ書き、判読できない項目は「不明」としてください。商品明細はその後に書いてください。商品金額、税額、釣銭、決済端末の控えにある金額とレシートの合計を混同しないでください。'
    : '日本語のカード・決済明細画像を文字起こししてください。複数取引は各行を分け、各取引の日付、店舗名、金額、支払方法を対応させてください。'
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
