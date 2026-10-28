// テキスト・OCR解析：日付、時刻、金額、店舗、カテゴリー（ブラウザ内で処理）
export const CATEGORIES = ['餐饮', '饮食料品', '日用品', '交通', '购物', '居住', '医疗', '娱乐', '宠物', '其他']

const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function normalize(text) {
  return text
    .normalize('NFKC')
    .replace(/(?<=[\u3040-\u30ff\u4e00-\u9fff])[ \t]+(?=[\u3040-\u30ff\u4e00-\u9fff])/g, '')
    .trim()
}

function findDate(t, today = new Date()) {
  let m
  // In card statements, OCR sometimes splits the day "11" as "1 1" just before "回払い".
  if ((m = t.match(/(20\d{2})\s*\/\s*(\d{1,2})\s*\/\s*1\s+1\s*(?=回\s*払)/))) return m[1] + '-' + pad(m[2]) + '-11'
  if ((m = t.match(/(20\d{2})\s*[年\/.\-]\s*(\d{1,2})\s*[月\/.\-]\s*(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  // Japanese card apps often abbreviate the year: 26.10.18 means 2026-10-18.
  if ((m = t.match(/(?<!\d)(\d{2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?!\d)/))) return `20${m[1]}-${pad(m[2])}-${pad(m[3])}`
  if ((m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/))) return `${today.getFullYear()}-${pad(m[1])}-${pad(m[2])}`
  if ((m = t.match(/(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/))) return `${today.getFullYear()}-${pad(m[1])}-${pad(m[2])}`
  const off = /前天|一昨日/.test(t) ? 2 : /昨天|昨日/.test(t) ? 1 : 0
  const d = new Date(today); d.setDate(d.getDate() - off)
  return ymd(d)
}

function findTime(t) {
  const m = t.match(/(?<!\d)([01]?\d|2[0-3])[:：时時]([0-5]\d)(?!\d)/)
  return m ? `${pad(m[1])}:${pad(m[2])}` : ''
}

function findAmount(t) {
  const num = s => Number(s.replace(/[,，\s]/g, ''))
  let m
  if ((m = t.match(/(?:合\s*計|合计|お?買上(?:げ)?(?:金額)?|総\s*額|total|請求額)[^\d¥]{0,8}¥?\s*([\d,]{2,9})/i))) return num(m[1])
  const yen = [...t.matchAll(/[¥￥]\s*([\d,]{1,9})/g)].map(x => num(x[1]))
  if (yen.length) return Math.max(...yen)
  const unit = [...t.matchAll(/([\d,]{1,9})\s*(?:円|日元|元|块|塊)/g)].map(x => num(x[1]))
  if (unit.length) return Math.max(...unit)
  const cleaned = t.replace(/\d{4}[年\/.\-]\d{1,2}[月\/.\-]\d{1,2}日?/g, '').replace(/\d{1,2}[:：]\d{2}/g, '')
  const all = [...cleaned.matchAll(/(?<![\d.])(\d{2,7})(?![\d.])/g)].map(x => Number(x[1]))
  return all.length ? Math.max(...all) : 0
}

// Supermarket names must be checked before generic keywords such as 「バス」.
// 「まいばすけっと」 contains the characters 「バス」, but is a supermarket, not transport.
const SUPERMARKET_KEYWORDS = [
  'まいばすけっと', 'まいばす', 'マイバスケット', 'マイバスケツト', 'マイバス', 'イオン', 'AEON', 'マックスバリュ', 'ダイエー',
  'ライフ', 'LIFE', 'サミットストア', 'サミット', 'マルエツ', '西友', 'SEIYU',
  'オーケーストア', 'オーケー', 'OKストア', 'ベルク', 'ヤオコー', 'オオゼキ',
  'いなげや', 'コモディイイダ', 'アコレ', 'ビッグ・エー', 'ビッグエー', 'ロピア',
  '業務スーパー', '業務スーパ', 'イトーヨーカドー', 'イトーヨーカ堂', 'ヨークフーズ',
  'ヨークマート', 'ヨークプライス', 'マルエツプチ', 'ミニピアゴ', '肉のハナマサ',
  'ハナマサ', '食品館あおば', 'アタック', '全日食チェーン', 'トライアル',
  'スーパーセンタートライアル', '成城石井', '紀ノ国屋', 'KINOKUNIYA',
  'クイーンズ伊勢丹', '北野エース', '東急ストア', '京王ストア', '京急ストア',
  '小田急OX', '文化堂', 'スーパーバリュー', 'ベルクス', 'コープ', '生協',
  'コンビニ', 'セブン-イレブン', 'セブンイレブン', 'セブンーイレブン', 'セブンｰイレブン',
  'セブン‐イレブン', 'セブン−イレブン', 'セブン－イレブン', '7-Eleven', '7-ELEVEN', '7-11',
  'ローソン', 'ファミリーマート', 'ファミマ', 'ミニストップ', 'NewDays', 'ニューデイズ', 'デイリーヤマザキ', 'ポプラ'
]

// Merchant defaults by category. Keep these conservative: ambiguous merchants fall through to user rules/default.
const MERCHANT_CATEGORY_KEYWORDS = [
  { category: '餐饮', keywords: [
    'マクドナルド', 'マック', 'モスバーガー', 'ケンタッキー', 'KFC', 'ミスタードーナツ', 'ミスド',
    'スターバックス', 'スタバ', 'ドトール', 'タリーズ', 'コメダ珈琲', 'サイゼリヤ', 'ガスト',
    'バーミヤン', 'ジョナサン', 'デニーズ', 'すかいらーく', '吉野家', 'すき家', '松屋',
    'なか卯', '丸亀製麺', 'はなまるうどん', '日高屋', '餃子の王将', '大阪王将',
    'くら寿司', 'スシロー', 'はま寿司', 'かっぱ寿司', '焼肉きんぐ', '牛角', '鳥貴族',
    'Uber Eats', 'ウーバーイーツ', '出前館', 'menu', 'ピザハット', 'ドミノ・ピザ', 'ほっともっと',
    'オリジン弁当', 'ほっかほっか亭', '食べログ'
  ] },
  { category: '日用品', keywords: [
    'マツモトキヨシ', 'マツキヨ', 'ウエルシア', 'ウェルシア', 'ツルハドラッグ', 'スギ薬局',
    'ココカラファイン', 'サンドラッグ', 'クリエイトSD', 'クスリのアオキ', 'コスモス薬品',
    'ダイソー', 'DAISO', 'セリア', 'Seria', 'キャンドゥ', 'Can★Do', 'ワッツ',
    'ニトリ', '無印良品', 'MUJI', 'カインズ', 'コーナン', 'DCM', 'ビバホーム',
    'ドン・キホーテ', 'ドンキ', 'ロフト', 'LOFT', 'ハンズ', '東急ハンズ', 'ユニクロ', 'UNIQLO',
    'GU', 'しまむら', '西松屋', 'アカチャンホンポ', '赤ちゃん本舗'
  ] },
  { category: '交通', keywords: [
    'Suica', 'PASMO', 'ICOCA', 'モバイルSuica', 'モバイルPASMO', 'JR東日本', 'JR東海',
    'JR西日本', '東京メトロ', '都営地下鉄', '京成電鉄', '京急', '東急電鉄', '小田急電鉄',
    '京王電鉄', '東武鉄道', '西武鉄道', 'タクシー', 'GOタクシー', 'DiDi', '日本交通',
    'Times駐車場', 'タイムズ', '三井のリパーク', 'ENEOS', '出光', 'apollostation', 'コスモ石油'
  ] },
  { category: '居住', keywords: [
    '東京電力', 'TEPCO', '東京ガス', '大阪ガス', '東邦ガス', 'ENEOSでんき', 'オクトパスエナジー',
    'Octopus Energy', 'SoftBank 光', 'ソフトバンク光', 'ソフトバンク', 'NTTファイナンス', '水道料金',
    '家賃', '管理費', '住宅ローン'
  ] },
  { category: '医疗', keywords: [
    '病院', 'クリニック', '診療所', '歯科', '歯医者', '調剤薬局', '薬局', '処方箋',
    '日本調剤', 'クオール薬局', 'アイン薬局', 'スギ薬局調剤', '眼科', '整形外科', '皮膚科'
  ] },
  { category: '娱乐', keywords: [
    'Netflix', 'ネットフリックス', 'Amazon Prime', 'Prime Video', 'Disney+', 'ディズニープラス',
    'YouTube Premium', 'Spotify', 'Apple Music', 'Nintendo', 'PlayStation', 'Steam',
    'カラオケ', 'ビッグエコー', 'まねきねこ', 'ラウンドワン', '映画館', 'TOHOシネマズ',
    'ユナイテッド・シネマ', 'チケットぴあ', 'イープラス'
  ] },
  { category: '宠物', keywords: [
    'ペットショップ', 'ペットのコジマ', 'コジマ', 'イオンペット', 'PETEMO', 'ペテモ',
    '動物病院', '獣医', 'ペットホテル', 'トリミング', 'チャーム', 'charm'
  ] },
  { category: '购物', keywords: [
    'Amazon.co.jp', '楽天市場', 'Yahoo!ショッピング', 'ヨドバシカメラ', 'ビックカメラ',
    'ヤマダデンキ', 'エディオン', 'ケーズデンキ', 'Apple Store', 'ZARA', 'H&M',
    'ABC-MART', 'アディダス', 'adidas', 'ナイキ', 'NIKE', '高島屋', '伊勢丹', '三越',
    '大丸', '松坂屋', 'ルミネ', 'パルコ', 'PARCO', 'ららぽーと'
  ] }
]

export function classify(text, rules = []) {
  const normalizedText = normalize(text).toLowerCase()

  // User-created rules take precedence over built-in defaults.
  // Matching is fuzzy substring matching; if several rules match, use the most specific (longest) keyword.
  const merchantAliases = { 'スタバ': 'スターバックス' }
  const userRule = [...rules]
    .filter(r => r?.keyword && r?.category)
    .sort((a, b) => normalize(b.keyword).length - normalize(a.keyword).length)
    .find(r => {
      const keyword = normalize(r.keyword).toLowerCase()
      return normalizedText.includes(keyword) ||
        (merchantAliases[keyword] && normalizedText.includes(merchantAliases[keyword].toLowerCase()))
    })
  if (userRule) return { category: userRule.category, keyword: userRule.keyword }

  const supermarket = [...SUPERMARKET_KEYWORDS]
    .sort((a, b) => b.length - a.length)
    .find(keyword => normalizedText.includes(normalize(keyword).toLowerCase()))
  if (supermarket) return { category: '饮食料品', keyword: supermarket }

  const merchantRule = MERCHANT_CATEGORY_KEYWORDS
    .flatMap(group => group.keywords.map(keyword => ({ category: group.category, keyword })))
    .sort((a, b) => b.keyword.length - a.keyword.length)
    .find(rule => normalizedText.includes(normalize(rule.keyword).toLowerCase()))
  if (merchantRule) return merchantRule

  return { category: '日用品', keyword: '' }
}

export function parseEntry(raw, rules) {
  const text = normalize(raw)
  const { category, keyword } = classify(text, rules)
  const firstLine = text.split('\n').map(s => s.trim()).find(s => s.length >= 2 && !/^[\d¥\s:\/.\-]+$/.test(s)) || ''
  const merchant = firstLine.slice(0, 40) || keyword
  return {
    date: findDate(text), time: findTime(text), amount: findAmount(text),
    category, merchant, note: text.length <= 40 ? text.replace(/\s+/g, ' ') : '',
    raw: text, suggested: category, keyword
  }
}

// Receipts are single purchases: never use the largest yen value (often a balance).
export function parseReceipt(raw, rules = []) {
  const text = normalize(raw)
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const money = value => Number(value.replace(/[,，\s]/g, ''))
  const amountIn = line => {
    const s = line.replace(/[OoＯｏ](?=\d)/g, '0')
    const m = s.match(/[¥￥]\s*([\d,，]+)|([\d,，]+)\s*円|(?:^|\s)(\d{1,3}(?:[,，]\d{3})*|\d{1,6})(?=\s*(?:$|[税込]))/)
    const amount = m ? money(m[1] || m[2] || m[3]) : 0
    return Number.isSafeInteger(amount) && amount > 0 && amount <= 9999999 ? amount : 0
  }
  const totalLabel = /(?:合\s*計|お\s*買\s*上(?:げ)?(?:金額)?|お\s*支\s*払(?:い)?(?:金額)?|ご\s*請\s*求\s*額|総\s*合\s*計|TOTAL)/i
  const excluded = /(?:税率|対象|内消費税|税込対象|小計|お預り|お釣り|釣銭|残高|クーポン|値引|割引|ポイント)/
  const candidates = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!totalLabel.test(line) || excluded.test(line)) continue
    const score = /(?:総\s*合\s*計|お\s*支\s*払(?:い)?(?:金額)?|ご\s*請\s*求\s*額)/i.test(line) ? 3 : /合\s*計|TOTAL/i.test(line) ? 2 : 1
    // Read the value after the label; never accidentally read a date or register number before it.
    const suffix = line.slice(line.search(totalLabel)).replace(totalLabel, '').replace(/^[\s:：=\-]+/, '')
    let amount = amountIn(suffix)
    if (!amount && i + 1 < lines.length && !/[一-龯ぁ-んァ-ヶ]/.test(lines[i + 1].replace(/円/g, ''))) amount = amountIn(lines[i + 1])
    if (amount) candidates.push({ amount, score, index: i })
  }
  // OCR may turn 合計 into punctuation (e.g. '= =t ¥239').
  // Only trust a malformed total when the same amount is independently present
  // in a tax-inclusive line, and the candidate is adjacent to the tax breakdown.
  if (!candidates.length) {
    const inclusive = new Set(lines.filter(line => /(?:税率|対象)/.test(line) && !/内消費税|消費税等/.test(line))
      .map(line => [...line.matchAll(/[¥￥\\]\s*([\d,，]+)(?!\d)/g)].map(m => money(m[1]))).flat())
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!/^[\s=＝・\-tT]+[¥￥\\]\s*[\d,，]+\s*$/.test(line)) continue
      const m = line.match(/[¥￥\\]\s*([\d,，]+)/)
      const value = m ? money(m[1]) : 0
      const preceding = lines.slice(Math.max(0, i - 4), i).join(' ')
      if (value > 0 && inclusive.has(value) && /小計|消費税|税抜/.test(preceding)) {
        candidates.push({ amount: value, score: 2, index: i })
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.index - b.index)
  const amount = candidates[0]?.amount || 0
  // Normalize spaced and common OCR-misread convenience-store names without
  // altering the statement parser. Prefer the branch printed near the header.
  const compact = line => line.replace(/[\s　・]/g, '')
  const isSeven = line => /セ[ブフ][ン]?[-ー－‐−]?イ[レル]?ブ[ン]?|セブン[-ー－‐−]?イレブン/.test(compact(line))
  const sevenFound = lines.some(isSeven)
  const branch = lines.slice(0, Math.min(lines.length, 12))
    .find(line => /店\s*$/.test(line) && !/電話|番号|登録/.test(line))
  const brand = sevenFound ? 'セブン-イレブン' : ''
  const merchant = brand ? [brand, branch && compact(branch)].filter(Boolean).join(' ')
    : (lines.find(line => /ローソン|ファミリーマート|まいばすけっと|イオン|スーパー|マルエツ|ライフ/.test(compact(line)))
      || lines.find(line => /(?:店|ストア|マーケット)$/.test(compact(line)) && !/電話|番号/.test(line))
      || '')
  const categorySource = merchant || text.slice(0, 120)
  const { category, keyword } = classify(categorySource, rules)
  const dateLine = lines.find(line => /20\d{2}\s*[年\/.\-]\s*\d{1,2}\s*[月\/.\-]\s*\d{1,2}/.test(line)) || ''
  return {
    date: dateLine ? findDate(dateLine) : '',
    time: dateLine ? findTime(dateLine) : '',
    amount,
    category,
    merchant: merchant.slice(0, 60),
    note: amount ? '' : '要確認：合計金額を読み取れませんでした',
    raw: text, suggested: category, keyword
  }
}

// 貼り付けテキストまたはOCR画像から複数の明細を抽出する。
export function parseEntries(raw, rules) {
  const marker = '\n__QP_AMOUNT_COLUMN__\n'
  let qpColumnAmounts = []
  if (typeof raw === 'string' && raw.includes(marker)) {
    const parts = raw.split(marker)
    raw = parts[0]
    qpColumnAmounts = (parts[1] || '').split(/\r?\n/).map(line => line.trim())
      .map(line => line.match(/^(?:[¥￥]\s*)?(\d{1,3}(?:[,，.]\d{3})+|\d{2,6})(?:\s*円)?$/)?.[1])
      .filter(Boolean)
      .map(value => Number(value.replace(/[,，.]/g, '')))
      .filter(value => Number.isInteger(value) && value > 0 && value <= 999999)
  }
  const text = normalize(raw)
  if (!text) return []

  // Normalize card-statement rows such as "QUICPay 利用 (QP/ マイバスケット ) 628gm"
  // into the existing QP-row format before parsing each transaction independently.
  const lines = text.split(/\r?\n/).map(s => s.trim())
    .filter(Boolean)
    .map(line => line.replace(/^.*?\(\s*Q?O?P\s*\//i, 'QP / '))

  const dateLine = line => /20\d{2}\s*[年/. -]\s*\d{1,2}\s*[月/. -]\s*\d{1,2}/.test(line)
    || /(?<!\d)\d{2}\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*\d{1,2}(?!\d)/.test(line)
    || /\d{1,2}\s*月\s*\d{1,2}/.test(line)
    || /\d{1,2}\s*\/\s*\d{1,2}/.test(line)
  const paymentLine = line => /^(?:1回払い|一回払い|分割払い|リボ払い|ボーナス払い|支払回数|クレジット|カード利用|ご利用日|利用日|利用金額|お支払方法|お支払い方法)$/i.test(line.replace(/[\s＞>]/g, ''))
  const amountLine = line => {
    const s = line.replace(/[＞>」】]/g, '').trim()
    if (!/^(?:[¥￥]\s*)?\d[\d,]*(?:\s*円)?$/.test(s)) return false
    const digits = s.replace(/[^\d]/g, '')
    const hasCurrency = /[¥￥円]/.test(s)
    const hasThousandsSeparator = /^\s*(?:[¥￥]\s*)?\d{1,3}(?:,\d{3})+(?:\s*円)?\s*$/.test(s)
    // Long unformatted numbers in card statements are ambiguous and often reference IDs.
    // Accept long amounts only when currency or thousands separators make them explicit.
    if (!hasCurrency && !hasThousandsSeparator && digits.length >= 6) return false
    const amount = Number(digits)
    return amount > 0 && amount <= 9999999
  }
  const cleanAmountLine = line => {
    const s = line.replace(/[＞>」】]/g, '').trim()
    const m = s.match(/(?:[¥￥]\s*)?([\d,]+)(?:\s*円)?/)
    return m ? Number(m[1].replace(/,/g, '')) : 0
  }
  const extractTrailingAmount = line => {
    // Japanese card-statement OCR often misreads 円 as m/g/gm and thousand separators as periods.
    // Only accept a number at the very end with a currency-like marker, to avoid treating address digits as amounts.
    const m = line.match(/(?:[¥￥]\s*)?(\d[\d,，.]{1,7})\s*(円|m{1,2}|g(?:m)?|mm|H)?\s*(?:[Nn＞>2ンてvく～〜]+)?\s*[、,，。．.）)」】]*\s*$/i)
    if (!m) return null
    const rawNumber = m[1]
    // Amounts in these Japanese statements are whole yen; OCR may render 5,931 as 5.931.
    const amount = Number(rawNumber.replace(/[,，.]/g, ''))
    if (!Number.isFinite(amount) || amount < 1 || amount > 999999) return null
    const marker = m[2] || ''
    const hasCurrency = /円|[¥￥]|m|g|H/i.test(marker) || /[Nn＞>2ンてvく～〜]\s*$/.test(line)
    if (!hasCurrency) return null
    return { amount, raw: m[0], index: m.index }
  }
  const cleanMerchant = value => {
    const cleaned = value
    // Card statements may append a reference number to every merchant row, not only Suica.
    // Strip visible numeric references and OCR-truncated forms such as "7...".
    .replace(/\s+\d{6,}\s*$/g, '')
    .replace(/\s+\d{1,3}\s*[.…・]{2,}\s*$/g, '')
    .replace(/[＞>」】]+\s*$/g, '')
    .replace(/[Nn]\s*$/g, '')
    .replace(/[\s,，、。．.]+$/g, '')
    .trim()
    .replace(/マイバスケツト/g, 'マイバスケット')
    .replace(/\(([^()]*)\)/g, '（$1）')
    // Keep balanced closing parentheses, drop only stray OCR punctuation.
    return cleaned.includes('（') ? cleaned : cleaned.replace(/\)\s*$/, '').trim()
  }

  // Card statement blocks sometimes separate merchant, amount and date into
  // separate lines (e.g. 2,992円～). Recover each independently instead of
  // falling back to a single giant draft containing all the transactions.
  const standaloneAmount = line => {
    const match = line.match(/^(?:[¥￥]\s*)?(\d{1,3}(?:[,，.]\d{3})+|\d{1,6})\s*円\s*[~～〜く>＞Nn]*$/)
    if (!match) return null
    const value = Number(match[1].replace(/[,，.]/g, ''))
    return value > 0 && value <= 9999999 ? value : null
  }
  const cardBlocks = []
  let blockStart = 0
  for (let i = 0; i < lines.length; i++) {
    if (!dateLine(lines[i]) || !/^\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}$/.test(lines[i])) continue
    const block = lines.slice(blockStart, i).filter(line => !/^(?:ご本人|本人|家族|家族会員|1回払い|一回払い|分割払い|リボ払い)$/.test(line))
    const amountIndex = block.findIndex(line => standaloneAmount(line) !== null)
    if (amountIndex >= 1) {
      const amount = standaloneAmount(block[amountIndex])
      const merchantText = [...block.slice(0, amountIndex), ...block.slice(amountIndex + 1)].join('')
      const merchant = cleanMerchant(merchantText)
      if (merchant && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(merchant)) {
        const { category, keyword } = classify(merchant, rules)
        cardBlocks.push({ date: findDate(lines[i]), time: '', amount, category,
          merchant: merchant.slice(0, 60), note: '', raw: block.join('\n') + '\n' + lines[i], suggested: category, keyword })
      }
    }
    blockStart = i + 1
  }
  if (cardBlocks.length >= 2 && cardBlocks.length === lines.filter(dateLine).length) return cardBlocks

  // QP statements: each transaction is a QP-prefixed merchant/amount line,
  // followed by a date and payment-method line. Parse the final numeric token explicitly.
  const qpRows = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/^QP\s*\//i.test(line)) continue
    const body = line.replace(/^QP\s*\/\s*/i, '').trim()
    // Capture the final amount token, not the merchant/reference text.
    // The OCR engine may remove the space before the amount entirely (e.g. "ダイソー880m").
    // Anchor the amount to the line ending marker instead of requiring a separator from the merchant.
    const m = body.match(/^(.*?)([0-9０-９oOｏＯ][0-9０-９oOｏＯ\]\[\s,，.]{0,8})\s*(?:円|m{1,2}|g(?:m)?|ロ|口)?\s*[、,，。．.'’vV|]+\s*$/i)
      || body.match(/^(.*?)([0-9０-９oOｏＯ][0-9０-９oOｏＯ\]\[\s,，.]{0,8})\s*(?:円|m{1,2}|g(?:m)?|ロ|口)\s*$/i)
    if (!m || !m[1].trim()) continue
    // Ambiguous OCR glyphs (O/o) must not be guessed as the digit 6.
    // Keep the row for manual review rather than silently recording a wrong charge.
    const ambiguousAmount = /[oOｏＯ]/.test(m[2])
    const token = m[2].replace(/[\]\[]/g, '').replace(/[\s,，.]/g, '')
    const amount = ambiguousAmount ? 0 : Number(token)
    if (!Number.isFinite(amount) || amount < 0 || amount > 999999) continue
    let nextDate = null
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      if (/^QP\s*\//i.test(lines[j])) break
      if (dateLine(lines[j])) { nextDate = lines[j]; break }
    }
    if (!nextDate) continue
    const merchant = cleanMerchant(m[1])
    if (!merchant || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(merchant)) continue
    const { category, keyword } = classify(merchant, rules)
    qpRows.push({
      date: findDate(nextDate), time: '', amount, category,
      merchant: merchant.slice(0, 60), note: amount ? '' : '要確認：金額の数字が不明瞭です',
      raw: merchant + '\n' + nextDate + '\n' + m[2],
      suggested: category, keyword
    })
  }
  // Prefer the established parser when it recovered every row; use block recovery only for missing rows.
  if (qpRows.length >= lines.filter(line => /^(?:QUICPay\s*利用\s*)?QP\s*\//i.test(line)).length && qpRows.length >= 2) return qpRows
  // Robust transaction-block fallback for QUICPay OCR. Keep every detected transaction,
  // even if OCR misses its amount; zero-amount drafts remain editable instead of being dropped.
  const qpStart = line => /^(?:QUICPay\s*利用\s*)?QP\s*\//i.test(line)
  const qpStarts = lines.map((line, index) => qpStart(line) ? index : -1).filter(index => index >= 0)
  if (qpStarts.length >= 2) {
    const recovered = []
    for (let n = 0; n < qpStarts.length; n++) {
      const start = qpStarts[n]
      const block = lines.slice(start, qpStarts[n + 1] ?? lines.length)
      const dateRaw = block.find(dateLine)
      if (!dateRaw) continue
      const first = block[0].replace(/^QP\s*\/\s*/i, '').trim()
      const joined = block.join(' ')
      const dateIndex = block.indexOf(dateRaw)
      const amountSources = block.slice(0, dateIndex < 0 ? block.length : dateIndex)
      let amount = 0
      for (const candidate of amountSources) {
        const stripped = candidate.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        const matches = [...stripped.matchAll(/([\doOｏＯ][\doOｏＯ,，.]{0,7})\s*(円|m{1,2}|g(?:m)?|mm|ロ|口|=|＝|[Nn＞>2ンてvく～〜])/ig)]
        if (matches.length) {
          const rawAmount = matches[matches.length - 1][1]
          const parsed = /[oOｏＯ]/.test(rawAmount) ? 0 : Number(rawAmount.replace(/[,，.]/g, ''))
          if (parsed > 0 && parsed <= 999999) { amount = parsed; break }
        }
      }
      // Merchant may wrap across OCR lines; remove amount/date/payment noise from the block.
      let merchant = first
        .replace(/\s*[（(].*$/, '')
        .replace(/[＞>」】）)]+\s*$/, '')
      const wrapped = block.slice(1, dateIndex < 0 ? block.length : dateIndex)
        .filter(line => !/回\s*払|^[\d,，.]+\s*(?:円|m|g|=|＝)?$/i.test(line))
        .filter(line => !/(\d[\d,，.]{0,7})\s*(?:円|m{1,2}|g(?:m)?|mm|ロ|口|=|＝)/i.test(line))
      if (wrapped.length) merchant += wrapped.join('')
      merchant = cleanQpMerchant(merchant)
      if (!merchant || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(merchant)) {
        merchant = cleanQpMerchant(first)
      }
      if (!merchant) continue
      const { category, keyword } = classify(merchant, rules)
      recovered.push({
        date: findDate(dateRaw), time: '', amount, category,
        merchant: merchant.slice(0, 60),
        note: amount ? '' : '金額を読み取れませんでした。明細を確認してください',
        raw: block.join('\n'), suggested: category, keyword
      })
    }
    if (qpColumnAmounts.length === recovered.length) {
      recovered.forEach((row, index) => {
        row.amount = qpColumnAmounts[index]
        row.note = ''
        row.raw += '\\n右側の金額欄から金額を再認識'
      })
    }
    if (recovered.length > qpRows.length) return recovered
  }
  function cleanQpMerchant(value) {
    return value
      .replace(/\s*\d[\d,，.]{0,7}\s*(?:円|m{1,2}|g(?:m)?|mm|ロ|口|=|＝|[Nn＞>2ンてvく～〜])\s*[、,，。．.）)]*\s*$/i, '')
      .replace(/[＞>」】）)]+\s*$/, '')
      .replace(/[\s,，、。．.]+$/, '')
      .trim()
      .replace(/マイバスケツト/g, 'マイバスケット')
  }


  // Some issuers put merchant and reference on one line, then date/cardholder/payment/amount on another.
  // Other issuers put amount beside merchant and date on a separate line. Keep these layouts distinct.
  const isCardMetadata = line => /^(?:ご本人|本人|家族|家族会員|1回払い|一回払い|分割払い|リボ払い|ボーナス払い|ご本人\s+1回払い|本人\s+1回払い)$/i
    .test(line.replace(/[\s＞>]/g, ''))
  const pairedStatementRows = []
  for (let i = 0; i < lines.length; i++) {
    const detailLine = lines[i]
    if (!dateLine(detailLine) || !/[¥￥]\s*[\d,]+/.test(detailLine)) continue
    const amountMatch = detailLine.match(/[¥￥]\s*([\d,]+)/)
    if (!amountMatch) continue
    const amount = Number(amountMatch[1].replace(/,/g, ''))
    if (amount <= 0 || amount > 9999999) continue

    // Collect merchant text directly above this detail line. Skip cardholder/payment metadata,
    // and join OCR-wrapped suffixes such as "マクドナルドモバイルオーダ" + "ー".
    const parts = []
    for (let j = i - 1; j >= 0; j--) {
      const candidate = lines[j]
      if (dateLine(candidate)) break
      if (isCardMetadata(candidate) || paymentLine(candidate) || amountLine(candidate)) continue
      if (/^(?:ご本人|本人|家族|1回払い|一回払い|分割払い|リボ払い|ボーナス払い)$/.test(candidate.replace(/[\s＞>]/g, ''))) continue
      if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(candidate)) {
        // Ignore standalone reference numbers and other OCR noise.
        if (/^\d{4,}$/.test(candidate)) continue
        break
      }
      parts.unshift(candidate)
      // Usually merchant names occupy one or two lines; don't absorb unrelated page headings.
      if (parts.length >= 3) break
    }
    if (!parts.length) continue
    const merchantLine = cleanMerchant(parts.join(''))
    if (!merchantLine || isCardMetadata(merchantLine)) continue
    const { category, keyword } = classify(merchantLine, rules)
    pairedStatementRows.push({
      date: findDate(detailLine), time: '', amount, category,
      merchant: merchantLine.slice(0, 60), note: '',
      raw: merchantLine + '\n' + detailLine,
      suggested: category, keyword
    })
  }
  if (pairedStatementRows.length >= 2) return pairedStatementRows

  const merchantRows = []
  const dateLines = lines.filter(dateLine)
  let activeMerchantRow = null

  // OCR frequently returns one merchant+amount line, then a date/payment line.
  // Example: "セブンイレブン葛飾柴又4丁目店 521mM N".
  // Keep wrapped merchant suffixes attached to the immediately preceding row.
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (dateLine(line) || paymentLine(line)) {
      activeMerchantRow = null
      continue
    }
    if (/^目\s*店\s*[＞>]*$/.test(line)) {
      if (activeMerchantRow) activeMerchantRow.merchant += '目店'
      continue
    }
    if (amountLine(line)) {
      activeMerchantRow = null
      continue
    }
    let found = extractTrailingAmount(line)
    // If OCR wraps a long merchant name and places the amount on the next visual line,
    // join the two before parsing (e.g. "マクドナルドモバイルオーダ" + "ー 420 円").
    if (!found && i + 1 < lines.length && !dateLine(lines[i + 1]) && !paymentLine(lines[i + 1])) {
      const nextFound = extractTrailingAmount(lines[i + 1])
      if (nextFound && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(line)) {
        line = line + lines[i + 1]
        i++
        found = extractTrailingAmount(line)
      }
    }
    if (!found) continue
    // Some card apps put parenthetical merchant details on the line after the amount.
    // Keep that continuation with the merchant when the next line is the transaction date.
    let merchantSource = line.slice(0, found.index)
    if (i + 1 < lines.length && /^\s*[（(]/.test(lines[i + 1]) &&
        !dateLine(lines[i + 1]) && !extractTrailingAmount(lines[i + 1]) &&
        i + 2 < lines.length && dateLine(lines[i + 2])) {
      merchantSource += lines[i + 1]
      i++
    }
    const merchant = cleanMerchant(merchantSource)
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(merchant)) continue
    activeMerchantRow = { merchant, amount: found.amount, amountRaw: found.raw }
    merchantRows.push(activeMerchantRow)
  }

  if (merchantRows.length >= 2 && merchantRows.length === dateLines.length) {
    return merchantRows.map((row, i) => {
      const dateRaw = dateLines[i]
      const { category, keyword } = classify(row.merchant, rules)
      return {
        date: findDate(dateRaw), time: '', amount: row.amount, category,
        merchant: row.merchant.slice(0, 60), note: '',
        raw: row.merchant + '\n' + dateRaw + '\n' + row.amountRaw,
        suggested: category, keyword
      }
    }).filter(e => e.amount > 0)
  }

  const merchantLike = line => {
    if (dateLine(line) || amountLine(line) || paymentLine(line)) return false
    if (/^(?:目店|丁目店|店|円|¥|￥)$/i.test(line.replace(/[\s＞>]/g, ''))) return false
    return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(line)
  }

  // Card statements may also OCR as columns: merchant names first, then dates, then amounts.
  const merchants = []
  for (const line of lines) {
    if (!merchantLike(line)) continue
    if (/^(?:目店|丁目店|店)$/.test(line.replace(/[\s＞>]/g, '')) && merchants.length) {
      merchants[merchants.length - 1] += line.replace(/[＞>]/g, '')
    } else {
      merchants.push(cleanMerchant(line))
    }
  }
  const amountLines = lines.filter(amountLine)
  const hasColumnarShape = merchants.length >= 2 && dateLines.length >= 2 && amountLines.length >= 2
    && merchants.length === dateLines.length && dateLines.length === amountLines.length

  if (hasColumnarShape) {
    return merchants.map((merchant, i) => {
      const dateRaw = dateLines[i]
      const amount = cleanAmountLine(amountLines[i])
      const { category, keyword } = classify(merchant, rules)
      return {
        date: findDate(dateRaw), time: '', amount, category,
        merchant: merchant.slice(0, 60), note: '',
        raw: merchant + '\n' + dateRaw + '\n' + amountLines[i],
        suggested: category, keyword
      }
    }).filter(e => e.amount > 0)
  }

  const blocks = text.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean)
  if (blocks.length > 1) return blocks.map(block => parseEntry(block, rules)).filter(e => e.amount > 0)

  const hasReceiptTotal = /合\s*計|合计|小計|小计|総\s*額|total|請求額|お買上(?:げ)?金額/i.test(text)
  const transactionLines = lines.filter(line =>
    line.length >= 3 &&
    /(?:[¥￥]\s*[\d,]+|[\d,]+\s*(?:円|元|日元|块|塊))/.test(line) &&
    !/^(?:小計|合計|合计|消費税|税|お預り|お釣り|釣銭|現金|クレジット|total|tax)\b/i.test(line)
  )
  if (!hasReceiptTotal && transactionLines.length >= 2 && transactionLines.length === lines.length) {
    return transactionLines.map(line => parseEntry(line, rules)).filter(e => e.amount > 0)
  }

  // Do not mistake month/day digits for a transaction amount when OCR omitted the amount
  // from a card-statement row that still contains payment metadata.
  const hasCardPaymentMetadata = lines.some(line => /回\s*払(?:い)?/.test(line))
  const hasExplicitAmount = lines.some(line =>
    /[¥￥]\s*[\d,]+|[\d,]+\s*円|\d[\d,，.]{1,7}\s*(?:m{1,2}|g(?:m)?|mm|ロ|口)\b/i.test(line)
  )
  const entry = parseEntry(text, rules)
  if (hasCardPaymentMetadata && dateLines.length && !hasExplicitAmount) return [{ ...entry, amount: 0 }]
  return [entry]
}
// 图片 → 文字：Tesseract.js 在手机浏览器本地运行，不上传、不收费
export async function ocrImage(file, onProgress) {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(['jpn', 'eng'], 1, {
    logger: m => m.status === 'recognizing text' && onProgress?.(Math.round(m.progress * 100))
  })
  try {
    const primary = (await worker.recognize(file)).data.text
    if (!/QUIC\s*Pay|QUICPay|(?:^|[\s(（])QP\s*\//im.test(primary)) return primary

    let bitmap
    try {
      bitmap = await createImageBitmap(file)
      const sourceWidth = Math.max(1, Math.round(bitmap.width * 0.4))
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = sourceWidth * scale
      canvas.height = bitmap.height * scale
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return primary
      context.drawImage(bitmap, bitmap.width - sourceWidth, 0, sourceWidth, bitmap.height, 0, 0, canvas.width, canvas.height)

      // Enlarge and increase contrast before reading the right-aligned price column.
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < pixels.data.length; i += 4) {
        const luminance = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114
        const value = luminance > 178 ? 255 : 0
        pixels.data[i] = value
        pixels.data[i + 1] = value
        pixels.data[i + 2] = value
      }
      context.putImageData(pixels, 0, 0)

      const columnText = (await worker.recognize(canvas)).data.text
      // Accept OCR noise around an amount, but only retain plausible yen values.
      const amounts = columnText.split(/\r?\n/).map(line => line.trim())
        .map(line => {
          const normalized = line
            .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
            .replace(/[OoＯｏ]/g, '0')
            .replace(/[Il|]/g, '1')
            .replace(/[Ss]/g, '5')
            .replace(/[Ｂ]/g, '8')
            .replace(/[¥￥円,，.:\s]/g, '')
          const match = normalized.match(/^\D{0,2}(\d{2,6})\D{0,2}$/)
          return match ? Number(match[1]) : null
        })
        .filter(value => Number.isInteger(value) && value > 0 && value <= 999999)
      const qpCount = primary.split(/\r?\n/).filter(line => /QUIC\s*Pay|QP\s*\//i.test(line)).length
      if (qpCount >= 2 && amounts.length === qpCount) {
        return primary + '\n__QP_AMOUNT_COLUMN__\n' + amounts.join('\n')
      }
    } catch (_) {
      // Keep the primary OCR result if image cropping or the second pass is unavailable.
    } finally {
      bitmap?.close?.()
    }
    return primary
  } finally {
    await worker.terminate()
  }
}
