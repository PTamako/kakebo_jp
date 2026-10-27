// Cloudflare Pages Functions：/api/*
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } })

// 初回访问和后续访问都会补齐默认规则；INSERT OR IGNORE 保留用户自己新增/修改的规则。
// 关键词尽量采用店铺全名，避免「コジマ」误匹配「ペットのコジマ」。
const DEFAULT_RULES = {
  '餐饮': [
    'イトーヨーカドー','イトーヨーカ堂','ヨークフーズ','ヨークマート','ヨークプライス',
    '業務スーパー','業務スーパ','Gyomu Super','Gyomu','イオン','AEON','まいばすけっと','マックスバリュ','ダイエー',
    'ライフ','LIFE','サミット','サミットストア','マルエツ','東急ストア','東武ストア','西友','SEIYU','オーケー','OKストア',
    'ベルク','ヤオコー','オオゼキ','いなげや','コモディイイダ','アコレ','ビッグ・エー','ビッグエー','ロピア','オーケーストア',
    '成城石井','紀ノ国屋','KINOKUNIYA','クイーンズ伊勢丹','北野エース','まるいち','カスミ','ヨークベニマル','コープ','生協',
    '東急ストア','東急フードショー','京王ストア','京急ストア','小田急OX','フードワン','文化堂','オリンピック','スーパーバリュー','ベルクス',
    'まいばすけっと','マルエツプチ','ミニピアゴ','肉のハナマサ','ハナマサ','食品館あおば','アタック','全日食チェーン','とりせん','原信','ナルス','フレッセイ','フジスーパー','FUJIスーパー','ヤマナカ','平和堂','イズミヤ','万代','サンディ','トライアル','スーパーセンタートライアル','業務用食品スーパー','ビオセボン','Bio c’ Bon','オーガニックプラザ',
    'セブン-イレブン','セブンイレブン','セブン','ローソン','ファミリーマート','ファミマ','ミニストップ','デイリーヤマザキ',
    'NewDays','ニューデイズ','まいばす','マクドナルド','マック','モスバーガー','ケンタッキー','KFC','バーガーキング',
    '吉野家','すき家','松屋','なか卯','日高屋','餃子の王将','大阪王将','サイゼリヤ','ガスト','バーミヤン','ジョナサン',
    'デニーズ','ココス','びっくりドンキー','丸亀製麺','はなまるうどん','リンガーハット','てんや','大戸屋','やよい軒',
    'くら寿司','スシロー','はま寿司','かっぱ寿司','鳥貴族','ドトール','スターバックス','タリーズ','コメダ珈琲','サンマルクカフェ',
    'ミスタードーナツ','クリスピー・クリーム','シャトレーゼ','不二家','銀座コージーコーナー','文明堂','ヨックモック','カルディコーヒーファーム','カルディ','成城石井','富澤商店','久世福商店','業務用食品スーパー','パン','弁当','お弁当','惣菜','食品','食料品','スーパー','コンビニ',
    'ランチ','ディナー','モーニング',
    '一蘭','天下一品','蒙古タンメン中本','らあめん花月嵐','幸楽苑','餃子の満州','町田商店','日高屋','リンガーハット','丸源ラーメン','山岡家','一風堂','博多一風堂','らーめん山頭火','AFURI','つけ麺','ラーメン','らーめん',
    '焼肉きんぐ','牛角','安楽亭','叙々苑','焼肉ライク','ワンカルビ','七輪焼肉安安','しゃぶ葉','温野菜','木曽路','ゆず庵','しゃぶしゃぶ','すき焼き',
    '餃子の王将','大阪王将','リンガーハット','天丼てんや','かつや','松のや','とんかつ和幸','さぼてん','和食さと','夢庵','藍屋','華屋与兵衛','木曽路','とんでん',
    '磯丸水産','大庄水産','魚民','白木屋','目利きの銀次','や台ずし','庄や','鳥貴族','串カツ田中','世界の山ちゃん','塚田農場','てけてけ','磯丸水産',
    'コメダ珈琲店','星乃珈琲店','珈琲館','上島珈琲店','エクセルシオールカフェ','プロント','ベローチェ','サンマルクカフェ','ドトールコーヒーショップ','猿田彦珈琲','ブルーボトルコーヒー',
    'バーガーキング','フレッシュネスバーガー','ロッテリア','ゼッテリア','ウェンディーズ','サブウェイ','フレッシュネス','ケンタッキーフライドチキン','吉野家','すき家','松屋','なか卯',
    '丸亀製麺','はなまるうどん','杵屋','名代富士そば','ゆで太郎','小諸そば','箱根そば','富士そば','リンガーハット','日高屋',
    'オリジン弁当','キッチンオリジン','ほっともっと','ほっかほっか亭','崎陽軒','RF1','柿安','デパ地下','ほっともっと',
    'サーティワン','31アイスクリーム','ハーゲンダッツ','ゴンチャ','タピオカ','果汁工房果琳','築地銀だこ','銀だこ','ミスタードーナツ','ビアードパパ','クリスピー・クリーム・ドーナツ',
    'Uber Eats','ウーバーイーツ','出前館','menuデリバリー','Wolt','ウォルト','Rocket Now','ロケットナウ','マックデリバリー','ピザハット','ドミノ・ピザ','ピザーラ','ナポリの窯','銀のさら',
    '食べログ','ぐるなび','ホットペッパーグルメ','Oisix','オイシックス','ヨシケイ','パルシステム','コープデリ','生協宅配','らでぃっしゅぼーや'
  ],
  '饮食料品': [
    'まいばすけっと','まいばす','イオン','AEON','マックスバリュ','ダイエー','ライフ','LIFE','サミットストア','サミット','マルエツ','西友','SEIYU',
    'オーケーストア','オーケー','OKストア','ベルク','ヤオコー','オオゼキ','いなげや','コモディイイダ','アコレ','ビッグ・エー','ビッグエー','ロピア',
    '業務スーパー','業務スーパ','イトーヨーカドー','イトーヨーカ堂','ヨークフーズ','ヨークマート','ヨークプライス','マルエツプチ','ミニピアゴ','肉のハナマサ',
    'ハナマサ','食品館あおば','アタック','全日食チェーン','トライアル','スーパーセンタートライアル','成城石井','紀ノ国屋','KINOKUNIYA',
    'クイーンズ伊勢丹','北野エース','東急ストア','京王ストア','京急ストア','小田急OX','文化堂','スーパーバリュー','ベルクス','コープ','生協',
    'セブン-イレブン','セブンイレブン','セブンーイレブン','ローソン','ファミリーマート','ファミマ','ミニストップ','デイリーヤマザキ','NewDays','ニューデイズ'
  ],
  '日用品': [
    'マツモトキヨシ','マツキヨ','ウエルシア','ウェルシア','ツルハドラッグ','スギ薬局','サンドラッグ','ココカラファイン',
    'クリエイトSD','クリエイトエス・ディー','トモズ','ぱぱす','コスモス薬品','薬の福太郎','くすりの福太郎','クスリのアオキ',
    'ダイソー','DAISO','セリア','Seria','キャンドゥ','CanDo','ワッツ','Watts','無印良品','MUJI','ニトリ','NITORI','コーナンPRO','プロストック','オリンピック','ビバホーム','ユザワヤ','オカダヤ','トーカイ','手芸センタードリーム','アニメイト','タワーレコード','HMV','ハードオフ','オフハウス','トレジャーファクトリー',
    'IKEA','イケア','カインズ','CAINZ','コーナン','コメリ','ビバホーム','島忠','ケーヨーデイツー','DCM','ロイヤルホームセンター',
    '東急ハンズ','ハンズ','ハンズマン','3COINS','スリーコインズ','ドン・キホーテ','ドンキ','ドンキホーテ','ロフト','LOFT',
    'ハンズ','KEYUCA','Francfranc','フランフラン','ホームセンター','洗剤','ティッシュ','トイレットペーパー','日用品','消耗品',
    'シャンプー','ボディソープ','歯ブラシ','洗濯用品','台所用品','ゴミ袋','乾電池','電池','キッチン用品'
  ],
  '交通': [
    '京成電鉄','京成線','京成','JR東日本','JR','東京メトロ','メトロ','都営地下鉄','都営バス','京成バス','東急電鉄','東武鉄道',
    '小田急','京王線','西武線','つくばエクスプレス','TX','Suica','PASMO','モバイルSuica','モバイルPASMO','ICチャージ',
    'チャージ','定期券','乗車券','新幹線','タクシー','GOタクシー','S.RIDE','DiDi','Uber Taxi','バス','電車','地下鉄','駐車場',
    'Times','タイムズ','三井のリパーク','駐輪場','高速道路','ETC','ガソリン','ENEOS','出光','apollostation','コスモ石油',
    'レンタカー','ニッポンレンタカー','トヨタレンタカー','オリックスレンタカー','自転車修理',
  ],
  '购物': [
    'コジマ×ビックカメラ','コジマ','ビックカメラ','BIC CAMERA','ヨドバシカメラ','Yodobashi','ヤマダデンキ','ヤマダ電機',
    'エディオン','EDION','ケーズデンキ','K’sデンキ','ノジマ','Joshin','ジョーシン','Apple Store','アップルストア',
    'ユニクロ','UNIQLO','GU','ジーユー','しまむら','アベイル','無印良品','楽天市場','楽天市場店','楽天ブックス','楽天24','楽天ファッション','楽天トラベル','楽天ペイ','Amazon.co.jp','Amazon','アマゾン','アマゾンジャパン','Yahoo!ショッピング','ヤフーショッピング','Yahoo!フリマ','PayPayフリマ','PayPayモール','au PAY マーケット','au PAYマーケット','ポンパレモール','LOHACO','ロハコ','Qoo10','キューテン','メルカリ','メルカリShops','ラクマ','楽天ラクマ','minne','ミンネ','Creema','クリーマ','BASE','ベイス','STORES','ショップリスト','SHOPLIST','Temu','テム','SHEIN','シーイン','ZOZOTOWN','ゾゾタウン','ニッセンオンライン','ベルーナオンライン','ディノス','フェリシモ','ベルメゾンネット','カタログ通販','ヨドバシ.com','ヨドバシドットコム','ビックカメラ.com','ビックカメラドットコム','ヤマダウェブコム','Joshin web','ジョーシンウェブ','エディオンネットショップ','ケーズデンキオンライン','ノジマオンライン','コジマネット','Apple Storeオンライン','Microsoft Store','任天堂ストア','マイクロソフトストア','アスクル','ASKUL','モノタロウ','MonotaRO','ミスミ','MISUMI','たのめーる','カウネット','Amazon定期おトク便','楽天ふるさと納税','ふるさとチョイス','さとふる','ふるなび',
    'ZOZOTOWN','メルカリ','ロフトネットストア','アカチャンホンポオンライン','西松屋オンラインストア','トイザらス・ベビーザらス','ユニクロオンラインストア','GUオンラインストア','ABCマート','ABC-MART','アイルミネ','マルイウェブチャネル','三越伊勢丹オンラインストア','高島屋オンラインストア','大丸松坂屋オンラインストア','ZOZOTOWN',
    'アシックス','ASICS','アディダス','adidas','Nike','ナイキ','スポーツデポ','アルペン','ワークマン','WORKMAN',
    'しまむら','西松屋','アカチャンホンポ','赤ちゃん本舗','トイザらス','ビックカメラ','伊勢丹','三越','高島屋','松坂屋',
    '大丸','マルイ','ルミネ','パルコ','PARCO','ららぽーと','アウトレット','百貨店','衣料品','服','靴','バッグ','家電','ゲーム',
    '本屋','書店','紀伊國屋書店','丸善','ジュンク堂','ブックオフ','BOOKOFF','文房具','ロフト','雑貨','アクセサリー',
    '買い物',
  ],
  '居住': [
    '家賃','賃料','管理費','共益費','住宅ローン','電気料金','電気代','東京電力','TEPCO','ガス料金','ガス代','東京ガス',
    '水道料金','水道代','下水道','水道局','電気','ガス','水道','インターネット料金','SoftBank 光','ソフトバンク光',
    'NURO光','ドコモ光','auひかり','プロバイダ','固定回線','携帯料金','スマホ料金','携帯電話','Y!mobile','ワイモバイル',
    'SoftBank','ソフトバンク','ahamo','povo','LINEMO','UQ mobile','楽天モバイル','NHK','火災保険','地震保険','引越し',
    '引越センター','収納','家具配送',
  ],
  '医疗': [
    '病院','医院','クリニック','診療所','歯科','歯医者','眼科','皮膚科','内科','整形外科','薬局','調剤薬局','処方箋',
    '日本調剤','クオール薬局','アイセイ薬局','スギ薬局調剤','マツモトキヨシ調剤','ウエルシア薬局','ドラッグストア処方',
    '健康診断','人間ドック','検査','治療','歯科矯正','眼鏡処方','コンタクト処方','医療費','薬代','医療','看病',
  ],
  '娱乐': [
    'Netflix','ネットフリックス','Amazon Prime','Prime Video','Disney+','ディズニープラス','Hulu','U-NEXT','YouTube Premium',
    'Spotify','Apple Music','Nintendo Switch Online','PlayStation Plus','Steam','映画','TOHOシネマズ','イオンシネマ',
    'ユナイテッド・シネマ','カラオケ','ビッグエコー','まねきねこ','ジャンカラ','ラウンドワン','ROUND1','ゲームセンター',
    'ボウリング','水族館','動物園','美術館','博物館','ライブ','コンサート','チケットぴあ','ローチケ','e+','旅行','ホテル',
    '旅館','温泉','日帰り温泉','遊園地','ディズニー','USJ','レジャー','漫画喫茶','快活CLUB','ネットカフェ','趣味',
  ],
  '宠物': [
    'ペットのコジマ','ペットショップのコジマ','コジマ動物病院','ペットプラス','PETEMO','ペテモ','イオンペット','チャーム','charm 楽天市場店','ペットゴー','ペットゴー本店','ペット用品の通販','アマゾンペット','楽天ペット館','ヨドバシ ペット用品','ペットワン','ペットパラダイス','ペットライン','ロイヤルカナン公式オンラインストア',
    'ペットフォレスト','ペットエコ','ペットワールドアミーゴ','アミーゴ','ペットの専門店コジマ','ワンラブ','Coo&RIKU',
    'クーアンドリク','ペットショップ','ペットホテル','トリミング','動物病院','獣医','獣医師','犬猫病院','猫カフェ',
    '猫用品','犬用品','キャットフード','ドッグフード','ペットフード','猫砂','猫トイレ','猫用トイレ','ペットシーツ',
    'ペットシート','爪とぎ','キャットタワー','猫じゃらし','猫のおやつ','犬のおやつ','ペット保険','狂犬病','ワクチン接種',
    'フィラリア','ノミダニ','ペット用品',
  ]
}

