import { isAppliedSbiTransfer } from './investment-transfer.js'
import { recognizeWithGemma } from './gemma-ocr.js'
// Cloudflare Pages Functions：/api/*
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
const PARSER_DEFAULT_RULE_ROWS = [["マクドナルド","餐饮"],["マック","餐饮"],["モスバーガー","餐饮"],["ケンタッキー","餐饮"],["KFC","餐饮"],["ミスタードーナツ","餐饮"],["ミスド","餐饮"],["スターバックス","餐饮"],["スタバ","餐饮"],["ドトール","餐饮"],["タリーズ","餐饮"],["コメダ珈琲","餐饮"],["サイゼリヤ","餐饮"],["ガスト","餐饮"],["バーミヤン","餐饮"],["ジョナサン","餐饮"],["デニーズ","餐饮"],["すかいらーく","餐饮"],["吉野家","餐饮"],["すき家","餐饮"],["松屋","餐饮"],["なか卯","餐饮"],["丸亀製麺","餐饮"],["はなまるうどん","餐饮"],["日高屋","餐饮"],["餃子の王将","餐饮"],["大阪王将","餐饮"],["くら寿司","餐饮"],["スシロー","餐饮"],["はま寿司","餐饮"],["かっぱ寿司","餐饮"],["焼肉きんぐ","餐饮"],["牛角","餐饮"],["鳥貴族","餐饮"],["Uber Eats","餐饮"],["ウーバーイーツ","餐饮"],["出前館","餐饮"],["menu","餐饮"],["ピザハット","餐饮"],["ドミノ・ピザ","餐饮"],["ほっともっと","餐饮"],["オリジン弁当","餐饮"],["ほっかほっか亭","餐饮"],["食べログ","餐饮"],["マツモトキヨシ","日用品"],["マツキヨ","日用品"],["ウエルシア","日用品"],["ウェルシア","日用品"],["ツルハドラッグ","日用品"],["スギ薬局","日用品"],["ココカラファイン","日用品"],["サンドラッグ","日用品"],["クリエイトSD","日用品"],["クスリのアオキ","日用品"],["コスモス薬品","日用品"],["ダイソー","日用品"],["DAISO","日用品"],["セリア","日用品"],["Seria","日用品"],["キャンドゥ","日用品"],["Can★Do","日用品"],["ワッツ","日用品"],["ニトリ","日用品"],["無印良品","日用品"],["MUJI","日用品"],["カインズ","日用品"],["コーナン","日用品"],["DCM","日用品"],["ビバホーム","日用品"],["ドン・キホーテ","日用品"],["ドンキ","日用品"],["ロフト","日用品"],["LOFT","日用品"],["ハンズ","日用品"],["東急ハンズ","日用品"],["ユニクロ","日用品"],["UNIQLO","日用品"],["GU","日用品"],["しまむら","日用品"],["西松屋","日用品"],["アカチャンホンポ","日用品"],["赤ちゃん本舗","日用品"],["Suica","交通"],["PASMO","交通"],["ICOCA","交通"],["モバイルSuica","交通"],["モバイルPASMO","交通"],["JR東日本","交通"],["JR東海","交通"],["JR西日本","交通"],["東京メトロ","交通"],["都営地下鉄","交通"],["京成電鉄","交通"],["京急","交通"],["東急電鉄","交通"],["小田急電鉄","交通"],["京王電鉄","交通"],["東武鉄道","交通"],["西武鉄道","交通"],["タクシー","交通"],["GOタクシー","交通"],["DiDi","交通"],["日本交通","交通"],["Times駐車場","交通"],["タイムズ","交通"],["三井のリパーク","交通"],["ENEOS","交通"],["出光","交通"],["apollostation","交通"],["コスモ石油","交通"],["東京電力","居住"],["TEPCO","居住"],["東京ガス","居住"],["大阪ガス","居住"],["東邦ガス","居住"],["ENEOSでんき","居住"],["オクトパスエナジー","居住"],["Octopus Energy","居住"],["SoftBank 光","居住"],["ソフトバンク光","居住"],["ソフトバンク","居住"],["NTTファイナンス","居住"],["水道料金","居住"],["家賃","居住"],["管理費","居住"],["住宅ローン","居住"],["病院","医疗"],["クリニック","医疗"],["診療所","医疗"],["歯科","医疗"],["歯医者","医疗"],["調剤薬局","医疗"],["薬局","医疗"],["処方箋","医疗"],["日本調剤","医疗"],["クオール薬局","医疗"],["アイン薬局","医疗"],["スギ薬局調剤","医疗"],["眼科","医疗"],["整形外科","医疗"],["皮膚科","医疗"],["Netflix","娱乐"],["ネットフリックス","娱乐"],["Amazon Prime","娱乐"],["Prime Video","娱乐"],["Disney+","娱乐"],["ディズニープラス","娱乐"],["YouTube Premium","娱乐"],["Spotify","娱乐"],["Apple Music","娱乐"],["Nintendo","娱乐"],["PlayStation","娱乐"],["Steam","娱乐"],["カラオケ","娱乐"],["ビッグエコー","娱乐"],["まねきねこ","娱乐"],["ラウンドワン","娱乐"],["映画館","娱乐"],["TOHOシネマズ","娱乐"],["ユナイテッド・シネマ","娱乐"],["チケットぴあ","娱乐"],["イープラス","娱乐"],["ペットショップ","宠物"],["ペットのコジマ","宠物"],["コジマ","宠物"],["イオンペット","宠物"],["PETEMO","宠物"],["ペテモ","宠物"],["動物病院","宠物"],["獣医","宠物"],["ペットホテル","宠物"],["トリミング","宠物"],["チャーム","宠物"],["charm","宠物"],["Amazon.co.jp","购物"],["楽天市場","购物"],["Yahoo!ショッピング","购物"],["ヨドバシカメラ","购物"],["ビックカメラ","购物"],["ヤマダデンキ","购物"],["エディオン","购物"],["ケーズデンキ","购物"],["Apple Store","购物"],["ZARA","购物"],["H&M","购物"],["ABC-MART","购物"],["アディダス","购物"],["adidas","购物"],["ナイキ","购物"],["NIKE","购物"],["高島屋","购物"],["伊勢丹","购物"],["三越","购物"],["大丸","购物"],["松坂屋","购物"],["ルミネ","购物"],["パルコ","购物"],["PARCO","购物"],["ららぽーと","购物"],["まいばすけっと","饮食料品"],["まいばす","饮食料品"],["マイバスケット","饮食料品"],["マイバスケツト","饮食料品"],["マイバス","饮食料品"],["イオン","饮食料品"],["AEON","饮食料品"],["マックスバリュ","饮食料品"],["ダイエー","饮食料品"],["ライフ","饮食料品"],["LIFE","饮食料品"],["サミットストア","饮食料品"],["サミット","饮食料品"],["マルエツ","饮食料品"],["西友","饮食料品"],["SEIYU","饮食料品"],["オーケーストア","饮食料品"],["オーケー","饮食料品"],["OKストア","饮食料品"],["ベルク","饮食料品"],["ヤオコー","饮食料品"],["オオゼキ","饮食料品"],["いなげや","饮食料品"],["コモディイイダ","饮食料品"],["アコレ","饮食料品"],["ビッグ・エー","饮食料品"],["ビッグエー","饮食料品"],["ロピア","饮食料品"],["業務スーパー","饮食料品"],["業務スーパ","饮食料品"],["イトーヨーカドー","饮食料品"],["イトーヨーカ堂","饮食料品"],["ヨークフーズ","饮食料品"],["ヨークマート","饮食料品"],["ヨークプライス","饮食料品"],["マルエツプチ","饮食料品"],["ミニピアゴ","饮食料品"],["肉のハナマサ","饮食料品"],["ハナマサ","饮食料品"],["食品館あおば","饮食料品"],["アタック","饮食料品"],["全日食チェーン","饮食料品"],["トライアル","饮食料品"],["スーパーセンタートライアル","饮食料品"],["成城石井","饮食料品"],["紀ノ国屋","饮食料品"],["KINOKUNIYA","饮食料品"],["クイーンズ伊勢丹","饮食料品"],["北野エース","饮食料品"],["東急ストア","饮食料品"],["京王ストア","饮食料品"],["京急ストア","饮食料品"],["小田急OX","饮食料品"],["文化堂","饮食料品"],["スーパーバリュー","饮食料品"],["ベルクス","饮食料品"],["コープ","饮食料品"],["生協","饮食料品"],["コンビニ","饮食料品"],["セブン-イレブン","饮食料品"],["セブンイレブン","饮食料品"],["セブンーイレブン","饮食料品"],["セブンｰイレブン","饮食料品"],["セブン‐イレブン","饮食料品"],["セブン−イレブン","饮食料品"],["セブン－イレブン","饮食料品"],["7-Eleven","饮食料品"],["7-ELEVEN","饮食料品"],["7-11","饮食料品"],["ローソン","饮食料品"],["ファミリーマート","饮食料品"],["ファミマ","饮食料品"],["ミニストップ","饮食料品"],["NewDays","饮食料品"],["ニューデイズ","饮食料品"],["デイリーヤマザキ","饮食料品"],["ポプラ","饮食料品"]]
export const DEFAULT_RULE_ROWS = [...new Map([...LEGACY_DEFAULT_RULE_ROWS, ...PARSER_DEFAULT_RULE_ROWS].map(([keyword, category]) => [keyword, [keyword, category]])).values()]


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
  if (a === 'auth') {
    if (b === 'login' && m === 'POST') {
      let body
      try { body = await request.json() } catch { return json({ error: '入力内容を確認してください' }, 400) }
      // Rate-limit failed access-code attempts per client IP.
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
      const ipHash = await sessionHash(ip)
      try {
        await db.prepare('CREATE TABLE IF NOT EXISTS login_attempts (ip_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL)').run()
        const now = Date.now()
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

    // Investment balances exist independently from household income/expense totals.
    await db.prepare(`CREATE TABLE IF NOT EXISTS investment_snapshots (
      platform TEXT PRIMARY KEY CHECK (platform IN ('sbi', 'paypay')),
      current_value INTEGER,
      pnl INTEGER,
      updated_at TEXT
    )`).run()
    await db.prepare("INSERT OR IGNORE INTO investment_snapshots (platform, current_value, pnl, updated_at) VALUES ('sbi', NULL, NULL, NULL)").run()
    // Applied transfers are ledger facts, NOT investment valuations.
    // Do not mutate investment_snapshots.current_value here: it is a manually
    // entered market valuation that may already include the purchase.
    const tokyoToday = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const applyDueTransfers = async () => {
      await db.prepare("UPDATE entries SET transfer_applied = 1 WHERE type = 'transfer' AND transfer_target = 'sbi' AND COALESCE(transfer_applied, 0) = 0 AND COALESCE(transfer_date, date) <= ?1")
        .bind(tokyoToday()).run()
    }
    await applyDueTransfers()

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

    // Never rewrite or delete existing ledger rows during migration.
    // SBI valuation entries remain untouched unless the user explicitly edits them.

    // Settings are independent of historical ledger rows and safe to create on existing D1.
    // Personal finance configuration is kept on D1, not in browser storage.
    if (a === 'finance-settings') {
      await db.prepare('CREATE TABLE IF NOT EXISTS finance_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL)').run()
      const allowed = new Set(['plans', 'bills', 'closing-days'])
      if (!allowed.has(b)) return json({ error: '設定名が不正です' }, 400)
      if (m === 'GET') {
        const row = await db.prepare('SELECT value FROM finance_settings WHERE name=?1').bind(b).first()
        return json({ exists: !!row, value: row ? JSON.parse(row.value) : (b === 'closing-days' ? {} : []) })
      }
      if (m === 'POST' || m === 'PUT') {
        const body = await request.json()
        const value = body?.value
        const valid = b === 'closing-days'
          ? value && typeof value === 'object' && !Array.isArray(value) &&
            Object.entries(value).every(([name,day]) => name.length <= 80 && (day === '' || day === '末日' || (Number.isInteger(Number(day)) && Number(day) >= 1 && Number(day) <= 31)))
          : Array.isArray(value) && value.length <= 500 && value.every(item => item && typeof item === 'object' && !Array.isArray(item))
        if (!valid || JSON.stringify(value).length > 150000) return json({ error: '設定データが不正です' }, 400)
        const encoded = JSON.stringify(value)
        if (m === 'POST') {
          // Import legacy browser data only once, never overwrite D1 records.
          await db.prepare('INSERT OR IGNORE INTO finance_settings(name,value) VALUES(?1,?2)').bind(b,encoded).run()
        } else {
          await db.prepare('INSERT INTO finance_settings(name,value) VALUES(?1,?2) ON CONFLICT(name) DO UPDATE SET value=excluded.value').bind(b,encoded).run()
        }
        return json({ ok: true })
      }
    }
    if (a === 'payment-sources' || a === 'merchant-payment-rules') {
      await db.prepare("CREATE TABLE IF NOT EXISTS payment_sources (name TEXT PRIMARY KEY, sort_order INTEGER NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)))").run()
      await db.prepare("CREATE TABLE IF NOT EXISTS merchant_payment_rules (keyword TEXT PRIMARY KEY, payment_source TEXT NOT NULL)").run()
    }
    if (a === 'payment-sources' && !b && m === 'GET') {
      const { results } = await db.prepare('SELECT name, is_default FROM payment_sources ORDER BY sort_order, name').all()
      return json(results)
    }
    if (a === 'payment-sources' && b === 'initialize' && m === 'POST') {
      const body = await request.json()
      const names = Array.isArray(body?.names) ? [...new Set(body.names.filter(x => typeof x === 'string').map(x => x.trim()))] : []
      if (names.length > 100 || names.some(x => !x || x.length > 80)) return json({ error: 'カード名を確認してください' }, 400)
      const existing = await db.prepare('SELECT COUNT(*) AS n FROM payment_sources').first()
      if (!existing?.n) {
        const items = ['現金', ...names.filter(x => x !== '現金')]
        for (let i = 0; i < items.length; i++) await db.prepare('INSERT OR IGNORE INTO payment_sources(name,sort_order) VALUES(?1,?2)').bind(items[i],i).run()
      }
      return json({ ok: true })
    }
    if (a === 'payment-sources' && !b && m === 'POST') {
      const body = await request.json()
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > 80) return json({ error: 'カード名を確認してください' }, 400)
      await db.prepare('INSERT OR IGNORE INTO payment_sources(name,sort_order) VALUES(?1,(SELECT COALESCE(MAX(sort_order),0)+1 FROM payment_sources))').bind(name).run()
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
      await db.prepare('DELETE FROM merchant_payment_rules WHERE payment_source=?1').bind(name).run()
      await db.prepare('DELETE FROM payment_sources WHERE name=?1').bind(name).run()
      return json({ ok: true })
    }
    if (a === 'merchant-payment-rules' && m === 'GET') {
      const { results } = await db.prepare('SELECT keyword, payment_source FROM merchant_payment_rules ORDER BY LENGTH(keyword) DESC').all()
      return json(results)
    }
    if (a === 'merchant-payment-rules' && m === 'POST') {
      const body = await request.json()
      const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : ''
      const name = typeof body?.paymentSource === 'string' ? body.paymentSource.trim() : ''
      if (keyword.length < 2 || keyword.length > 80 || !name || name.length > 80) return json({ error: '店舗と支払方法を確認してください' }, 400)
      if (!(await db.prepare('SELECT name FROM payment_sources WHERE name=?1').bind(name).first())) return json({ error: '登録済みの支払方法を選択してください' }, 400)
      await db.prepare('INSERT INTO merchant_payment_rules(keyword,payment_source) VALUES(?1,?2) ON CONFLICT(keyword) DO UPDATE SET payment_source=excluded.payment_source').bind(keyword,name).run()
      return json({ ok: true })
    }
    if (a === 'merchant-payment-rules' && m === 'DELETE') {
      const keyword = url.searchParams.get('keyword') || ''
      if (!keyword || keyword.length > 80) return json({ error: '店舗名を確認してください' }, 400)
      await db.prepare('DELETE FROM merchant_payment_rules WHERE keyword=?1').bind(keyword).run()
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
      await db.prepare('UPDATE payment_sources SET name=?1 WHERE name=?2').bind(newName,oldName).run()
      await db.prepare('UPDATE merchant_payment_rules SET payment_source=?1 WHERE payment_source=?2').bind(newName,oldName).run()
      const result = await db.prepare('UPDATE entries SET payment_source = ?1 WHERE payment_source = ?2').bind(newName, oldName).run()
      return json({ ok: true, changes: result.meta?.changes ?? 0 })
    }
    if (a === 'entries') {
      if (m === 'GET') {
        if ((entriesYear && !/^\d{4}$/.test(entriesYear)) ||
            (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) ||
            (!entriesYear && !month)) return json({ error: '対象期間が正しくありません' }, 400)
        const datePrefix = entriesYear || month
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
        if (!validDate(e.date) || !Number.isSafeInteger(Number(e.amount)) || !Number.isSafeInteger(amount) || amount <= 0)
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
        const inserted = await db.prepare(
          'INSERT INTO entries (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13) ON CONFLICT(client_request_id) DO NOTHING'
        ).bind(e.date, e.time || '', amount, transfer ? '投資・資産移動' : (e.category || (e.type === 'income' ? '工资' : '日用品')), e.merchant || '', e.note || '', (e.raw || '').slice(0, 2000), transfer ? 'transfer' : (e.type === 'income' ? 'income' : 'expense'), target, applied, transferDate, clientRequestId, paymentSource).run()
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
        if (!Number.isSafeInteger(id) || id <= 0 || !validDate(e.date) || !Number.isSafeInteger(amount) || amount <= 0)
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
    if (a === 'category-icons' && m === 'GET') {
      await db.prepare('CREATE TABLE IF NOT EXISTS category_icons (category TEXT PRIMARY KEY, icon TEXT NOT NULL)').run()
      const { results } = await db.prepare('SELECT category, icon FROM category_icons').all()
      return json(Object.fromEntries(results.map(r => [r.category, r.icon])))
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
        if (name.length < 1) return json({ error: 'カテゴリー名を入力してください' }, 400)
        const reserved = ['餐饮','饮食料品','日用品','交通','购物','居住','医疗','娱乐','宠物','其他']
        const icon = String(body.icon || 'other')
        const validIcons = ['food','dining','daily','transport','shopping','home','medical','pet','beauty','education','insurance','utilities','phone','tax','travel','subscriptions','gift','electricity','water','gas','rent','internet','hair','cosmetics','clothes','shoes','books','lessons','childcare','family','car','bicycle','fuel','parking','fitness','health','medicine','dental','cafe','hobby','music','movie','electronics','furniture','repair','charity','bank','savings','fees','delivery','cleaning','events','work','phone-device','other']
        if (!validIcons.includes(icon)) return json({ error: 'アイコンを確認してください' }, 400)
        if (reserved.includes(name)) return json({ error: '同じカテゴリが既にあります' }, 409)
        const existing = await db.prepare('SELECT keyword FROM rules WHERE keyword = ?1').bind('__category__:' + name).first()
        if (existing) return json({ error: '同じカテゴリが既にあります' }, 409)
        await db.prepare('CREATE TABLE IF NOT EXISTS category_icons (category TEXT PRIMARY KEY, icon TEXT NOT NULL)').run()
        // Keep the category and its icon together if a database write fails.
        await db.batch([
          db.prepare('INSERT OR IGNORE INTO rules (keyword, category) VALUES (?1, ?2)').bind('__category__:' + name, name),
          db.prepare('INSERT OR IGNORE INTO category_icons (category, icon) VALUES (?1, ?2)').bind(name, icon)
        ])
        return json({ ok: true, category: name })
      }
    }
    if (a === 'custom-rules') {
      await db.prepare('CREATE TABLE IF NOT EXISTS custom_rules (keyword TEXT PRIMARY KEY, category TEXT NOT NULL)').run()
      if (m === 'GET') {
        const { results } = await db.prepare('SELECT keyword, category FROM custom_rules ORDER BY keyword').all()
        return json(results)
      }
      if (m === 'DELETE') {
        const keyword = url.searchParams.get('keyword') || ''
        if (keyword.length < 2 || keyword.length > 80) return json({ error: '店舗名を確認してください' }, 400)
        await db.prepare('DELETE FROM custom_rules WHERE keyword=?1').bind(keyword).run()
        return json({ ok: true })
      }
    }
    if (a === 'rules') {
      if (m === 'GET') {
        // デフォルトルールとユーザー上書きルールを分離し、初期化や再デプロイで個人設定を消さない。
        await db.prepare('CREATE TABLE IF NOT EXISTS custom_rules (keyword TEXT PRIMARY KEY, category TEXT NOT NULL)').run()
        const marker = '__kakeibo_japanese_rules_v9_initialized__'
        const seeded = await db.prepare('SELECT keyword FROM rules WHERE keyword = ?1').bind(marker).first()
        if (!seeded) {
          // 旧ルールでは既定と個人設定を区別できないため、既定外のキーワードと変更済みの分類を保持する。
          const defaultCategories = new Map(LEGACY_DEFAULT_RULE_ROWS.map(([keyword, category]) => [keyword, category]))
          const legacy = await db.prepare("SELECT keyword, category FROM rules WHERE substr(keyword, 1, 13) != '__category__:'").all()
          for (const rule of (legacy.results || []).filter(rule =>
            !defaultCategories.has(rule.keyword) || defaultCategories.get(rule.keyword) !== rule.category
          )) {
            await db.prepare('INSERT OR IGNORE INTO custom_rules (keyword, category) VALUES (?1, ?2)').bind(rule.keyword, rule.category).run()
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
          const legacyDefaults = new Map(LEGACY_DEFAULT_RULE_ROWS)
          // A few multi-row SQL statements rather than hundreds of D1 queries.
          // All values remain parameter-bound; INSERT OR IGNORE never overwrites data.
          const allDefaults = DEFAULT_RULE_ROWS
          for (let i = 0; i < allDefaults.length; i += 25) {
            const chunk = allDefaults.slice(i, i + 25)
            const placeholders = chunk.map(() => '(?, ?)').join(', ')
            await db.prepare('INSERT OR IGNORE INTO rules (keyword, category) VALUES ' + placeholders)
              .bind(...chunk.flat()).run()
          }
          const corrections = DEFAULT_RULE_ROWS.flatMap(([keyword, category]) => {
            const oldCategory = legacyDefaults.get(keyword)
            return oldCategory && oldCategory !== category
              ? [db.prepare('UPDATE rules SET category = ?1 WHERE keyword = ?2 AND category = ?3').bind(category, keyword, oldCategory)]
              : []
          })
          for (let i = 0; i < corrections.length; i += 40) await db.batch(corrections.slice(i, i + 40))
          // Mark completion last so a partial migration can be retried safely.
          await db.prepare('INSERT OR IGNORE INTO rules (keyword, category) VALUES (?1, ?2)').bind(v10Marker, '其他').run()
        }
        const [baseResult, customResult] = await Promise.all([
          db.prepare("SELECT * FROM rules WHERE keyword NOT IN (?1, ?2) AND substr(keyword, 1, 13) != ?3").bind(marker, v10Marker, '__category__:').all(),
          db.prepare('SELECT keyword, category FROM custom_rules').all()
        ])
        const merged = new Map((baseResult.results || []).map(rule => [rule.keyword, rule]))
        for (const rule of (customResult.results || [])) merged.set(rule.keyword, { ...rule, is_custom: true })
        return json([...merged.values()].map(rule => ({ ...rule, is_custom: rule.is_custom === true })))
      }
      if (m === 'POST') {
        const r = await request.json()
        const kw = String(r.keyword || '').trim()
        const category = String(r.category || '').trim()
        if (kw.length < 2) return json({ error: 'キーワードは2文字以上で入力してください' }, 400)
        if (!category) return json({ error: 'カテゴリーを指定してください' }, 400)
        await db.prepare('CREATE TABLE IF NOT EXISTS custom_rules (keyword TEXT PRIMARY KEY, category TEXT NOT NULL)').run()
        await db.prepare('INSERT INTO custom_rules (keyword,category) VALUES (?1,?2) ON CONFLICT(keyword) DO UPDATE SET category = excluded.category').bind(kw, category).run()
        return json({ ok: true, keyword: kw, category })
      }
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
        const paymentRows = await db.prepare("SELECT CASE WHEN TRIM(COALESCE(payment_source,'')) = '' OR payment_source = '現金' THEN '現金' ELSE 'カード・電子決済' END method, COUNT(*) count, SUM(amount) amount FROM entries WHERE date LIKE ?1 AND type = 'expense' GROUP BY method ORDER BY amount DESC").bind(like).all()
        return json({ paymentMethods: paymentRows.results, year: Number(year), total: total.t, count: total.n, income: total.income, transferTotal: total.transferTotal, transferCount: total.transferCount, byCategory: cat.results, byMonth: monthRows.results, incomeByMonth: incomeMonthRows.results, incomeByCategory: incomeCategoryRows.results, incomeByMonthCategory: incomeMonthCategoryRows.results })
      }
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
