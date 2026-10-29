import { isAppliedSbiTransfer } from './investment-transfer.js'
import { recognizeWithGemma } from './gemma-ocr.js'
import { resolveRecurringApproval } from './recurring-approval.js'
import { aiQuotaState, reserveAiAttempt } from './ai-quota.js'
import { restoreAtomic } from './restore-atomic.js'
import { ensureUnifiedMerchantRules } from './merchant-rules-store.js'
import { ensureCategorySource } from './category-source-store.js'
// Cloudflare Pages Functions：/api/*
const validTime = value => value == null || value === '' || (typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

// 初回および以降のアクセスで既定ルールを補完する。INSERT OR IGNOREでユーザーの追加・変更ルールを保持する。
// 店舗名はできる限り正式名称を使用し、部分一致による誤判定を防ぐ。
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

const LEGACY_DEFAULT_RULE_ROWS = [...new Map(Object.entries(DEFAULT_RULES).flatMap(([category, keywords]) => keywords.map(keyword => [keyword, [keyword, category]]) )).values()]
// Prior browser-only recognizers are now seeded into D1; browser code does no category fallback.
const PARSER_DEFAULT_RULE_ROWS = [["マクドナルド","餐饮"],["マック","餐饮"],["モスバーガー","餐饮"],["ケンタッキー","餐饮"],["KFC","餐饮"],["ミスタードーナツ","餐饮"],["ミスド","餐饮"],["スターバックス","餐饮"],["スタバ","餐饮"],["ドトール","餐饮"],["タリーズ","餐饮"],["コメダ珈琲","餐饮"],["サイゼリヤ","餐饮"],["ガスト","餐饮"],["バーミヤン","餐饮"],["ジョナサン","餐饮"],["デニーズ","餐饮"],["すかいらーく","餐饮"],["吉野家","餐饮"],["すき家","餐饮"],["松屋","餐饮"],["なか卯","餐饮"],["丸亀製麺","餐饮"],["はなまるうどん","餐饮"],["日高屋","餐饮"],["餃子の王将","餐饮"],["大阪王将","餐饮"],["くら寿司","餐饮"],["スシロー","餐饮"],["はま寿司","餐饮"],["かっぱ寿司","餐饮"],["焼肉きんぐ","餐饮"],["牛角","餐饮"],["鳥貴族","餐饮"],["Uber Eats","餐饮"],["ウーバーイーツ","餐饮"],["出前館","餐饮"],["menu","餐饮"],["ピザハット","餐饮"],["ドミノ・ピザ","餐饮"],["ほっともっと","餐饮"],["オリジン弁当","餐饮"],["ほっかほっか亭","餐饮"],["食べログ","餐饮"],["マツモトキヨシ","日用品"],["マツキヨ","日用品"],["ウエルシア","日用品"],["ウェルシア","日用品"],["ツルハドラッグ","日用品"],["スギ薬局","日用品"],["ココカラファイン","日用品"],["サンドラッグ","日用品"],["クリエイトSD","日用品"],["クスリのアオキ","日用品"],["コスモス薬品","日用品"],["ダイソー","日用品"],["DAISO","日用品"],["セリア","日用品"],["Seria","日用品"],["キャンドゥ","日用品"],["Can★Do","日用品"],["ワッツ","日用品"],["ニトリ","日用品"],["無印良品","日用品"],["MUJI","日用品"],["カインズ","日用品"],["コーナン","日用品"],["DCM","日用品"],["ビバホーム","日用品"],["ドン・キホーテ","日用品"],["ドンキ","日用品"],["ロフト","日用品"],["LOFT","日用品"],["ハンズ","日用品"],["東急ハンズ","日用品"],["ユニクロ","日用品"],["UNIQLO","日用品"],["GU","日用品"],["しまむら","日用品"],["西松屋","日用品"],["アカチャンホンポ","日用品"],["赤ちゃん本舗","日用品"],["Suica","交通"],["PASMO","交通"],["ICOCA","交通"],["モバイルSuica","交通"],["モバイルPASMO","交通"],["JR東日本","交通"],["JR東海","交通"],["JR西日本","交通"],["東京メトロ","交通"],["都営地下鉄","交通"],["京成電鉄","交通"],["京急","交通"],["東急電鉄","交通"],["小田急電鉄","交通"],["京王電鉄","交通"],["東武鉄道","交通"],["西武鉄道","交通"],["タクシー","交通"],["GOタクシー","交通"],["DiDi","交通"],["日本交通","交通"],["Times駐車場","交通"],["タイムズ","交通"],["三井のリパーク","交通"],["ENEOS","交通"],["出光","交通"],["apollostation","交通"],["コスモ石油","交通"],["東京電力","居住"],["TEPCO","居住"],["東京ガス","居住"],["大阪ガス","居住"],["東邦ガス","居住"],["ENEOSでんき","居住"],["オクトパスエナジー","居住"],["Octopus Energy","居住"],["SoftBank 光","居住"],["ソフトバンク光","居住"],["ソフトバンク","居住"],["NTTファイナンス","居住"],["水道料金","居住"],["家賃","居住"],["管理費","居住"],["住宅ローン","居住"],["病院","医疗"],["クリニック","医疗"],["診療所","医疗"],["歯科","医疗"],["歯医者","医疗"],["調剤薬局","医疗"],["薬局","医疗"],["処方箋","医疗"],["日本調剤","医疗"],["クオール薬局","医疗"],["アイン薬局","医疗"],["スギ薬局調剤","医疗"],["眼科","医疗"],["整形外科","医疗"],["皮膚科","医疗"],["Netflix","娱乐"],["ネットフリックス","娱乐"],["Amazon Prime","娱乐"],["Prime Video","娱乐"],["Disney+","娱乐"],["ディズニープラス","娱乐"],["YouTube Premium","娱乐"],["Spotify","娱乐"],["Apple Music","娱乐"],["Nintendo","娱乐"],["PlayStation","娱乐"],["Steam","娱乐"],["カラオケ","娱乐"],["ビッグエコー","娱乐"],["まねきねこ","娱乐"],["ラウンドワン","娱乐"],["映画館","娱乐"],["TOHOシネマズ","娱乐"],["ユナイテッド・シネマ","娱乐"],["チケットぴあ","娱乐"],["イープラス","娱乐"],["ペットショップ","宠物"],["ペットのコジマ","宠物"],["イオンペット","宠物"],["PETEMO","宠物"],["ペテモ","宠物"],["動物病院","宠物"],["獣医","宠物"],["ペットホテル","宠物"],["トリミング","宠物"],["チャーム","宠物"],["charm","宠物"],["Amazon.co.jp","购物"],["楽天市場","购物"],["Yahoo!ショッピング","购物"],["ヨドバシカメラ","购物"],["ビックカメラ","购物"],["ヤマダデンキ","购物"],["エディオン","购物"],["ケーズデンキ","购物"],["Apple Store","购物"],["ZARA","购物"],["H&M","购物"],["ABC-MART","购物"],["アディダス","购物"],["adidas","购物"],["ナイキ","购物"],["NIKE","购物"],["高島屋","购物"],["伊勢丹","购物"],["三越","购物"],["大丸","购物"],["松坂屋","购物"],["ルミネ","购物"],["パルコ","购物"],["PARCO","购物"],["ららぽーと","购物"],["まいばすけっと","饮食料品"],["まいばす","饮食料品"],["マイバスケット","饮食料品"],["マイバスケツト","饮食料品"],["マイバス","饮食料品"],["イオン","饮食料品"],["AEON","饮食料品"],["マックスバリュ","饮食料品"],["ダイエー","饮食料品"],["ライフ","饮食料品"],["LIFE","饮食料品"],["サミットストア","饮食料品"],["サミット","饮食料品"],["マルエツ","饮食料品"],["西友","饮食料品"],["SEIYU","饮食料品"],["オーケーストア","饮食料品"],["オーケー","饮食料品"],["OKストア","饮食料品"],["ベルク","饮食料品"],["ヤオコー","饮食料品"],["オオゼキ","饮食料品"],["いなげや","饮食料品"],["コモディイイダ","饮食料品"],["アコレ","饮食料品"],["ビッグ・エー","饮食料品"],["ビッグエー","饮食料品"],["ロピア","饮食料品"],["業務スーパー","饮食料品"],["業務スーパ","饮食料品"],["イトーヨーカドー","饮食料品"],["イトーヨーカ堂","饮食料品"],["ヨークフーズ","饮食料品"],["ヨークマート","饮食料品"],["ヨークプライス","饮食料品"],["マルエツプチ","饮食料品"],["ミニピアゴ","饮食料品"],["肉のハナマサ","饮食料品"],["ハナマサ","饮食料品"],["食品館あおば","饮食料品"],["アタック","饮食料品"],["全日食チェーン","饮食料品"],["トライアル","饮食料品"],["スーパーセンタートライアル","饮食料品"],["成城石井","饮食料品"],["紀ノ国屋","饮食料品"],["KINOKUNIYA","饮食料品"],["クイーンズ伊勢丹","饮食料品"],["北野エース","饮食料品"],["東急ストア","饮食料品"],["京王ストア","饮食料品"],["京急ストア","饮食料品"],["小田急OX","饮食料品"],["文化堂","饮食料品"],["スーパーバリュー","饮食料品"],["ベルクス","饮食料品"],["コープ","饮食料品"],["生協","饮食料品"],["コンビニ","饮食料品"],["セブン-イレブン","饮食料品"],["セブンイレブン","饮食料品"],["セブンーイレブン","饮食料品"],["セブンｰイレブン","饮食料品"],["セブン‐イレブン","饮食料品"],["セブン−イレブン","饮食料品"],["セブン－イレブン","饮食料品"],["7-Eleven","饮食料品"],["7-ELEVEN","饮食料品"],["7-11","饮食料品"],["ローソン","饮食料品"],["ファミリーマート","饮食料品"],["ファミマ","饮食料品"],["ミニストップ","饮食料品"],["NewDays","饮食料品"],["ニューデイズ","饮食料品"],["デイリーヤマザキ","饮食料品"],["ポプラ","饮食料品"]]
// New defaults are authoritative. Legacy rules are migration reference only and
// NEVER participate in classification; custom_rules remains user-owned.
export const DEFAULT_RULE_ROWS = [...new Map([...PARSER_DEFAULT_RULE_ROWS,
  ['セブン','饮食料品'], ['スーパー','饮食料品'], ['コジマ','购物'],
  ['Amazon','购物'],['AMAZON','购物'],['アマゾン','购物'],['楽天','购物'],['ユニクロ','购物'],['UNIQLO','购物']]
  .map(([keyword, category]) => [keyword, [keyword, category]])).values()]


// SBIの投信積立引落は資産移動として扱い、生活支出から除外する。
const isInvestmentTransfer = e => {
  const text = [e.merchant, e.note, e.raw].filter(Boolean).join(' ').toLowerCase()
  return /証券投信積立サービス|投信積立サービス|翌月買付分/.test(text) ||
    (/sbi/.test(text) && /投信積立|投資信託積立/.test(text))
}

async function sessionHash(session) {
  const bytes = new TextEncoder().encode(session)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('')
}

export async function onRequest({ request, env, params }) {
  // Device sessions are revocable and expire after 30 days. Never store the access code.
  if (!env.AUTH_TOKEN) return json({ error: 'アクセス認証が設定されていません' }, 503)
  const db = env.DB
  const url = new URL(request.url)
  const m = request.method
  const [a, b] = params.path || []
  // Cloudflare Pages preview deployments must never mutate the production ledger,
  // even if a dashboard binding accidentally points to the production DB.
  // Login/logout stay usable for read-only preview QA.
  const host = url.hostname.toLowerCase()
  // Runtime environment markers cover custom preview domains; the host rule
  // covers Pages previews even when the dashboard forgets to set a marker.
  const isPagesPreview = (host.endsWith('.kakeibo-f17.pages.dev') && host !== 'kakeibo-f17.pages.dev') ||
    env.APP_ENV === 'preview' ||
    (typeof env.CF_PAGES_BRANCH === 'string' && !!env.CF_PAGES_BRANCH && env.CF_PAGES_BRANCH !== 'main')
  // Preview bindings cannot be inspected from this repo. Fail closed on ALL preview
  // API access until a dedicated Preview D1 binding is explicitly verified.
  // A single opt-in flag is not evidence that the DB bindings are separate.
  // Both IDs must be recorded in the Preview environment, verified in the
  // dashboard, and different. This still cannot inspect the binding itself.
  const previewDbVerified = env.PREVIEW_D1_ISOLATED === 'true' &&
    typeof env.PREVIEW_D1_ID === 'string' && /^[a-f0-9-]{36}$/i.test(env.PREVIEW_D1_ID) &&
    typeof env.PRODUCTION_D1_ID === 'string' && /^[a-f0-9-]{36}$/i.test(env.PRODUCTION_D1_ID) &&
    env.PREVIEW_D1_ID.toLowerCase() !== env.PRODUCTION_D1_ID.toLowerCase()
  if (isPagesPreview && !previewDbVerified)
    return json({error:'プレビュー環境のテスト専用DBが未確認です。本番のデータを保護するためAPIを停止しています',code:'preview_db_not_verified'},503)
  // Verify the ID stored INSIDE the actual bound D1, not just variables.
  // A Preview accidentally bound to production has no matching identity and
  // fails CLOSED before session/auth or other data is accessible.
  if (isPagesPreview) {
    let actualIdentity
    try {
      actualIdentity=await db.prepare("SELECT value FROM environment_identity WHERE name='database_id'").first()
    }catch { return json({error:'テスト用DBの識別情報がありません',code:'preview_db_not_verified'},503) }
    if(actualIdentity?.value?.toLowerCase()!==env.PREVIEW_D1_ID.toLowerCase())
      return json({error:'テスト用DBの識別情報が一致しません',code:'preview_db_not_verified'},503)
  }
  if (isPagesPreview && m !== 'GET' && a !== 'auth')
    return json({error:'プレビュー画面では明細・設定を更新できません。本番サイトをご利用ください',code:'preview_read_only'},403)
  if (a === 'auth') {
    if (b === 'login' && m === 'POST') {
      let body
      try { body = await request.json() } catch { return json({ error: '入力内容を確認してください' }, 400) }
      // Rate-limit failed access-code attempts per client IP.
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
      const ipHash = await sessionHash(ip)
      try {
        await db.prepare('CREATE TABLE IF NOT EXISTS login_attempts (ip_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL)').run()
        await db.prepare('CREATE TABLE IF NOT EXISTS device_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)').run()
        const now = Date.now()
        // Reclaim expired authentication rows without touching sessions still in use.
        await db.batch([
          db.prepare('DELETE FROM login_attempts WHERE reset_at <= ?1').bind(now),
          db.prepare('DELETE FROM device_sessions WHERE expires_at <= ?1').bind(now)
        ]).catch(() => {})
        const attempt = await db.prepare('SELECT attempts, reset_at FROM login_attempts WHERE ip_hash = ?1').bind(ipHash).first()
        if (attempt && attempt.reset_at > now && attempt.attempts >= 5) return json({ error: 'しばらくしてから再度お試しください' }, 429)
        if (typeof body?.code !== 'string' || body.code !== env.AUTH_TOKEN) {
          await db.prepare('INSERT INTO login_attempts (ip_hash, attempts, reset_at) VALUES (?1, 1, ?2) ON CONFLICT(ip_hash) DO UPDATE SET attempts = CASE WHEN reset_at <= ?3 THEN 1 ELSE attempts + 1 END, reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END').bind(ipHash, now + 15 * 60 * 1000, now).run()
          return json({ error: 'アクセスコードを確認してください' }, 401)
        }
        await db.prepare('DELETE FROM login_attempts WHERE ip_hash = ?1').bind(ipHash).run()
      } catch { return json({ error: 'ログイン処理に失敗しました' }, 503) }
      const session = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('')
      const hash = await sessionHash(session)
      const expires = Date.now() + 30 * 24 * 60 * 60 * 1000
      try {
        await db.prepare('CREATE TABLE IF NOT EXISTS device_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)').run()
        await db.prepare('INSERT INTO device_sessions (token_hash, expires_at) VALUES (?1, ?2)').bind(hash, expires).run()
      } catch { return json({ error: 'ログイン処理に失敗しました' }, 500) }
      return json({ session, expires_at: expires })
    }
    if (b === 'logout' && m === 'POST') {
      const session = request.headers.get('x-session') || ''
      if (/^[a-f0-9]{64}$/.test(session)) {
        try { await db.prepare('DELETE FROM device_sessions WHERE token_hash = ?1').bind(await sessionHash(session)).run() } catch {}
      }
      return json({ ok: true })
    }
    return json({ error: 'not found' }, 404)
  }
  const session = request.headers.get('x-session') || ''
  if (!/^[a-f0-9]{64}$/.test(session)) return json({ error: 'アクセスコードを確認してください' }, 401)
  let validSession
  try { validSession = await db.prepare('SELECT token_hash FROM device_sessions WHERE token_hash = ?1 AND expires_at > ?2').bind(await sessionHash(session), Date.now()).first() }
  catch { return json({ error: 'アクセス認証を確認できません' }, 503) }
  if (!validSession) return json({ error: 'アクセスコードを確認してください' }, 401)
  if (a === 'ai-ocr' && b === 'quota' && m === 'GET') {
    try { return json(await aiQuotaState(db,env)) }
    catch { return json({error:'AI利用枠を確認できません'},503) }
  }
  if (a === 'ai-ocr' && m === 'POST') {
    if (!env.AI) return json({ error: 'AI接続が未設定です。Cloudflare PagesのAIバインディングを確認してください' }, 503)
    const size = Number(request.headers.get('content-length') || 0)
    if (size > 5 * 1024 * 1024) return json({ error: '画像サイズが大きすぎます' }, 413)
    let body
    try { body = await request.formData() } catch { return json({ error: '画像を読み込めませんでした' }, 400) }
    const file = body.get('image')
    const mode = body.get('mode') === 'receipt' ? 'receipt' : 'statement'
    if (!file || typeof file.arrayBuffer !== 'function' || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024)
      return json({ error: 'JPEG・PNG・WebP画像（4MB以下）を選択してください' }, 400)
    // Reserve a daily attempt before invoking Cloudflare AI; if quota D1 fails, use local OCR.
    try {
      const quota=await reserveAiAttempt(db,env)
      if(!quota.allowed)return json({error:'本日のAI画像認識の上限に達しました。端末内OCRをご利用ください',code:'daily_limit'},429)
    }catch {return json({error:'AI使用枠を確認できないため、端末内OCRをご利用ください',code:'quota_unavailable'},503)}
    try {
      const text = await recognizeWithGemma(env.AI, await file.arrayBuffer(), file.type, mode)
      return json({ text, engine: 'gemma4' })
    } catch (error) {
      const detail = String(error?.message || '')
      const category = /429|3040|capacity|rate.limit/i.test(detail) ? 'capacity' : /quota|credit|limit.exceeded/i.test(detail) ? 'quota' : /401|403|unauthoriz|permission/i.test(detail) ? 'permission' : /timeout|timed.out|deadline/i.test(detail) ? 'timeout' : /image|format|invalid|schema|input|400/i.test(detail) ? 'input' : /文字を読み取れません|empty|response/i.test(detail) ? 'empty_response' : 'unknown'
      console.error('Gemma OCR failed', { category, name: error?.name || 'Error', message: detail.slice(0, 400) })
      const messages = { capacity: 'AIが混雑しています。時間をおいて再試行してください', quota: 'AIの利用枠を確認してください', permission: 'AIの利用権限を確認してください', timeout: 'AIの応答がタイムアウトしました', input: 'AIが画像入力を受け付けませんでした', empty_response: 'AIの応答から文字を取得できませんでした', unknown: 'AI画像認識に失敗しました' }
      return json({ error: messages[category], code: category }, 502)
    }
  }
  const month = url.searchParams.get('month') || ''
  const entriesYear = url.searchParams.get('year') || ''

  try {
    const tokyoToday = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const applyDueTransfers = async () => {
      await db.prepare("UPDATE entries SET transfer_applied = 1 WHERE type = 'transfer' AND transfer_target = 'sbi' AND COALESCE(transfer_applied, 0) = 0 AND COALESCE(transfer_date, date) <= ?1")
        .bind(tokyoToday()).run()
    }
    // Versioned, fail-safe compatibility migration: one cheap read after
    // completion, rather than six column probes and a DDL index per request.
    let compatibilityReady=false
    try {
      const recorded=await db.prepare("SELECT version FROM schema_migrations WHERE version='api-compat-v1'").first()
      compatibilityReady=!!recorded
    }catch { /* Very old DB has no migration ledger yet. */ }
    if(!compatibilityReady){
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

    // Optional per-transaction payment source. Existing records remain unassigned.
    try { await db.prepare('SELECT payment_source FROM entries LIMIT 1').first() }
    catch (columnCheckError) {
      try { await db.prepare("ALTER TABLE entries ADD COLUMN payment_source TEXT NOT NULL DEFAULT ''").run() }
      catch (migrationError) {
        try { await db.prepare('SELECT payment_source FROM entries LIMIT 1').first() }
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

    // Investment snapshots are initialized only by the /investments route.
    // Ordinary ledger reads must not write to the investment table.
    // Applied transfers are ledger facts, NOT investment valuations.
    // Do not mutate investment_snapshots.current_value here: it is a manually
    // entered market valuation that may already include the purchase.

    // Transfer state is applied only by the explicit POST transfers/process-due endpoint.

    // D1 unique index makes OCR retries idempotent even when a response is lost.
    try { await db.prepare('SELECT client_request_id FROM entries LIMIT 1').first() }
    catch (columnCheckError) {
      try { await db.prepare('ALTER TABLE entries ADD COLUMN client_request_id TEXT').run() }
      catch (migrationError) {
        try { await db.prepare('SELECT client_request_id FROM entries LIMIT 1').first() }
        catch { throw migrationError }
      }
    }
    await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_client_request_id ON entries(client_request_id)').run()
    await db.prepare('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, description TEXT NOT NULL)').run()
    await db.prepare("INSERT OR IGNORE INTO schema_migrations(version,description) VALUES('api-compat-v1','Safe additive ledger columns and request-id index')").run()
    }

    // Never rewrite or delete existing ledger rows during migration.
    // SBI valuation entries remain untouched unless the user explicitly edits them.

    // Only rule-dependent endpoints perform the additive one-time data migration.
    // Old tables remain untouched for rollback; the unified table is authoritative.
    if (['rules','custom-rules','merchant-payment-rules','payment-sources','backup-snapshot','restore-atomic'].includes(a))
      await ensureUnifiedMerchantRules(db)
    if (['categories','category-icons','category-source','backup-snapshot','restore-atomic'].includes(a))
      await ensureCategorySource(db)
    // Normalized recurring plans and bills are the sole persistent stores.
    // Obsolete finance_settings is intentionally neither created nor queried.
    if (a === 'recurring-plans' || a === 'card-bills') {
      await db.prepare('CREATE TABLE IF NOT EXISTS recurring_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 31), category TEXT NOT NULL, payment_source TEXT NOT NULL, start_month TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)))').run()
      await db.prepare('CREATE TABLE IF NOT EXISTS card_bills (payment_source TEXT NOT NULL, bill_month TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, total_amount INTEGER NOT NULL CHECK(total_amount >= 0), transaction_count INTEGER NOT NULL CHECK(transaction_count >= 0), PRIMARY KEY(payment_source,bill_month))').run()
      if (m === 'GET' && !b) {
        if (a === 'recurring-plans') {
          const {results} = await db.prepare('SELECT id,name,amount,day,category,payment_source,start_month,enabled FROM recurring_plans ORDER BY name,id').all()
          return json(results.map(p => ({id:p.id,name:p.name,amount:p.amount,day:p.day,category:p.category,paymentSource:p.payment_source,startMonth:p.start_month,enabled:!!p.enabled})))
        }
        const {results} = await db.prepare('SELECT payment_source,bill_month,period_start,period_end,total_amount,transaction_count FROM card_bills ORDER BY bill_month DESC,payment_source').all()
        return json(results.map(x => ({name:x.payment_source,month:x.bill_month,start:x.period_start,end:x.period_end,total:x.total_amount,count:x.transaction_count})))
      }
      if (a === 'recurring-plans') {
        if (m === 'POST' && !b) {
          const item = await request.json()
          if (typeof item?.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(item.id) ||
              typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 ||
              !Number.isSafeInteger(item.amount) || item.amount <= 0 ||
              !Number.isInteger(item.day) || item.day < 1 || item.day > 31 ||
              typeof item.category !== 'string' || !item.category || typeof item.paymentSource !== 'string' ||
              !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.startMonth || '') || typeof item.enabled !== 'boolean')
            return json({error:'固定支出の入力を確認してください'},400)
          const result = await db.prepare('INSERT OR IGNORE INTO recurring_plans(id,name,amount,day,category,payment_source,start_month,enabled) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)').bind(item.id,item.name.trim(),item.amount,item.day,item.category,item.paymentSource,item.startMonth,item.enabled ? 1 : 0).run()
          return json({ok:true,created:!!result.meta?.changes})
        }
        if (m === 'PUT' && b && /^[a-zA-Z0-9-]{8,80}$/.test(b)) {
          const item = await request.json()
          if (typeof item?.name !== 'string' || !item.name.trim() || item.name.length > 120 ||
              !Number.isSafeInteger(item.amount) || item.amount <= 0 ||
              !Number.isInteger(item.day) || item.day < 1 || item.day > 31 ||
              typeof item.category !== 'string' || !item.category.trim() ||
              typeof item.paymentSource !== 'string' ||
              !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.startMonth || '') ||
              typeof item.enabled !== 'boolean') return json({error:'固定支出の入力を確認してください'},400)
          const updated = await db.prepare('UPDATE recurring_plans SET name=?1,amount=?2,day=?3,category=?4,payment_source=?5,start_month=?6,enabled=?7 WHERE id=?8')
            .bind(item.name.trim(),item.amount,item.day,item.category,item.paymentSource,item.startMonth,item.enabled?1:0,b).run()
          if(!updated.meta?.changes)return json({error:'固定支出が見つかりません'},404)
          // Stable plan IDs preserve the monthly idempotency key. Existing ledger entries are untouched.
          return json({ok:true})
        }
        if (m === 'DELETE' && b && /^[a-zA-Z0-9-]{8,80}$/.test(b)) {
          await db.prepare('DELETE FROM recurring_plans WHERE id=?1').bind(b).run()
          return json({ok:true})
        }
      } else {
        if (m === 'POST' && b === 'recalculate') {
          const item=await request.json()
          if(typeof item?.name!=='string'||!item.name.trim()||item.name.length>80||
             !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month||'')||
             !validDate(item.start)||!validDate(item.end)||item.start>item.end)
            return json({error:'カードの対象期間を確認してください'},400)
          // One SQL statement calculates and writes the bill from authoritative
          // D1 entries. A stale browser cache can never overwrite this total.
          await db.prepare(`INSERT INTO card_bills(payment_source,bill_month,period_start,period_end,total_amount,transaction_count)
            SELECT ?1,?2,?3,?4,COALESCE(SUM(amount),0),COUNT(*)
            FROM entries WHERE date>=?3 AND date<=?4 AND type='expense' AND payment_source=?1
            ON CONFLICT(payment_source,bill_month) DO UPDATE SET
              period_start=excluded.period_start,period_end=excluded.period_end,
              total_amount=excluded.total_amount,transaction_count=excluded.transaction_count`)
            .bind(item.name,item.month,item.start,item.end).run()
          const latest=await db.prepare('SELECT total_amount AS total,transaction_count AS count FROM card_bills WHERE payment_source=?1 AND bill_month=?2').bind(item.name,item.month).first()
          return json({ok:true,total:latest.total,count:latest.count})
        }
        if ((m === 'PUT' || m === 'POST') && !b) {
          const item = await request.json()
          if (typeof item?.name !== 'string' || !item.name || item.name.length > 80 ||
              !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month || '') ||
              !validDate(item.start) || !validDate(item.end) || item.start > item.end || !Number.isSafeInteger(item.total) || item.total < 0 ||
              !Number.isSafeInteger(item.count) || item.count < 0)
            return json({error:'カード請求額を確認してください'},400)
          // Restore uses POST (insert-only) so another device's saved bill always wins.
          const statement = m === 'POST'
            ? 'INSERT OR IGNORE INTO card_bills(payment_source,bill_month,period_start,period_end,total_amount,transaction_count) VALUES(?1,?2,?3,?4,?5,?6)'
            : 'INSERT INTO card_bills(payment_source,bill_month,period_start,period_end,total_amount,transaction_count) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(payment_source,bill_month) DO UPDATE SET period_start=excluded.period_start,period_end=excluded.period_end,total_amount=excluded.total_amount,transaction_count=excluded.transaction_count'
          await db.prepare(statement).bind(item.name,item.month,item.start,item.end,item.total,item.count).run()
          return json({ok:true})
        }
        if (m === 'DELETE' && !b) {
          const name = url.searchParams.get('name') || ''
          const month = url.searchParams.get('month') || ''
          if (!name || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({error:'削除対象の請求を確認してください'},400)
          await db.prepare('DELETE FROM card_bills WHERE payment_source=?1 AND bill_month=?2').bind(name,month).run()
          return json({ok:true})
        }
      }
      return json({error:'未対応の操作です'},405)
    }
    if (a === 'backup-snapshot' && m === 'GET') {
      // db.batch() executes all SELECTs inside one D1 transaction, preventing
      // mixed ledger/settings snapshots between requests or devices.
      const size=await db.prepare('SELECT COUNT(*) AS total FROM entries').first()
      if(Number(size.total)>10000)return json({error:'大容量のバックアップは段階的に作成してください',code:'snapshot_too_large'},413)
      const statements=[
        'SELECT * FROM entries ORDER BY id',
        'SELECT id,name,amount,day,category,payment_source,start_month,enabled FROM recurring_plans ORDER BY id',
        'SELECT payment_source,bill_month,period_start,period_end,total_amount,transaction_count FROM card_bills ORDER BY payment_source,bill_month',
        'SELECT platform,current_value,pnl,updated_at FROM investment_snapshots ORDER BY platform',
        "SELECT name,closing_day,is_default,sort_order FROM payment_sources ORDER BY CASE WHEN name IN ('その他','其他') THEN 1 ELSE 0 END,sort_order,name",
        'SELECT keyword,payment_source FROM merchant_rules WHERE payment_source IS NOT NULL ORDER BY keyword',
        'SELECT keyword,category FROM merchant_rules WHERE category IS NOT NULL ORDER BY keyword',
        "SELECT category FROM rules WHERE substr(keyword,1,13)='__category__:' ORDER BY category",
        'SELECT category,icon FROM category_source WHERE icon IS NOT NULL ORDER BY category',
        'SELECT entry_id FROM dismissed_transfer_reminders ORDER BY entry_id'
      ].map(sql=>db.prepare(sql))
      const results=await db.batch(statements)
      const rows=n=>results[n]?.results||[]
      return json({
        format:'kakeibo-ledger-backup',version:3,exportedAt:new Date().toISOString(),
        entries:rows(0),
        plans:rows(1).map(x=>({id:x.id,name:x.name,amount:x.amount,day:x.day,category:x.category,paymentSource:x.payment_source,startMonth:x.start_month,enabled:!!x.enabled})),
        bills:rows(2).map(x=>({name:x.payment_source,month:x.bill_month,start:x.period_start,end:x.period_end,total:x.total_amount,count:x.transaction_count})),
        investments:rows(3),paymentSources:rows(4),merchantPaymentRules:rows(5),
        customRules:rows(6),
        categories:[...new Set(['餐饮','饮食料品','日用品','交通','购物','居住','医疗','娱乐','宠物','其他',...rows(7).map(x=>x.category)])],
        categoryIcons:Object.fromEntries(rows(8).map(x=>[x.category,x.icon])),
        dismissedTransfers:rows(9).map(x=>x.entry_id)
      })
    }
    if (a === 'restore-atomic' && m === 'POST') {
      const size=Number(request.headers.get('content-length')||0)
      if(size>2*1024*1024)return json({error:'一括復元のサイズ上限を超えました'},413)
      const payload=await request.json()
      try {
        const result=await restoreAtomic(db,payload)
        return json(result)
      }catch(e){
        if(/atomic_restore_too_large/.test(String(e)))return json({error:'一括復元の安全上限を超えました。小分け復元を使用してください'},413)
        if(/atomic_restore_invalid|バックアップ|不正|形式|取引/.test(String(e)))return json({error:'復元データを確認してください'},400)
        throw e
      }
    }
    if (a === 'finance-settings')
      return json({error:'この旧設定APIは廃止されました。現在の管理画面をご利用ください',code:'deprecated_finance_settings'},410)
    if (a === 'payment-sources' || a === 'merchant-payment-rules') {
      await db.prepare("CREATE TABLE IF NOT EXISTS payment_sources (name TEXT PRIMARY KEY, sort_order INTEGER NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)), closing_day INTEGER DEFAULT NULL CHECK(closing_day IS NULL OR closing_day BETWEEN 0 AND 31))").run()
      // Unified merchant_rules is created/migrated by ensureUnifiedMerchantRules.
    }
    if (a === 'payment-sources') {
      // Existing D1 installations lack closing_day. Leave all card records intact.
      const columns = await db.prepare('PRAGMA table_info(payment_sources)').all()
      if (!(columns.results || []).some(column => column.name === 'closing_day')) {
        try {
          await db.prepare('ALTER TABLE payment_sources ADD COLUMN closing_day INTEGER DEFAULT NULL CHECK(closing_day IS NULL OR closing_day BETWEEN 0 AND 31)').run()
        } catch (e) {
          // A concurrent first request may have added the field already.
          if (!/duplicate column name/i.test(String(e))) throw e
        }
      }
    }
    if (a === 'payment-sources' && !b && m === 'GET') {
      // Closing days are authoritative on payment_sources.closing_day.
      // Never recreate the deprecated finance_settings table.
      // Enforce the persisted sentinel on existing databases, without touching
      // transaction/payment references or any user-created payment method.
      await db.prepare("UPDATE payment_sources SET sort_order=99999 WHERE name IN ('その他','其他') AND sort_order<>99999").run()
      const { results } = await db.prepare("SELECT name, is_default, closing_day FROM payment_sources ORDER BY CASE WHEN name IN ('その他','其他') THEN 1 ELSE 0 END,sort_order,name").all()
      return json(results)
    }
    if (a === 'payment-sources' && b === 'restore-missing' && m === 'POST') {
      const body = await request.json()
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      const closingDay = body?.closingDay ?? null
      if (!name || name.length > 80 ||
          (closingDay !== null && (!Number.isInteger(closingDay) || closingDay < 0 || closingDay > 31)))
        return json({error:'復元するカード設定を確認してください'},400)
      // Insert name and closing day atomically; no later update may replace a
      // different device's card settings created in the meantime.
      const result = await db.prepare("INSERT OR IGNORE INTO payment_sources(name,sort_order,closing_day) VALUES(?1,CASE WHEN ?1 IN ('その他','其他') THEN 99999 ELSE (SELECT COALESCE(MAX(sort_order),-1)+1 FROM payment_sources WHERE name NOT IN ('その他','其他') AND sort_order<99999) END,?2)")
        .bind(name,closingDay).run()
      return json({ok:true,created:!!result.meta?.changes})
    }
    if (a === 'payment-sources' && b === 'restore-default' && m === 'POST') {
      const body = await request.json()
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > 80) return json({error:'既定カードを確認してください'},400)
      // Never reset a newer default set by another device while restoring.
      const result = await db.prepare('UPDATE payment_sources SET is_default=1 WHERE name=?1 AND NOT EXISTS (SELECT 1 FROM payment_sources WHERE is_default=1)').bind(name).run()
      return json({ok:true,restored:!!result.meta?.changes})
    }
    if (a === 'payment-sources' && b === 'closing-day' && m === 'POST') {
      const body = await request.json()
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      const day = body?.closingDay
      if (!name || !Number.isInteger(day) || day < 0 || day > 31) return json({error:'カードと締め日を確認してください'},400)
      const result = await db.prepare('UPDATE payment_sources SET closing_day=?1 WHERE name=?2').bind(day,name).run()
      if (!result.meta?.changes) return json({error:'カードが見つかりません'},404)
      return json({ok:true})
    }
    if (a === 'payment-sources' && b === 'initialize' && m === 'POST') {
      const body = await request.json()
      const names = Array.isArray(body?.names) ? [...new Set(body.names.filter(x => typeof x === 'string').map(x => x.trim()))] : []
      if (names.length > 100 || names.some(x => !x || x.length > 80)) return json({ error: 'カード名を確認してください' }, 400)
      const existing = await db.prepare('SELECT COUNT(*) AS n FROM payment_sources').first()
      if (!existing?.n) {
        const items = ['現金', ...names.filter(x => x !== '現金')]
        for (let i = 0; i < items.length; i++) await db.prepare("INSERT OR IGNORE INTO payment_sources(name,sort_order) VALUES(?1,CASE WHEN ?1 IN ('その他','其他') THEN 99999 ELSE ?2 END)").bind(items[i],i).run()
      }
      return json({ ok: true })
    }
    if (a === 'payment-sources' && !b && m === 'POST') {
      const body = await request.json()
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > 80) return json({ error: 'カード名を確認してください' }, 400)
      await db.prepare("INSERT OR IGNORE INTO payment_sources(name,sort_order) VALUES(?1,CASE WHEN ?1 IN ('その他','其他') THEN 99999 ELSE (SELECT COALESCE(MAX(sort_order),-1)+1 FROM payment_sources WHERE name NOT IN ('その他','其他') AND sort_order<99999) END)").bind(name).run()
      return json({ ok: true })
    }
    if (a === 'payment-sources' && b === 'default' && m === 'POST') {
      const body = await request.json()
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      if (name && !(await db.prepare('SELECT name FROM payment_sources WHERE name=?1').bind(name).first())) return json({ error: '登録済みのカードを選択してください' }, 400)
      await db.prepare('UPDATE payment_sources SET is_default=0 WHERE is_default=1').run()
      if (name) await db.prepare('UPDATE payment_sources SET is_default=1 WHERE name=?1').bind(name).run()
      return json({ ok: true })
    }
    if (a === 'payment-sources' && b === 'remove' && m === 'POST') {
      const body = await request.json()
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      if (!name || name === '現金') return json({ error: 'カード名を確認してください' }, 400)
      // Do not remove a card that is still used by an enabled automatic charge.
      await db.prepare('CREATE TABLE IF NOT EXISTS recurring_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 31), category TEXT NOT NULL, payment_source TEXT NOT NULL, start_month TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)))').run()
      const activePlan = await db.prepare('SELECT id FROM recurring_plans WHERE payment_source=?1 AND enabled=1 LIMIT 1').bind(name).first()
      if (activePlan) return json({error:'このカードを利用する固定支出が残っています。先に固定支出の設定を整理してください'},409)
      await db.batch([
        db.prepare('DELETE FROM merchant_rules WHERE payment_source=?1 AND category IS NULL').bind(name),
        db.prepare('UPDATE merchant_rules SET payment_source=NULL WHERE payment_source=?1').bind(name),
        db.prepare('DELETE FROM payment_sources WHERE name=?1').bind(name)
      ])
      return json({ ok: true })
    }
    if (a === 'merchant-payment-rules' && m === 'GET') {
      const { results } = await db.prepare('SELECT keyword, payment_source FROM merchant_rules WHERE payment_source IS NOT NULL ORDER BY LENGTH(keyword) DESC').all()
      return json(results)
    }
    if (a === 'merchant-payment-rules' && (m === 'POST' || m === 'PUT')) {
      const body = await request.json()
      const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : ''
      const name = typeof body?.paymentSource === 'string' ? body.paymentSource.trim() : ''
      if (keyword.length < 2 || keyword.length > 80 || !name || name.length > 80) return json({ error: '店舗と支払方法を確認してください' }, 400)
      if (!(await db.prepare('SELECT name FROM payment_sources WHERE name=?1').bind(name).first())) return json({ error: '登録済みの支払方法を選択してください' }, 400)
      // PUT is reserved for insert-if-missing during restore. Normal POST keeps edit behavior.
      const statement = m === 'PUT'
        ? 'INSERT INTO merchant_rules(keyword,payment_source) VALUES(?1,?2) ON CONFLICT(keyword) DO UPDATE SET payment_source=COALESCE(merchant_rules.payment_source,excluded.payment_source)'
        : 'INSERT INTO merchant_rules(keyword,payment_source) VALUES(?1,?2) ON CONFLICT(keyword) DO UPDATE SET payment_source=excluded.payment_source'
      await db.prepare(statement).bind(keyword,name).run()
      return json({ ok: true })
    }
    if (a === 'merchant-payment-rules' && m === 'DELETE') {
      const keyword = url.searchParams.get('keyword') || ''
      if (!keyword || keyword.length > 80) return json({ error: '店舗名を確認してください' }, 400)
      await db.batch([
        db.prepare('DELETE FROM merchant_rules WHERE keyword=?1 AND category IS NULL').bind(keyword),
        db.prepare('UPDATE merchant_rules SET payment_source=NULL WHERE keyword=?1').bind(keyword)
      ])
      return json({ ok: true })
    }

    if (a === 'payment-sources' && b === 'rename' && m === 'POST') {
      const body = await request.json()
      const oldName = typeof body?.oldName === 'string' ? body.oldName.trim() : ''
      const newName = typeof body?.newName === 'string' ? body.newName.trim() : ''
      if (!oldName || !newName || oldName === '現金' || oldName.length > 80 || newName.length > 80)
        return json({ error: 'カード名を確認してください' }, 400)
      if (oldName === newName) return json({ ok: true, changes: 0 })
      if (await db.prepare('SELECT name FROM payment_sources WHERE name=?1').bind(newName).first()) return json({ error: '同じカード名が登録されています' }, 409)
      // Ensure normalized tables exist even if this is the first API call after deployment.
      await db.prepare('CREATE TABLE IF NOT EXISTS recurring_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 31), category TEXT NOT NULL, payment_source TEXT NOT NULL, start_month TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)))').run()
      await db.prepare('CREATE TABLE IF NOT EXISTS card_bills (payment_source TEXT NOT NULL, bill_month TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, total_amount INTEGER NOT NULL CHECK(total_amount >= 0), transaction_count INTEGER NOT NULL CHECK(transaction_count >= 0), PRIMARY KEY(payment_source,bill_month))').run()
      // D1 batch keeps ledger, card and normalized finance references consistent.
      // A saved bill for the destination name/month must not be silently overwritten.
      const collision = await db.prepare('SELECT 1 AS found FROM card_bills WHERE payment_source=?1 AND bill_month IN (SELECT bill_month FROM card_bills WHERE payment_source=?2) LIMIT 1').bind(newName,oldName).first()
      if (collision) return json({error:'変更先に同月のカード請求が存在します'},409)
      const result = await db.batch([
        db.prepare("UPDATE payment_sources SET name=?1,sort_order=CASE WHEN ?1 IN ('その他','其他') THEN 99999 WHEN ?2 IN ('その他','其他') THEN (SELECT COALESCE(MAX(sort_order),-1)+1 FROM payment_sources WHERE name NOT IN ('その他','其他') AND sort_order<99999) ELSE sort_order END WHERE name=?2").bind(newName,oldName),
        db.prepare('UPDATE merchant_rules SET payment_source=?1 WHERE payment_source=?2').bind(newName,oldName),
        db.prepare('UPDATE entries SET payment_source=?1 WHERE payment_source=?2').bind(newName,oldName),
        db.prepare('UPDATE recurring_plans SET payment_source=?1 WHERE payment_source=?2').bind(newName,oldName),
        db.prepare('UPDATE card_bills SET payment_source=?1 WHERE payment_source=?2').bind(newName,oldName)
      ])
      return json({ ok: true, changes: result[2]?.meta?.changes ?? 0 })
    }
    if (a === 'recurring-post' && m === 'POST') {
      // Atomic, non-destructive fixed-expense insertion; conflicting manual records win.
      await db.prepare('CREATE TABLE IF NOT EXISTS recurring_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 31), category TEXT NOT NULL, payment_source TEXT NOT NULL, start_month TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)))').run()
      const body = await request.json()
      const planId = typeof body?.planId === 'string' ? body.planId : ''
      const scheduledMonth = typeof body?.month === 'string' ? body.month : ''
      if (!/^[a-zA-Z0-9-]{8,80}$/.test(planId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(scheduledMonth))
        return json({error:'固定支出の対象を確認してください'},400)
      const plan = await db.prepare('SELECT id,name,amount,day,category,payment_source,start_month,enabled FROM recurring_plans WHERE id=?1').bind(planId).first()
      if (!plan || !plan.enabled || !Number.isSafeInteger(Number(plan.amount)) || Number(plan.amount)<=0)
        return json({error:'有効な固定支出が見つかりません'},404)
      const approved = resolveRecurringApproval(body,plan)
      if(approved.error)return json({error:approved.error,code:approved.code},approved.status)
      const date=approved.date
      if (date > tokyoToday()) return json({error:'予定日前の固定支出は登録できません'},409)
      const clientRequestId = 'recurring_'+plan.id.replace(/-/g,'')+'_'+scheduledMonth.replace('-','')
      if (await db.prepare('SELECT id FROM entries WHERE client_request_id=?1').bind(clientRequestId).first())
        return json({ok:true,created:false,duplicate:true,conflict:false})
      const result = await db.prepare(`INSERT INTO entries
        (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source)
        SELECT ?1,'',?2,?3,?4,'毎月の固定支出（自動記録）','','expense',NULL,0,NULL,?5,?6
        WHERE NOT EXISTS (SELECT 1 FROM entries WHERE substr(date,1,7)=substr(?1,1,7)
          AND type='expense' AND merchant=?4 AND COALESCE(payment_source,'')=?6)
        ON CONFLICT(client_request_id) DO NOTHING`)
        .bind(date,plan.amount,plan.category,plan.name,clientRequestId,plan.payment_source || '').run()
      return json({ok:true,created:!!result.meta?.changes,duplicate:false,conflict:!result.meta?.changes})
    }
    if (a === 'entry-years' && m === 'GET') {
      // Query actual ledger years instead of silently omitting records before 2018 or in future years.
      const { results } = await db.prepare("SELECT substr(date,1,4) AS year, COUNT(*) AS count FROM entries GROUP BY substr(date,1,4) ORDER BY year").all()
      return json((results || []).filter(row => /^\d{4}$/.test(String(row.year))).map(row => ({year:String(row.year),count:Number(row.count)})))
    }
    if (a === 'entries') {
      if (m === 'GET') {
        if ((entriesYear && !/^\d{4}$/.test(entriesYear)) ||
            (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) ||
            (!entriesYear && !month)) return json({ error: '対象期間が正しくありません' }, 400)
        const datePrefix = entriesYear || month
        // Stable ID-cursor pagination for full exports. Keep OFFSET for older clients.
        const cursorRaw = url.searchParams.get('cursor')
        if (cursorRaw !== null) {
          const cursor = Number(cursorRaw)
          if (!Number.isSafeInteger(cursor) || cursor < 0) return json({error:'読み込み位置が正しくありません'},400)
          const {results} = await db.prepare('SELECT * FROM entries WHERE date LIKE ?1 AND id > ?2 ORDER BY id ASC LIMIT 500').bind(datePrefix+'%',cursor).all()
          return json(results)
        }
        const offsetRaw = url.searchParams.get('offset')
        const offset = offsetRaw === null ? 0 : Number(offsetRaw)
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) return json({ error: '読み込み位置が正しくありません' }, 400)
        // Legacy clients get the same list shape; the annual view requests 500-row pages.
        const limit = offsetRaw === null ? 10000 : 500
        const { results } = await db
          .prepare('SELECT * FROM entries WHERE date LIKE ?1 ORDER BY date DESC, time DESC, id DESC LIMIT ?2 OFFSET ?3')
          .bind(datePrefix + '%', limit, offset).all()
        return json(results)
      }
      if (m === 'POST') {
        const e = await request.json()
        const transfer = e.type === 'transfer' || (!['income', 'expense'].includes(e.type) && isInvestmentTransfer(e))
        const amount = Number(e.amount)
        if (!validDate(e.date) || !validTime(e.time) || !Number.isSafeInteger(Number(e.amount)) || !Number.isSafeInteger(amount) || amount <= 0)
          return json({ error: '日付または金額が正しくありません' }, 400)
        const paymentSource = e.paymentSource == null ? '' : String(e.paymentSource).trim()
        if (paymentSource.length > 80) return json({ error: '支払方法は80文字以内にしてください' }, 400)
        const target = transfer && e.transferTarget === 'sbi' ? e.transferTarget : null
        const transferDate = transfer ? (e.transferDate || e.date) : null
        if (transfer && !validDate(transferDate)) return json({ error: '振替日を確認してください' }, 400)
        const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const applied = isAppliedSbiTransfer({ type: transfer ? 'transfer' : e.type, transferTarget: target, transferDate, date: e.date }, today) ? 1 : 0
        const clientRequestId = e.clientRequestId == null ? null : String(e.clientRequestId).trim()
        if (clientRequestId && !/^[a-zA-Z0-9_-]{8,128}$/.test(clientRequestId))
          return json({ error: '記録IDの形式が正しくありません' }, 400)
        // Advisory prechecks in the browser can race with another device. Make
        // the final duplicate decision in ONE SQL insert on D1. Explicitly
        // confirmed legitimate repeats remain possible.
        const type = transfer ? 'transfer' : (e.type === 'income' ? 'income' : 'expense')
        const checkDuplicate = e.duplicatePolicy === 'check' && e.allowDuplicate !== true
        const insertSql = checkDuplicate
          ? `INSERT INTO entries (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source)
            SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13
            WHERE NOT EXISTS (SELECT 1 FROM entries WHERE date=?1 AND amount=?3
              AND TRIM(COALESCE(merchant,''))=TRIM(?5) AND type=?8 AND COALESCE(payment_source,'')=?13)
            ON CONFLICT(client_request_id) DO NOTHING`
          : 'INSERT INTO entries (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13) ON CONFLICT(client_request_id) DO NOTHING'
        const inserted = await db.prepare(insertSql).bind(e.date, e.time || '', amount,
          transfer ? '投資・資産移動' : (e.category || (e.type === 'income' ? '工资' : '日用品')),
          e.merchant || '', e.note || '', (e.raw || '').slice(0, 2000),
          type, target, applied, transferDate, clientRequestId, paymentSource).run()
        if (checkDuplicate && inserted.meta?.changes === 0) {
          const ownRetry = clientRequestId && await db.prepare('SELECT id FROM entries WHERE client_request_id=?1').bind(clientRequestId).first()
          if (!ownRetry) return json({error:'同じ日付・金額・店舗・支払方法の記録が追加されました。内容を再確認してください',code:'duplicate_candidate'},409)
        }
        const savedEntry = clientRequestId
          ? await db.prepare('SELECT id FROM entries WHERE client_request_id = ?1').bind(clientRequestId).first()
          : await db.prepare('SELECT id FROM entries WHERE id = ?1').bind(inserted.meta.last_row_id).first()
        return json({ ok: true, duplicate: inserted.meta?.changes === 0, id: savedEntry?.id || null })
      }
      if (m === 'PUT' && b) {
        const e = await request.json()
        const transfer = e.type === 'transfer' || (!['income', 'expense'].includes(e.type) && isInvestmentTransfer(e))
        const id = Number(b)
        const amount = Number(e.amount)
        if (!Number.isSafeInteger(id) || id <= 0 || !validDate(e.date) || !validTime(e.time) || !Number.isSafeInteger(amount) || amount <= 0)
          return json({ error: '日付または金額が正しくありません' }, 400)
        const previous = await db.prepare('SELECT amount, type, transfer_target, transfer_applied, transfer_date, date, payment_source FROM entries WHERE id = ?1').bind(id).first()
        if (!previous) return json({ error: '明細が見つかりません' }, 404)
        const paymentSource = e.paymentSource == null ? (previous.payment_source || '') : String(e.paymentSource).trim()
        if (paymentSource.length > 80) return json({ error: '支払方法は80文字以内にしてください' }, 400)
        const target = transfer && e.transferTarget === 'sbi' ? e.transferTarget : null
        const transferDate = transfer ? (e.transferDate || previous.transfer_date || e.date) : null
        if (transfer && !validDate(transferDate)) return json({ error: '振替日を確認してください' }, 400)
        const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const applied = target && transferDate <= today ? 1 : 0
        const result = await db.prepare(
          'UPDATE entries SET date = ?1, time = ?2, amount = ?3, category = ?4, merchant = ?5, note = ?6, raw = ?7, type = ?8, transfer_target = ?9, transfer_applied = ?10, transfer_date = ?11, payment_source = ?12 WHERE id = ?13'
        ).bind(e.date, e.time || '', amount, transfer ? '投資・資産移動' : (e.category || (e.type === 'income' ? '工资' : '日用品')), e.merchant || '', e.note || '', (e.raw || '').slice(0, 2000), transfer ? 'transfer' : (e.type === 'income' ? 'income' : 'expense'), target, applied ? 1 : 0, transferDate, paymentSource, id).run()
        return json({ ok: true, changes: result.meta?.changes ?? null })
      }
      if (m === 'DELETE' && b) {
        const id = Number(b)
        // Prevent accidental deletion from upgrades, retries or malformed API calls.
        // Only an explicitly confirmed single-record UI operation may delete a row.
        if (!Number.isSafeInteger(id) || id <= 0 ||
            request.headers.get('x-confirm-delete') !== String(id))
          return json({ error: '削除する記録の確認が必要です' }, 428)
        const result = await db.prepare('DELETE FROM entries WHERE id = ?1').bind(id).run()
        return json({ ok: true, changes: result.meta?.changes ?? 0 })
      }
    }
    if (a === 'category-source' && m === 'GET') {
      const { results } = await db.prepare('SELECT category,sort_order,icon,display_name FROM category_source ORDER BY sort_order,category').all()
      return json(results)
    }
    if (a === 'category-icons') {
      if (m === 'GET') {
        const { results } = await db.prepare('SELECT category, icon FROM category_source WHERE icon IS NOT NULL').all()
        return json(Object.fromEntries(results.map(r => [r.category, r.icon])))
      }
      if (m === 'POST' && b === 'restore-missing') {
        const data = await request.json()
        const category = typeof data?.category === 'string' ? data.category.trim() : ''
        const icon = typeof data?.icon === 'string' ? data.icon.trim() : ''
        if (!category || category.length > 20 || !/^[a-z][a-z-]{1,40}$/.test(icon))
          return json({error:'復元するカテゴリーアイコンを確認してください'},400)
        const result = await db.prepare(`INSERT INTO category_source(category,icon) VALUES(?1,?2)
          ON CONFLICT(category) DO UPDATE SET icon=excluded.icon WHERE category_source.icon IS NULL`).bind(category,icon).run()
        return json({ok:true,created:!!result.meta?.changes})
      }
    }
    if (a === 'categories') {
      // All category sorting and icons now live in category_source.
      await db.prepare("INSERT INTO category_source(category,sort_order) VALUES('其他',99999),('其他收入',99999) ON CONFLICT(category) DO UPDATE SET sort_order=99999").run()
      if (m === 'GET') {
        const base = ['餐饮','饮食料品','日用品','交通','购物','居住','医疗','娱乐','宠物','其他']
        const { results } = await db.prepare("SELECT DISTINCT category FROM rules WHERE substr(keyword, 1, 13) = '__category__:' ORDER BY category").all()
        // Old custom categories gain stable stored ranks without losing icons or rules.
        for (const category of results.map(r => r.category)) {
          if (category === '其他' || category === '其他收入') continue
          await db.prepare("INSERT INTO category_source(category,sort_order) VALUES(?1,(SELECT COALESCE(MAX(sort_order),8)+1 FROM category_source WHERE sort_order<99999)) ON CONFLICT(category) DO UPDATE SET sort_order=COALESCE(category_source.sort_order,excluded.sort_order)").bind(category).run()
        }
        const ranks = await db.prepare('SELECT category,sort_order FROM category_source').all()
        const rankMap = new Map((ranks.results || []).map(row=>[row.category,row.sort_order]))
        return json([...new Set([...base, ...results.map(r => r.category)])].sort((a,b)=>
          (a === '其他' ? 99999 : (rankMap.get(a) ?? (base.includes(a) ? base.indexOf(a) : 10000))) -
          (b === '其他' ? 99999 : (rankMap.get(b) ?? (base.includes(b) ? base.indexOf(b) : 10000))) ||
          a.localeCompare(b,'ja')
        ))
      }
      if (m === 'POST') {
        const body = await request.json()
        const name = String(body.name || '').trim().slice(0, 20)
        if (name.length < 1) return json({ error: 'カテゴリー名を入力してください' }, 400)
        const reserved = ['餐饮','饮食料品','日用品','交通','购物','居住','医疗','娱乐','宠物','其他','その他','其他收入','その他の収入']
        const icon = String(body.icon || 'other')
        const validIcons = ['food','dining','daily','transport','shopping','home','medical','pet','beauty','education','insurance','utilities','phone','tax','travel','subscriptions','gift','electricity','water','gas','rent','internet','hair','cosmetics','clothes','shoes','books','lessons','childcare','family','car','bicycle','fuel','parking','fitness','health','medicine','dental','cafe','hobby','music','movie','electronics','furniture','repair','charity','bank','savings','fees','delivery','cleaning','events','work','phone-device','other']
        if (!validIcons.includes(icon)) return json({ error: 'アイコンを確認してください' }, 400)
        if (reserved.includes(name)) return json({ error: '同じカテゴリが既にあります' }, 409)
        const existing = await db.prepare('SELECT keyword FROM rules WHERE keyword = ?1').bind('__category__:' + name).first()
        if (existing) return json({ error: '同じカテゴリが既にあります' }, 409)
        // A single transaction registers the category and both metadata fields.
        await db.batch([
          db.prepare('INSERT OR IGNORE INTO rules (keyword, category) VALUES (?1, ?2)').bind('__category__:' + name, name),
          db.prepare(`INSERT INTO category_source(category,sort_order,icon,display_name)
            VALUES(?1,(SELECT COALESCE(MAX(sort_order),8)+1 FROM category_source WHERE sort_order<99999),?2,?1)
            ON CONFLICT(category) DO UPDATE SET
              sort_order=COALESCE(category_source.sort_order,excluded.sort_order),
              icon=COALESCE(category_source.icon,excluded.icon),
              display_name=COALESCE(category_source.display_name,excluded.display_name)`).bind(name, icon)
        ])
        return json({ ok: true, category: name })
      }
    }
    if (a === 'custom-rules') {
      // Only the combined merchant_rules table is used for active preferences.
      if (m === 'POST') {
        const body = await request.json()
        const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : ''
        const category = typeof body?.category === 'string' ? body.category.trim() : ''
        if (keyword.length < 2 || keyword.length > 120 || !category || category.length > 120)
          return json({error:'カテゴリー規則を確認してください'},400)
        // Only add missing keys when restoring. User-edited mappings are never overwritten.
        await db.prepare('INSERT INTO merchant_rules(keyword,category) VALUES(?1,?2) ON CONFLICT(keyword) DO UPDATE SET category=COALESCE(merchant_rules.category,excluded.category)').bind(keyword,category).run()
        return json({ok:true})
      }
      if (m === 'GET') {
        const { results } = await db.prepare('SELECT keyword, category FROM merchant_rules WHERE category IS NOT NULL ORDER BY keyword').all()
        return json(results)
      }
      if (m === 'DELETE') {
        const keyword = url.searchParams.get('keyword') || ''
        if (keyword.length < 2 || keyword.length > 80) return json({ error: '店舗名を確認してください' }, 400)
        await db.batch([
        db.prepare('DELETE FROM merchant_rules WHERE keyword=?1 AND payment_source IS NULL').bind(keyword),
        db.prepare('UPDATE merchant_rules SET category=NULL WHERE keyword=?1').bind(keyword)
      ])
        return json({ ok: true })
      }
    }
    if (a === 'rules') {
      if (m === 'GET') {
        // デフォルトルールとユーザー上書きルールを分離し、初期化や再デプロイで個人設定を消さない。
        // Custom categories and payment rules coexist in merchant_rules.
        const marker = '__kakeibo_japanese_rules_v9_initialized__'
        const seeded = await db.prepare('SELECT keyword FROM rules WHERE keyword = ?1').bind(marker).first()
        if (!seeded) {
          // 旧ルールでは既定と個人設定を区別できないため、既定外のキーワードと変更済みの分類を保持する。
          const defaultCategories = new Map(LEGACY_DEFAULT_RULE_ROWS.map(([keyword, category]) => [keyword, category]))
          const legacy = await db.prepare("SELECT keyword, category FROM rules WHERE substr(keyword, 1, 13) != '__category__:'").all()
          for (const rule of (legacy.results || []).filter(rule =>
            !defaultCategories.has(rule.keyword) || defaultCategories.get(rule.keyword) !== rule.category
          )) {
            await db.prepare('INSERT INTO merchant_rules (keyword, category) VALUES (?1, ?2) ON CONFLICT(keyword) DO UPDATE SET category=COALESCE(merchant_rules.category,excluded.category)').bind(rule.keyword, rule.category).run()
          }
          // Never delete or overwrite legacy rules during a software upgrade.
          // Add only missing defaults and a completion marker. Existing user data
          // remains in the original table even after custom_rules is populated.
          const rows = [...DEFAULT_RULE_ROWS, [marker, '其他']]
          for (let i = 0; i < rows.length; i += 40) {
            const batch = rows.slice(i, i + 40).map(([keyword, category]) =>
              db.prepare('INSERT OR IGNORE INTO rules (keyword, category) VALUES (?1, ?2)').bind(keyword, category)
            )
            await db.batch(batch)
          }
        }
        // One-time additive reconciliation of previously browser-only defaults.
        // Correct an old default only if its stored value still equals the old
        // shipped value; leave any user-edited category and custom_rules intact.
        const v10Marker = '__kakeibo_d1_category_rules_v10__'
        if (!(await db.prepare('SELECT keyword FROM rules WHERE keyword = ?1').bind(v10Marker).first())) {
          // A few multi-row SQL statements rather than hundreds of D1 queries.
          // All values remain parameter-bound; INSERT OR IGNORE never overwrites data.
          const allDefaults = DEFAULT_RULE_ROWS
          for (let i = 0; i < allDefaults.length; i += 25) {
            const chunk = allDefaults.slice(i, i + 25)
            const placeholders = chunk.map(() => '(?, ?)').join(', ')
            await db.prepare('INSERT OR IGNORE INTO rules (keyword, category) VALUES ' + placeholders)
              .bind(...chunk.flat()).run()
          }
          // Never overwrite an existing category mapping. A row equal to a shipped
          // legacy default can also be a user's deliberate choice.
          // Mark completion last so a partial migration can be retried safely.
          await db.prepare('INSERT OR IGNORE INTO rules (keyword, category) VALUES (?1, ?2)').bind(v10Marker, '其他').run()
        }
        // Ignore old persisted built-in rows. Historical categories and rule rows
        // remain untouched in D1, but only the current dictionary is effective.
        const customResult = await db.prepare('SELECT keyword, category FROM merchant_rules WHERE category IS NOT NULL').all()
        const merged = new Map(DEFAULT_RULE_ROWS.map(([keyword,category]) => [keyword, {keyword,category,is_custom:false}]))
        for (const rule of (customResult.results || [])) merged.set(rule.keyword, { ...rule, is_custom: true })
        return json([...merged.values()].map(rule => ({ ...rule, is_custom: rule.is_custom === true })))
      }
      if (m === 'POST') {
        const r = await request.json()
        const kw = String(r.keyword || '').trim()
        const category = String(r.category || '').trim()
        if (kw.length < 2) return json({ error: 'キーワードは2文字以上で入力してください' }, 400)
        if (!category) return json({ error: 'カテゴリーを指定してください' }, 400)
        // Keep the user's payment mapping when updating the custom category.
        await db.prepare('INSERT INTO merchant_rules (keyword,category) VALUES (?1,?2) ON CONFLICT(keyword) DO UPDATE SET category = excluded.category').bind(kw, category).run()
        return json({ ok: true, keyword: kw, category })
      }
    }

    if (a === 'dismissed-transfer-reminders') {
      await db.prepare('CREATE TABLE IF NOT EXISTS dismissed_transfer_reminders (entry_id INTEGER PRIMARY KEY, dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run()
      if(m==='GET') {
        const {results}=await db.prepare('SELECT entry_id FROM dismissed_transfer_reminders ORDER BY entry_id').all()
        return json(results.map(x=>x.entry_id))
      }
      if(m==='POST') {
        const body=await request.json()
        const id=Number(body?.entryId)
        if(!Number.isSafeInteger(id)||id<=0)return json({error:'振替記録を確認してください'},400)
        const entry=await db.prepare("SELECT id FROM entries WHERE id=?1 AND type='transfer' AND transfer_target='sbi'").bind(id).first()
        if(!entry)return json({error:'振替の記録が見つかりません'},404)
        await db.prepare('INSERT OR IGNORE INTO dismissed_transfer_reminders(entry_id) VALUES(?1)').bind(id).run()
        return json({ok:true})
      }
    }
    if (a === 'transfers' && b === 'process-due' && m === 'POST') {
      // Explicit mutation: ordinary GET requests no longer silently modify entries.
      await applyDueTransfers()
      return json({ok:true})
    }
    if (a === 'transfers' && b && params.path?.[2] === 'dismiss' && m === 'POST') {
      const id = Number(b)
      if (!Number.isSafeInteger(id) || id <= 0) return json({ error: '明細IDが正しくありません' }, 400)
      const entry = await db.prepare("SELECT id FROM entries WHERE id = ?1 AND type = 'transfer' AND transfer_target = 'sbi'").bind(id).first()
      if (!entry) return json({ error: '対象の資産移動が見つかりません' }, 404)
      await db.prepare('CREATE TABLE IF NOT EXISTS dismissed_transfer_reminders (entry_id INTEGER PRIMARY KEY, dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run()
      await db.prepare('INSERT OR IGNORE INTO dismissed_transfer_reminders (entry_id) VALUES (?1)').bind(id).run()
      return json({ ok: true })
    }

    if (a === 'transfers' && b && m === 'POST') {
      const id = Number(b)
      const item = await db.prepare("SELECT id, amount, transfer_target, transfer_applied, transfer_date, date FROM entries WHERE id = ?1 AND type = 'transfer'").bind(id).first()
      if (!item || item.transfer_target !== 'sbi') return json({ error: '対象の資産移動が見つかりません' }, 404)
      if (String(item.transfer_date || item.date) > tokyoToday())
        return json({ error: '振替予定日前には処理できません' }, 409)
      await db.prepare("UPDATE entries SET transfer_applied = 1 WHERE id = ?1 AND type = 'transfer' AND transfer_target = 'sbi' AND COALESCE(transfer_applied,0) = 0")
        .bind(id).run()
      const updated = await db.prepare('SELECT id, date, amount, merchant, note, transfer_target, transfer_applied, transfer_date FROM entries WHERE id = ?1').bind(id).first()
      return json(updated)
    }

    if (a === 'transfers' && m === 'GET') {
      await db.prepare('CREATE TABLE IF NOT EXISTS dismissed_transfer_reminders (entry_id INTEGER PRIMARY KEY, dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run()
      const { results } = await db.prepare("SELECT id, date, amount, merchant, note, transfer_target, transfer_applied, transfer_date FROM entries WHERE type = 'transfer' AND transfer_target = 'sbi' AND NOT EXISTS (SELECT 1 FROM dismissed_transfer_reminders d WHERE d.entry_id = entries.id) AND (COALESCE(transfer_date, date) >= date('now', '-60 days') OR COALESCE(transfer_applied, 0) = 0) ORDER BY COALESCE(transfer_date, date) ASC, id DESC LIMIT 100").all()
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
        const { results } = await db.prepare("SELECT platform, current_value, pnl, updated_at, (SELECT COALESCE(SUM(amount),0) FROM entries WHERE type = 'transfer' AND transfer_target = investment_snapshots.platform AND transfer_applied = 1) AS invested_total FROM investment_snapshots ORDER BY CASE platform WHEN 'sbi' THEN 1 ELSE 2 END").all()
        return json(results)
      }
      if (m === 'POST' && b === 'restore-empty') {
        const body = await request.json()
        if (body?.platform !== 'sbi' ||
            (body.currentValue !== null && (!Number.isSafeInteger(body.currentValue) || body.currentValue < 0)) ||
            (body.pnl !== null && !Number.isSafeInteger(body.pnl)) ||
            (body.currentValue === null && body.pnl === null)) return json({error:'バックアップの資産データを確認してください'},400)
        // Fill an entirely blank snapshot only; never modify a manually entered SBI valuation.
        const result = await db.prepare("UPDATE investment_snapshots SET current_value=?1, pnl=?2, updated_at=?3 WHERE platform='sbi' AND current_value IS NULL AND pnl IS NULL")
          .bind(body.currentValue,body.pnl,new Date().toISOString()).run()
        return json({ok:true,restored:!!result.meta?.changes})
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
      const year = url.searchParams.get('year') || ''
      if (year) {
        if (!/^\d{4}$/.test(year)) return json({ error: '年份格式不正确' }, 400)
        const like = year + '%'
        const total = await db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END),0) t, SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END) n, COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type = 'transfer' THEN amount ELSE 0 END),0) transferTotal, SUM(CASE WHEN type = 'transfer' THEN 1 ELSE 0 END) transferCount FROM entries WHERE date LIKE ?1").bind(like).first()
        const cat = await db.prepare("SELECT category, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'expense' GROUP BY category ORDER BY amount DESC").bind(like).all()
        const monthRows = await db.prepare("SELECT substr(date,1,7) month, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'expense' GROUP BY substr(date,1,7) ORDER BY month").bind(like).all()
        const incomeMonthRows = await db.prepare("SELECT substr(date,1,7) month, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'income' GROUP BY substr(date,1,7) ORDER BY month").bind(like).all()
        const incomeCategoryRows = await db.prepare("SELECT category, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'income' GROUP BY category ORDER BY amount DESC").bind(like).all()
        const incomeMonthCategoryRows = await db.prepare("SELECT substr(date,1,7) month, category, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'income' GROUP BY substr(date,1,7), category ORDER BY month, amount DESC").bind(like).all()
        const paymentRows = await db.prepare("SELECT CASE WHEN TRIM(COALESCE(payment_source,'')) = '' OR payment_source = '現金' THEN '現金' ELSE 'カード・電子決済' END method, COUNT(*) count, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'expense' GROUP BY method ORDER BY amount DESC").bind(like).all()
        return json({ paymentMethods: paymentRows.results, year: Number(year), total: total.t, count: total.n, income: total.income, transferTotal: total.transferTotal, transferCount: total.transferCount, byCategory: cat.results, byMonth: monthRows.results, incomeByMonth: incomeMonthRows.results, incomeByCategory: incomeCategoryRows.results, incomeByMonthCategory: incomeMonthCategoryRows.results })
      }
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({error:'集計月を確認してください'},400)
      const like = month + '%'
      const total = await db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END),0) t, SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END) n, COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type = 'transfer' THEN amount ELSE 0 END),0) transferTotal, SUM(CASE WHEN type = 'transfer' THEN 1 ELSE 0 END) transferCount FROM entries WHERE date LIKE ?1").bind(like).first()
      const cat = await db.prepare("SELECT category, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'expense' GROUP BY category ORDER BY amount DESC").bind(like).all()
      const day = await db.prepare("SELECT date, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'expense' GROUP BY date ORDER BY date").bind(like).all()
      const paymentRows = await db.prepare("SELECT CASE WHEN TRIM(COALESCE(payment_source,'')) = '' OR payment_source = '現金' THEN '現金' ELSE 'カード・電子決済' END method, COUNT(*) count, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'expense' GROUP BY method ORDER BY amount DESC").bind(like).all()
      return json({ paymentMethods: paymentRows.results, total: total.t, count: total.n, income: total.income, transferTotal: total.transferTotal, transferCount: total.transferCount, byCategory: cat.results, byDay: day.results })
    }
    return json({ error: 'not found' }, 404)
  } catch (err) {
    console.error('家計簿 API エラー', err)
    return json({ error: 'サーバー処理に失敗しました' }, 500)
  }
}
