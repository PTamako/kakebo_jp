CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,            -- YYYY-MM-DD
  time TEXT NOT NULL DEFAULT '', -- HH:MM，可为空
  amount INTEGER NOT NULL,       -- 日元，整数
  category TEXT NOT NULL DEFAULT '其他',
  merchant TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  raw TEXT NOT NULL DEFAULT '',  -- 识别前的原文
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);

CREATE TABLE IF NOT EXISTS rules (
  keyword TEXT PRIMARY KEY,
  category TEXT NOT NULL
);

INSERT OR IGNORE INTO rules (keyword, category) VALUES
('ローソン','餐饮'),('セブン','餐饮'),('ファミリーマート','餐饮'),('ファミマ','餐饮'),
('マクドナルド','餐饮'),('スターバックス','餐饮'),('すき家','餐饮'),('吉野家','餐饮'),
('午饭','餐饮'),('晚饭','餐饮'),('早饭','餐饮'),('咖啡','餐饮'),('ランチ','餐饮'),
('JR','交通'),('Suica','交通'),('PASMO','交通'),('メトロ','交通'),('バス','交通'),('タクシー','交通'),('打车','交通'),('地铁','交通'),
('ドラッグ','日用品'),('マツモトキヨシ','日用品'),('ダイソー','日用品'),('ニトリ','日用品'),('スーパー','日用品'),('イオン','日用品'),
('Amazon','购物'),('アマゾン','购物'),('ユニクロ','购物'),('楽天','购物'),
('家賃','居住'),('房租','居住'),('電気','居住'),('ガス','居住'),('水道','居住'),('水电','居住'),
('病院','医疗'),('薬局','医疗'),('クリニック','医疗'),
('映画','娱乐'),('カラオケ','娱乐'),('Netflix','娱乐');
