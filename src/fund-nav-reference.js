// Verified references for NAV checking; never invent an individual fund page.
// Automatic NAV eligibility is checked by /api/investment-portfolio/nav-eligibility
// BEFORE suggesting these references as a manual fallback.
import { MANUAL_NAV_REFERENCE_URLS } from './fund-nav-coverage.js'

const companyCatalogues = [
  { pattern:/^(?:eMAXIS|ＭＡＸＩＳ|MAXIS)/i, name:'三菱UFJアセットマネジメント', site:'https://www.am.mufg.jp/', domain:'am.mufg.jp' },
  { pattern:/^(?:iFree|ｉＦｒｅｅ|ダイワ・|ダイワ－)/i, name:'大和アセットマネジメント', site:'https://www.daiwa-am.co.jp/funds/', domain:'daiwa-am.co.jp' },
  { pattern:/^(?:ニッセイ|＜購入・換金手数料なし＞ニッセイ)/, name:'ニッセイアセットマネジメント', site:'https://www.nam.co.jp/fundinfo/list/index.html', domain:'nam.co.jp' },
  { pattern:/^(?:楽天・|楽天・プラス|楽天インデックス|楽天・インデックス)/, name:'楽天投信投資顧問', site:'https://www.rakuten-toushin.co.jp/fund/nav/', domain:'rakuten-toushin.co.jp' },
  { pattern:/^(?:たわらノーロード|たわら|One|Ｏｎｅ)/, name:'アセットマネジメントOne', site:'https://www.am-one.co.jp/fund/fundlist/', domain:'am-one.co.jp' },
  { pattern:/^(?:野村|NEXT FUNDS|ＮＥＸＴ ＦＵＮＤＳ)/, name:'野村アセットマネジメント', site:'https://www.nomura-am.co.jp/lineup/price/', domain:'nomura-am.co.jp' },
  { pattern:/^(?:三井住友ＤＳ|三井住友DS|SMAM|ＳＭＡＭ|ＳＭＤＡＭ)/i, name:'三井住友DSアセットマネジメント', site:'https://www.smd-am.co.jp/fund/info/', domain:'smd-am.co.jp' },
  { pattern:/^(?:SBI・|ＳＢＩ・|SBI アセット|ＳＢＩアセット)/i, name:'SBIアセットマネジメント', site:'https://www.sbiam.co.jp/', domain:'sbiam.co.jp' }
]
const validCode = code => /^[A-Z0-9]{8}$/.test(String(code||'').trim().toUpperCase())
const searchUrl = (query) => 'https://www.google.com/search?q='+encodeURIComponent(query)

/**
 * Links are informational references, not statements that the provider API
 * supports the fund. Return at most two compact links for a mobile-first UI.
 * An exact official fund detail is used only for verified identifiers.
 * A manager's NAV list is not presented as a verified per-fund detail page.
 */
export function fundNavReferences(code,name='') {
  const normalized=String(code||'').trim().toUpperCase()
  if(!validCode(normalized))return []
  const fundName=String(name||'').trim().slice(0,120)
  const known=MANUAL_NAV_REFERENCE_URLS[normalized]
  const manager=companyCatalogues.find(c=>c.pattern.test(fundName))
  const references=[]
  if(known) {
    references.push({label:'運用会社の公式ページ',url:known,kind:'verified'})
  } else if(manager){
    references.push({label:'運用会社の基準価額一覧',url:manager.site,kind:'catalogue'})
  }
  // This is an official securities-broker quote-history lookup. A link may
  // return "not found" if the fund is not offered by this particular broker.
  references.push({label:'SBI証券で照会',url:'https://site0.sbisec.co.jp/marble/fund/history/standardprice.do?fund_sec_code='+normalized,kind:'broker'})
  if(!known) {
    const q=manager
      ? 'site:'+manager.domain+' '+(fundName||normalized)+' '+normalized+' 基準価額'
      : (fundName ? fundName+' ' : '')+normalized+' 運用会社 公式 基準価額'
    // The search is clearly labeled as search, never passed off as an
    // automatically verified official manager page.
    if(!manager) references.push({label:'運用会社の公式ページを検索',url:searchUrl(q),kind:'search'})
  }
  return references.slice(0,2)
}