const DEFAULT_RULE_ROWS = [...new Map(Object.entries(DEFAULT_RULES).flatMap(([category, keywords]) => keywords.map(keyword => [keyword, [keyword, category]]) )).values()]


// SBIの投信積立引落は資産移動として扱い、生活支出から除外する。
const isInvestmentTransfer = e => {
  const text = [e.merchant, e.note, e.raw].filter(Boolean).join(' ').toLowerCase()
  return /証券投信積立サービス|投信積立サービス|翌月買付分/.test(text) ||
    (/sbi/.test(text) && /投信積立|投資信託積立/.test(text))
}

export async function onRequest({ request, env, params }) {
  // 个人使用：设置环境变量 AUTH_TOKEN 后，所有请求都需要携带 x-token
  if (env.AUTH_TOKEN && request.headers.get('x-token') !== env.AUTH_TOKEN)
    return json({ error: 'unauthorized' }, 401)

  const db = env.DB
  const url = new URL(request.url)
  const m = request.method
  const [a, b] = params.path || []
  const month = (url.searchParams.get('month') || '').slice(0, 7)
  const entriesYear = (url.searchParams.get('year') || '').slice(0, 4)

  try {
    // Automatic one-time migration: existing rows default to expenses.
    try { await db.prepare('SELECT type FROM entries LIMIT 1').first() }
    catch (columnCheckError) {
      try { await db.prepare("ALTER TABLE entries ADD COLUMN type TEXT NOT NULL DEFAULT 'expense'").run() }
      catch (migrationError) {
        // Two first requests may race during the first deploy; accept it if the other request added the column.
        try { await db.prepare('SELECT type FROM entries LIMIT 1').first() }
        catch { throw migrationError }
      }
    }

    // transfer_target stores the destination account for asset-transfer entries.
    try { await db.prepare('SELECT transfer_target FROM entries LIMIT 1').first() }
    catch (columnCheckError) {
      try { await db.prepare('ALTER TABLE entries ADD COLUMN transfer_target TEXT').run() }
      catch (migrationError) {
        try { await db.prepare('SELECT transfer_target FROM entries LIMIT 1').first() }
        catch { throw migrationError }
      }
    }

    // Track whether a transfer has already been applied to its destination balance.
    try { await db.prepare('SELECT transfer_applied FROM entries LIMIT 1').first() }
    catch (columnCheckError) {
      try { await db.prepare('ALTER TABLE entries ADD COLUMN transfer_applied INTEGER NOT NULL DEFAULT 0').run() }
      catch (migrationError) {
        try { await db.prepare('SELECT transfer_applied FROM entries LIMIT 1').first() }
        catch { throw migrationError }
      }
    }

    // transfer_date is the date the money/points actually arrive at the destination.
    try { await db.prepare('SELECT transfer_date FROM entries LIMIT 1').first() }
    catch (columnCheckError) {
      try { await db.prepare('ALTER TABLE entries ADD COLUMN transfer_date TEXT').run() }
      catch (migrationError) {
        try { await db.prepare('SELECT transfer_date FROM entries LIMIT 1').first() }
        catch { throw migrationError }
      }
    }

    // Investment balances exist independently from household income/expense totals.
    await db.prepare(`CREATE TABLE IF NOT EXISTS investment_snapshots (
      platform TEXT PRIMARY KEY CHECK (platform IN ('sbi', 'paypay')),
      current_value INTEGER,
      pnl INTEGER,
      updated_at TEXT
    )`).run()
    await db.prepare("INSERT OR IGNORE INTO investment_snapshots (platform, current_value, pnl, updated_at) VALUES ('sbi', NULL, NULL, NULL)").run()
    const applyTransferDelta = async (target, delta) => {
      if (target !== 'sbi' || !delta) return
      await db.prepare("UPDATE investment_snapshots SET current_value = MAX(0, COALESCE(current_value, 0) + ?1), updated_at = ?2 WHERE platform = ?3")
        .bind(delta, new Date().toISOString(), target).run()
    }

    // Apply scheduled transfers only on/after their effective date. D1 batch makes
    // balance adjustment and marking due rows applied one atomic operation.
    const applyDueTransfers = async () => {
      const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
      for (const target of ['sbi']) {
        await db.batch([
          db.prepare("UPDATE investment_snapshots SET current_value = MAX(0, COALESCE(current_value, 0) + (SELECT COALESCE(SUM(amount), 0) FROM entries WHERE type = 'transfer' AND transfer_target = ?1 AND COALESCE(transfer_date, date) <= ?2 AND COALESCE(transfer_applied, 0) = 0)), updated_at = ?3 WHERE platform = ?1 AND EXISTS (SELECT 1 FROM entries WHERE type = 'transfer' AND transfer_target = ?1 AND COALESCE(transfer_date, date) <= ?2 AND COALESCE(transfer_applied, 0) = 0)")
            .bind(target, today, new Date().toISOString()),
          db.prepare("UPDATE entries SET transfer_applied = 1 WHERE type = 'transfer' AND transfer_target = ?1 AND COALESCE(transfer_date, date) <= ?2 AND COALESCE(transfer_applied, 0) = 0")
            .bind(target, today)
        ])
      }
    }
    await applyDueTransfers()

    // 既存のSBI投信積立明細も資産移動へ補正する（生活費統計から除外）。
    await db.prepare("UPDATE entries SET type = 'transfer', category = '投資・資産移動' WHERE (merchant LIKE '%証券投信積立サービス%' OR note LIKE '%証券投信積立サービス%' OR raw LIKE '%証券投信積立サービス%' OR merchant LIKE '%翌月買付分%' OR note LIKE '%翌月買付分%' OR raw LIKE '%翌月買付分%') AND type != 'transfer'").run()

    if (a === 'entries') {
      if (m === 'GET') {
        const datePrefix = entriesYear && /^\\d{4}$/.test(entriesYear) ? entriesYear : month
        const { results } = await db
          .prepare('SELECT * FROM entries WHERE date LIKE ?1 ORDER BY date DESC, time DESC, id DESC LIMIT 10000')
          .bind(datePrefix + '%').all()
        return json(results)
      }
      if (m === 'POST') {
        const e = await request.json()
        const transfer = e.type === 'transfer' || isInvestmentTransfer(e)
        const amount = Math.round(Number(e.amount))
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(amount) || amount <= 0)
          return json({ error: '日期或金额不正确' }, 400)
        const target = transfer && e.transferTarget === 'sbi' ? e.transferTarget : null
        const transferDate = transfer ? (e.transferDate || e.date) : null
        if (transfer && !/^\\d{4}-\\d{2}-\\d{2}$/.test(transferDate)) return json({ error: '振替日を確認してください' }, 400)
        const today = new Date().toISOString().slice(0, 10)
        const applied = target && transferDate <= today ? 1 : 0
        await db.prepare(
          'INSERT INTO entries (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)'
        ).bind(e.date, e.time || '', amount, transfer ? '投資・資産移動' : (e.category || (e.type === 'income' ? '工资' : '日用品')), e.merchant || '', e.note || '', (e.raw || '').slice(0, 2000), transfer ? 'transfer' : (e.type === 'income' ? 'income' : 'expense'), target, applied, transferDate).run()
        if (applied) await applyTransferDelta(target, amount)
        return json({ ok: true })
      }
      if (m === 'PUT' && b) {
        const e = await request.json()
        const transfer = e.type === 'transfer' || isInvestmentTransfer(e)
        const id = Number(b)
        const amount = Math.round(Number(e.amount))
        if (!Number.isInteger(id) || id <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(amount) || amount <= 0)
          return json({ error: '日期或金额不正确' }, 400)
        const previous = await db.prepare('SELECT amount, type, transfer_target, transfer_applied, transfer_date, date FROM entries WHERE id = ?1').bind(id).first()
        if (!previous) return json({ error: '明細が見つかりません' }, 404)
        const target = transfer && e.transferTarget === 'sbi' ? e.transferTarget : null
        const transferDate = transfer ? (e.transferDate || previous.transfer_date || e.date) : null
        if (transfer && !/^\\d{4}-\\d{2}-\\d{2}$/.test(transferDate)) return json({ error: '振替日を確認してください' }, 400)
        if (previous.transfer_applied && previous.transfer_target) await applyTransferDelta(previous.transfer_target, -Number(previous.amount || 0))
        const today = new Date().toISOString().slice(0, 10)
        const applied = target && transferDate <= today ? 1 : 0
        const result = await db.prepare(
          'UPDATE entries SET date = ?1, time = ?2, amount = ?3, category = ?4, merchant = ?5, note = ?6, raw = ?7, type = ?8, transfer_target = ?9, transfer_applied = ?10, transfer_date = ?11 WHERE id = ?12'
        ).bind(e.date, e.time || '', amount, transfer ? '投資・資産移動' : (e.category || (e.type === 'income' ? '工资' : '日用品')), e.merchant || '', e.note || '', (e.raw || '').slice(0, 2000), transfer ? 'transfer' : (e.type === 'income' ? 'income' : 'expense'), target, applied ? 1 : 0, transferDate, id).run()
        if (applied) await applyTransferDelta(target, amount)
        return json({ ok: true, changes: result.meta?.changes ?? null })
      }
      if (m === 'DELETE' && b) {
        const id = Number(b)
        const previous = await db.prepare('SELECT amount, transfer_target, transfer_applied FROM entries WHERE id = ?1').bind(id).first()
        if (previous?.transfer_applied && previous.transfer_target) await applyTransferDelta(previous.transfer_target, -Number(previous.amount || 0))
        await db.prepare('DELETE FROM entries WHERE id = ?1').bind(id).run()
        return json({ ok: true })
      }
    }
    if (a === 'categories') {
      if (m === 'GET') {
        const base = ['餐饮','饮食料品','日用品','交通','购物','居住','医疗','娱乐','宠物','其他']
        const { results } = await db.prepare("SELECT DISTINCT category FROM rules WHERE substr(keyword, 1, 13) = '__category__:' ORDER BY category").all()
        return json([...new Set([...base, ...results.map(r => r.category)])])
      }
      if (m === 'POST') {
        const body = await request.json()
        const name = String(body.name || '').trim().slice(0, 20)
        if (name.length < 1) return json({ error: '分类名称不能为空' }, 400)
        const reserved = ['餐饮','饮食料品','日用品','交通','购物','居住','医疗','娱乐','宠物','其他']
        if (reserved.includes(name)) return json({ ok: true, category: name })
        await db.prepare('INSERT OR IGNORE INTO rules (keyword, category) VALUES (?1, ?2)').bind('__category__:' + name, name).run()
        return json({ ok: true, category: name })
      }
    }
    if (a === 'rules') {
      if (m === 'GET') {
        // デフォルトルールとユーザー上書きルールを分離し、初期化や再デプロイで個人設定を消さない。
        await db.prepare('CREATE TABLE IF NOT EXISTS custom_rules (keyword TEXT PRIMARY KEY, category TEXT NOT NULL)').run()
        const marker = '__kakeibo_japanese_rules_v9_initialized__'
        const seeded = await db.prepare('SELECT keyword FROM rules WHERE keyword = ?1').bind(marker).first()
        if (!seeded) {
          // 旧规则表无法区分默认规则与个人规则：保留非默认关键词，以及被用户改过分类的默认关键词。
          const defaultCategories = new Map(DEFAULT_RULE_ROWS.map(([keyword, category]) => [keyword, category]))
          const legacy = await db.prepare("SELECT keyword, category FROM rules WHERE substr(keyword, 1, 13) != '__category__:'").all()
          for (const rule of (legacy.results || []).filter(rule =>
            !defaultCategories.has(rule.keyword) || defaultCategories.get(rule.keyword) !== rule.category
          )) {
            await db.prepare('INSERT OR IGNORE INTO custom_rules (keyword, category) VALUES (?1, ?2)').bind(rule.keyword, rule.category).run()
          }
          // 清理旧版遗留的默认关键词，但保留用户自定义分类元数据。
          await db.prepare("DELETE FROM rules WHERE substr(keyword, 1, 13) != '__category__:'").run()
          const rows = [...DEFAULT_RULE_ROWS, [marker, '其他']]
          for (let i = 0; i < rows.length; i += 40) {
            const batch = rows.slice(i, i + 40).map(([keyword, category]) =>
              db.prepare('INSERT OR REPLACE INTO rules (keyword, category) VALUES (?1, ?2)').bind(keyword, category)
            )
            await db.batch(batch)
          }
        }
        const [baseResult, customResult] = await Promise.all([
          db.prepare("SELECT * FROM rules WHERE keyword != ?1 AND substr(keyword, 1, 13) != ?2").bind(marker, '__category__:').all(),
          db.prepare('SELECT keyword, category FROM custom_rules').all()
        ])
        const merged = new Map((baseResult.results || []).map(rule => [rule.keyword, rule]))
        for (const rule of (customResult.results || [])) merged.set(rule.keyword, rule)
        return json([...merged.values()])
      }
      if (m === 'POST') {
        const r = await request.json()
        const kw = String(r.keyword || '').trim()
        const category = String(r.category || '').trim()
        if (kw.length < 2) return json({ error: '关键词太短' }, 400)
        if (!category) return json({ error: '分类不能为空' }, 400)
        await db.prepare('CREATE TABLE IF NOT EXISTS custom_rules (keyword TEXT PRIMARY KEY, category TEXT NOT NULL)').run()
        await db.prepare('INSERT INTO custom_rules (keyword,category) VALUES (?1,?2) ON CONFLICT(keyword) DO UPDATE SET category = excluded.category').bind(kw, category).run()
        return json({ ok: true, keyword: kw, category })
      }
    }

    if (a === 'transfers' && b && m === 'POST') {
      const id = Number(b)
      const item = await db.prepare("SELECT id, amount, transfer_target, transfer_applied, transfer_date, date FROM entries WHERE id = ?1 AND type = 'transfer'").bind(id).first()
      if (!item || item.transfer_target !== 'sbi') return json({ error: '対象の資産移動が見つかりません' }, 404)
      if (Number(item.transfer_applied) !== 1) {
        await applyTransferDelta('sbi', Number(item.amount || 0))
        await db.prepare('UPDATE entries SET transfer_applied = 1 WHERE id = ?1').bind(id).run()
      }
      const updated = await db.prepare('SELECT id, date, amount, merchant, note, transfer_target, transfer_applied, transfer_date FROM entries WHERE id = ?1').bind(id).first()
      return json(updated)
    }

    if (a === 'transfers' && m === 'GET') {
      const { results } = await db.prepare("SELECT id, date, amount, merchant, note, transfer_target, transfer_applied, transfer_date FROM entries WHERE type = 'transfer' AND transfer_target = 'sbi' AND (COALESCE(transfer_date, date) >= date('now', '-30 days') OR COALESCE(transfer_applied, 0) = 0) ORDER BY COALESCE(transfer_date, date) ASC, id DESC LIMIT 100").all()
      return json(results)
    }

    if (a === 'investments') {
      await db.prepare(`CREATE TABLE IF NOT EXISTS investment_snapshots (
        platform TEXT PRIMARY KEY CHECK (platform IN ('sbi', 'paypay')),
        current_value INTEGER,
        pnl INTEGER,
        updated_at TEXT
      )`).run()
      await db.prepare("INSERT OR IGNORE INTO investment_snapshots (platform, current_value, pnl, updated_at) VALUES ('sbi', NULL, NULL, NULL)").run()
      if (m === 'GET') {
        const { results } = await db.prepare("SELECT platform, current_value, pnl, updated_at FROM investment_snapshots ORDER BY CASE platform WHEN 'sbi' THEN 1 ELSE 2 END").all()
        return json(results)
      }
      if (m === 'PUT') {
        const body = await request.json()
        const platform = String(body.platform || '')
        const currentValue = Number(body.currentValue)
        const pnl = Number(body.pnl)
        if (platform !== 'sbi' ||
            !Number.isSafeInteger(currentValue) || currentValue < 0 ||
            !Number.isSafeInteger(pnl)) return json({ error: '入力内容を確認してください' }, 400)
        const updatedAt = new Date().toISOString()
        await db.prepare('INSERT INTO investment_snapshots (platform, current_value, pnl, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(platform) DO UPDATE SET current_value = excluded.current_value, pnl = excluded.pnl, updated_at = excluded.updated_at').bind(platform, currentValue, pnl, updatedAt).run()
        return json({ platform, current_value: currentValue, pnl, updated_at: updatedAt })
      }
    }

    if (a === 'stats' && m === 'GET') {
      const year = (url.searchParams.get('year') || '').slice(0, 4)
      if (year) {
        if (!/^\d{4}$/.test(year)) return json({ error: '年份格式不正确' }, 400)
        const like = year + '%'
        const total = await db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END),0) t, SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END) n, COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type = 'transfer' THEN amount ELSE 0 END),0) transferTotal, SUM(CASE WHEN type = 'transfer' THEN 1 ELSE 0 END) transferCount FROM entries WHERE date LIKE ?1").bind(like).first()
        const cat = await db.prepare("SELECT category, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'expense' GROUP BY category ORDER BY amount DESC").bind(like).all()
        const monthRows = await db.prepare("SELECT substr(date,1,7) month, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'expense' GROUP BY substr(date,1,7) ORDER BY month").bind(like).all()
        const incomeMonthRows = await db.prepare("SELECT substr(date,1,7) month, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'income' GROUP BY substr(date,1,7) ORDER BY month").bind(like).all()
        const incomeCategoryRows = await db.prepare("SELECT category, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'income' GROUP BY category ORDER BY amount DESC").bind(like).all()
        const incomeMonthCategoryRows = await db.prepare("SELECT substr(date,1,7) month, category, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'income' GROUP BY substr(date,1,7), category ORDER BY month, amount DESC").bind(like).all()
        return json({ year: Number(year), total: total.t, count: total.n, income: total.income, transferTotal: total.transferTotal, transferCount: total.transferCount, byCategory: cat.results, byMonth: monthRows.results, incomeByMonth: incomeMonthRows.results, incomeByCategory: incomeCategoryRows.results, incomeByMonthCategory: incomeMonthCategoryRows.results })
      }
      const like = month + '%'
      const total = await db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END),0) t, SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END) n, COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type = 'transfer' THEN amount ELSE 0 END),0) transferTotal, SUM(CASE WHEN type = 'transfer' THEN 1 ELSE 0 END) transferCount FROM entries WHERE date LIKE ?1").bind(like).first()
      const cat = await db.prepare("SELECT category, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'expense' GROUP BY category ORDER BY amount DESC").bind(like).all()
      const day = await db.prepare("SELECT date, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'expense' GROUP BY date ORDER BY date").bind(like).all()
      return json({ total: total.t, count: total.n, income: total.income, transferTotal: total.transferTotal, transferCount: total.transferCount, byCategory: cat.results, byDay: day.results })
    }
    return json({ error: 'not found' }, 404)
  } catch (err) {
    return json({ error: String(err.message || err) }, 500)
  }
}
