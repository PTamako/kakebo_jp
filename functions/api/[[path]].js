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
    'セブン-イレブン','セブンイレブン','セブン','ローソン','ファミリーマート','ファミマ','ミニストップ','デイリーヤマザキ',
    'NewDays','ニューデイズ','まいばす','マクドナルド','マック','モスバーガー','ケンタッキー','KFC','バーガーキング',
    '吉野家','すき家','松屋','なか卯','日高屋','餃子の王将','大阪王将','サイゼリヤ','ガスト','バーミヤン','ジョナサン',
    'デニーズ','ココス','びっくりドンキー','丸亀製麺','はなまるうどん','リンガーハット','てんや','大戸屋','やよい軒',
    'くら寿司','スシロー','はま寿司','かっぱ寿司','鳥貴族','ドトール','スターバックス','タリーズ','コメダ珈琲','サンマルクカフェ',
    'ミスタードーナツ','クリスピー・クリーム','パン','弁当','お弁当','惣菜','食品','食料品','スーパー','コンビニ',
    'ランチ','ディナー','モーニング'
  ],
  '日用品': [
    'マツモトキヨシ','マツキヨ','ウエルシア','ウェルシア','ツルハドラッグ','スギ薬局','サンドラッグ','ココカラファイン',
    'クリエイトSD','クリエイトエス・ディー','トモズ','ぱぱす','コスモス薬品','薬の福太郎','くすりの福太郎','クスリのアオキ',
    'ダイソー','DAISO','セリア','Seria','キャンドゥ','CanDo','ワッツ','Watts','無印良品','MUJI','ニトリ','NITORI',
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
    'ユニクロ','UNIQLO','GU','ジーユー','しまむら','アベイル','無印良品','楽天市場','楽天','Amazon','アマゾン','Yahoo!ショッピング',
    'ZOZOTOWN','メルカリ','ロフトネットストア','ヨドバシ.com','Qoo10','SHEIN','ニッセン','ベルーナ','ABCマート','ABC-MART',
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
    'ペットのコジマ','ペットショップのコジマ','コジマ動物病院','ペットプラス','PETEMO','ペテモ','イオンペット',
    'ペットフォレスト','ペットエコ','ペットワールドアミーゴ','アミーゴ','ペットの専門店コジマ','ワンラブ','Coo&RIKU',
    'クーアンドリク','ペットショップ','ペットホテル','トリミング','動物病院','獣医','獣医師','犬猫病院','猫カフェ',
    '猫用品','犬用品','キャットフード','ドッグフード','ペットフード','猫砂','猫トイレ','猫用トイレ','ペットシーツ',
    'ペットシート','爪とぎ','キャットタワー','猫じゃらし','猫のおやつ','犬のおやつ','ペット保険','狂犬病','ワクチン接種',
    'フィラリア','ノミダニ','ペット用品',
  ]
}

const DEFAULT_RULE_ROWS = Object.entries(DEFAULT_RULES).flatMap(([category, keywords]) =>
  keywords.map(keyword => [keyword, category])
)

export async function onRequest({ request, env, params }) {
  // 个人使用：设置环境变量 AUTH_TOKEN 后，所有请求都需要携带 x-token
  if (env.AUTH_TOKEN && request.headers.get('x-token') !== env.AUTH_TOKEN)
    return json({ error: 'unauthorized' }, 401)

  const db = env.DB
  const url = new URL(request.url)
  const m = request.method
  const [a, b] = params.path || []
  const month = (url.searchParams.get('month') || '').slice(0, 7)

  try {
    if (a === 'entries') {
      if (m === 'GET') {
        const { results } = await db
          .prepare('SELECT * FROM entries WHERE date LIKE ?1 ORDER BY date DESC, time DESC, id DESC LIMIT 1000')
          .bind(month + '%').all()
        return json(results)
      }
      if (m === 'POST') {
        const e = await request.json()
        const amount = Math.round(Number(e.amount))
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(amount) || amount <= 0)
          return json({ error: '日期或金额不正确' }, 400)
        await db.prepare(
          'INSERT INTO entries (date,time,amount,category,merchant,note,raw) VALUES (?1,?2,?3,?4,?5,?6,?7)'
        ).bind(e.date, e.time || '', amount, e.category || '其他', e.merchant || '', e.note || '', (e.raw || '').slice(0, 2000)).run()
        return json({ ok: true })
      }
      if (m === 'DELETE' && b) {
        await db.prepare('DELETE FROM entries WHERE id = ?1').bind(Number(b)).run()
        return json({ ok: true })
      }
    }
    if (a === 'rules') {
      if (m === 'GET') {
        const marker = '__kakeibo_japanese_rules_v3_seeded__'
        const seeded = await db.prepare('SELECT keyword FROM rules WHERE keyword = ?1').bind(marker).first()
        if (!seeded) {
          const rows = [...DEFAULT_RULE_ROWS, [marker, '其他']]
          // 分批写入，避免首次打开页面时逐条访问 D1。
          for (let i = 0; i < rows.length; i += 40) {
            const batch = rows.slice(i, i + 40).map(([keyword, category]) =>
              db.prepare('INSERT OR IGNORE INTO rules (keyword, category) VALUES (?1, ?2)').bind(keyword, category)
            )
            await db.batch(batch)
          }
        }
        return json((await db.prepare('SELECT * FROM rules WHERE keyword != ?1').bind(marker).all()).results)
      }
      if (m === 'POST') {
        const r = await request.json()
        const kw = String(r.keyword || '').trim()
        if (kw.length < 2) return json({ error: '关键词太短' }, 400)
        await db.prepare('INSERT OR REPLACE INTO rules (keyword,category) VALUES (?1,?2)').bind(kw, r.category).run()
        return json({ ok: true })
      }
    }
    if (a === 'stats' && m === 'GET') {
      const like = month + '%'
      const total = await db.prepare('SELECT COALESCE(SUM(amount),0) t, COUNT(*) n FROM entries WHERE date LIKE ?1').bind(like).first()
      const cat = await db.prepare('SELECT category, SUM(amount) amount FROM entries WHERE date LIKE ?1 GROUP BY category ORDER BY amount DESC').bind(like).all()
      const day = await db.prepare('SELECT date, SUM(amount) amount FROM entries WHERE date LIKE ?1 GROUP BY date ORDER BY date').bind(like).all()
      return json({ total: total.t, count: total.n, byCategory: cat.results, byDay: day.results })
    }
    return json({ error: 'not found' }, 404)
  } catch (err) {
    return json({ error: String(err.message || err) }, 500)
  }
}
