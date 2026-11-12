// Used by both the entry API and the mobile import pipeline. Never classify
// generic purchases or card reward *earnings* as an SBI buy.
const normalize = value => String(value||'').normalize('NFKC').toLowerCase()
  .replace(/[\s　()（）・:_-]/g,'');

export function isSbiPointInvestmentText(value){
  const text=normalize(value);
  return /(?:sbi証券|sbi证券|sbi)/.test(text) &&
    /(?:ポイント|积分|vpoint)/.test(text) &&
    /(?:投資|投资|買付|购买|購買)/.test(text) &&
    !/(?:ポイント獲得|积分获得|付与|ポイント還元)/.test(text);
}

// Returns '' for unrelated text. When a statement says SBI + 投信,
// the ONLY automatic recurring signal is an explicit 積立 keyword.
// An explicit user-confirmed purpose takes priority over this heuristic.
export function inferSbiInvestmentKind(value){
  const text=normalize(value);
  if(!text || /(?:払戻|返金|キャンセル|取消|配当|手数料)/.test(text))return '';
  if(/(?:ポイント獲得|积分获得|付与|ポイント還元)/.test(text))return '';
  if(isSbiPointInvestmentText(text))return 'point';
  const hasBroker=/(?:sbi証券|sbi证券|sbi)/.test(text);
  const hasFund=/(?:投信|投資信託|投资信托)/.test(text);
  // Some bank statements omit "SBI" but use the distinctive brokerage debit.
  const distinctBrokerDebit=/(?:証券投信|投信積立サービス)/.test(text);
  if(!((hasBroker&&hasFund)||distinctBrokerDebit))return '';
  return /(?:積立|つみたて|积立)/.test(text)?'monthly':'purchase';
}

export function inferredSbiEntryKind(entry){
  // Merchant / memo belongs to this entry; a full receipt can contain
  // unrelated keywords, so raw OCR is a fallback only when these are empty.
  const label=[entry?.merchant,entry?.note].filter(Boolean).join(' ') ||
    String(entry?.raw||'');
  return inferSbiInvestmentKind(label);
}
