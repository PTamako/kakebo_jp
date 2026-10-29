// SBI bookkeeping only; NEVER sends bank transfers or securities orders.
// D1 stores explicit holdings and a monthly funding-to-plan reconciliation.
const respond=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});
const codeOk=value=>typeof value==='string' && /^[A-Z0-9]{8}$/.test(value);
const monthOk=value=>typeof value==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const dayOk=value=>typeof value==='string' && /^\d{4}-(0[1-9]|[12]\d|3[01])$/.test(value) && !Number.isNaN(Date.parse(value));
const accountOk=value=>value==='growth'||value==='tsumitate';
const yenOk=value=>Number.isSafeInteger(value) && value>=0;
const nextMonth=month=>{
  const [y,m]=month.split('-').map(Number);
  const d=new Date(Date.UTC(y,m,1));
  return d.toISOString().slice(0,7);
};
export function inferredPurchaseMonth(date,orderDay=9) {
  const day=Number(String(date||'').slice(8,10));
  const month=String(date||'').slice(0,7);
  return monthOk(month) ? (day>orderDay?nextMonth(month):month) : '';
}
export function fundingStatus(transfers,month,orderDay=9) {
  return transfers.reduce((total,item)=>{
    if(Number(item.transfer_applied)!==1)return total;
    const effective=String(item.transfer_date||item.date);
    const target=item.purchase_month||inferredPurchaseMonth(effective,orderDay);
    if(target===month)total.funded+=Number(item.amount);
    if(target===month)total.count++;
    return total;
  },{funded:0,count:0});
}
const initialPlans=[
  ['0331418A','tsumitate','eMAXIS Slim 全世界株式（オール・カントリー）',7000,9],
  ['03311187','tsumitate','eMAXIS Slim 米国株式（S&P500）',3000,9],
  ['0331A172','growth','eMAXIS Slim 先進国債券インデックス（除く日本）',3000,9],
  ['04317188','tsumitate','iFreeNEXT NASDAQ100インデックス',2000,9]
];
export async function handlePortfolio({db,request,method,sub,url}) {
  try{
    if(method==='GET'&&!sub){
      const month=url.searchParams.get('month')||new Date(Date.now()+9*3600000).toISOString().slice(0,7);
      if(!monthOk(month))return respond({error:'対象月を確認してください'},400);
      const [{results:plans},{results:holdings},{results:transfers}]=await Promise.all([
        db.prepare(`SELECT p.fund_code,p.account_type,p.fund_name,p.monthly_amount,p.order_day,p.enabled,p.effective_month,p.updated_at
        FROM investment_plan_history p WHERE p.effective_month<=?1
        AND p.effective_month=(SELECT MAX(h.effective_month) FROM investment_plan_history h
          WHERE h.fund_code=p.fund_code AND h.account_type=p.account_type AND h.effective_month<=?1)
        ORDER BY p.monthly_amount DESC,p.fund_code,p.account_type`).bind(month).all(),
        db.prepare('SELECT h.fund_code,h.account_type,h.fund_name,h.units,h.acquisition_cost,h.updated_at,p.nav_per_10000,p.price_date,p.source FROM investment_holdings h LEFT JOIN fund_prices p ON p.fund_code=h.fund_code ORDER BY h.fund_code,h.account_type').all(),
        db.prepare("SELECT e.id,e.date,e.transfer_date,e.amount,e.transfer_applied,l.purchase_month FROM entries e LEFT JOIN sbi_transfer_links l ON l.entry_id=e.id WHERE e.type='transfer' AND e.transfer_target='sbi' ORDER BY e.id DESC LIMIT 1000").all()
      ]);
      const active=plans.filter(p=>p.enabled===1);
      const monthlyAmount=active.reduce((sum,p)=>sum+Number(p.monthly_amount),0);
      const day=active.length?Math.min(...active.map(p=>p.order_day)):9;
      const normalizedTransfers=transfers.map(t=>({
        ...t, effective_month:t.purchase_month||inferredPurchaseMonth(t.transfer_date||t.date,day),
        inferred:!t.purchase_month
      }));
      const status=fundingStatus(normalizedTransfers,month,day);
      const scheduled=normalizedTransfers.filter(t=>t.effective_month===month&&Number(t.transfer_applied)!==1).reduce((n,t)=>n+Number(t.amount),0);
      const relevant=normalizedTransfers.filter(t=>t.effective_month===month||t.purchase_month===month).slice(0,20);
      const positions=holdings.map(h=>{
        const nav=h.nav_per_10000==null?null:Number(h.nav_per_10000);
        const marketValue=nav==null?null:Math.round(Number(h.units)*nav/10000);
        return {...h,market_value:marketValue,pnl:marketValue==null?null:marketValue-Number(h.acquisition_cost)};
      });
      const valued=positions.filter(p=>p.market_value!=null);
      return respond({
        month,plans,holdings:positions,transfers:relevant,
        reconciliation:{monthly_amount:monthlyAmount,funded:status.funded,pending:scheduled,
          difference:status.funded-monthlyAmount,linked_count:status.count},
        valuation:{valued_count:valued.length,holdings_count:positions.length,
          value:valued.length===positions.length&&positions.length?valued.reduce((n,p)=>n+p.market_value,0):null,
          pnl:valued.length===positions.length&&positions.length?valued.reduce((n,p)=>n+p.pnl,0):null},
        note:'資産移動の到期処理は帳簿上の反映であり、SBI口座への着金や約定を保証しません。自動紐付け月は推定です。'
      });
    }
    if(sub==='initialize'&&method==='POST'){
      const existing=await db.prepare('SELECT COUNT(*) AS n FROM investment_plan_history').first();
      if(existing?.n)return respond({ok:true,created:false});
      const now=new Date().toISOString();
      const month=new Date(Date.now()+9*3600000).toISOString().slice(0,7);
      await db.batch(initialPlans.flatMap(([code,account,name,amount,day])=>[
        db.prepare('INSERT OR IGNORE INTO investment_plans(fund_code,account_type,fund_name,monthly_amount,order_day,enabled,updated_at) VALUES(?1,?2,?3,?4,?5,1,?6)')
          .bind(code,account,name,amount,day,now),
        db.prepare('INSERT OR IGNORE INTO investment_plan_history(fund_code,account_type,effective_month,fund_name,monthly_amount,order_day,enabled,updated_at) VALUES(?1,?2,?3,?4,?5,?6,1,?7)')
          .bind(code,account,month,name,amount,day,now)
      ]));
      return respond({ok:true,created:true});
    }
    if(sub==='plan'&&method==='PUT'){
      const x=await request.json();
      if(!codeOk(x.fundCode)||!accountOk(x.accountType)||typeof x.fundName!=='string'||
        !x.fundName.trim()||x.fundName.length>120||!yenOk(x.monthlyAmount)||
        !Number.isSafeInteger(x.orderDay)||x.orderDay<1||x.orderDay>28||
        typeof x.enabled!=='boolean'||x.monthlyAmount>100000000||!monthOk(x.effectiveMonth))
        return respond({error:'積立設定を確認してください'},400);
      await db.prepare(`INSERT INTO investment_plans
        (fund_code,account_type,fund_name,monthly_amount,order_day,enabled,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7)
        ON CONFLICT(fund_code,account_type) DO UPDATE SET
          fund_name=excluded.fund_name,monthly_amount=excluded.monthly_amount,
          order_day=excluded.order_day,enabled=excluded.enabled,updated_at=excluded.updated_at`)
        .bind(x.fundCode,x.accountType,x.fundName.trim(),x.monthlyAmount,x.orderDay,x.enabled?1:0,new Date().toISOString()).run();
      await db.prepare(`INSERT INTO investment_plan_history
        (fund_code,account_type,effective_month,fund_name,monthly_amount,order_day,enabled,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
        ON CONFLICT(fund_code,account_type,effective_month) DO UPDATE SET
          fund_name=excluded.fund_name,monthly_amount=excluded.monthly_amount,
          order_day=excluded.order_day,enabled=excluded.enabled,updated_at=excluded.updated_at`)
        .bind(x.fundCode,x.accountType,x.effectiveMonth,x.fundName.trim(),x.monthlyAmount,x.orderDay,x.enabled?1:0,new Date().toISOString()).run();
      return respond({ok:true});
    }
    if(sub==='holding'&&method==='PUT'){
      const x=await request.json();
      if(!codeOk(x.fundCode)||!accountOk(x.accountType)||typeof x.fundName!=='string'||
        !x.fundName.trim()||x.fundName.length>120||!yenOk(x.units)||!yenOk(x.acquisitionCost)||
        x.units>1000000000000||x.acquisitionCost>1000000000000)
        return respond({error:'保有口数と取得金額を確認してください'},400);
      await db.prepare(`INSERT INTO investment_holdings
        (fund_code,account_type,fund_name,units,acquisition_cost,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6)
        ON CONFLICT(fund_code,account_type) DO UPDATE SET
          fund_name=excluded.fund_name,units=excluded.units,
          acquisition_cost=excluded.acquisition_cost,updated_at=excluded.updated_at`)
        .bind(x.fundCode,x.accountType,x.fundName.trim(),x.units,x.acquisitionCost,new Date().toISOString()).run();
      return respond({ok:true});
    }
    if(sub==='price'&&method==='PUT'){
      const x=await request.json();
      if(!codeOk(x.fundCode)||!yenOk(x.navPer10000)||x.navPer10000<1||
        x.navPer10000>1000000000||!dayOk(x.priceDate))
        return respond({error:'基準価額と基準日を確認してください'},400);
      await db.prepare(`INSERT INTO fund_prices(fund_code,nav_per_10000,price_date,source,updated_at)
        VALUES(?1,?2,?3,'manual',?4)
        ON CONFLICT(fund_code) DO UPDATE SET
          nav_per_10000=excluded.nav_per_10000,price_date=excluded.price_date,
          source='manual',updated_at=excluded.updated_at`)
        .bind(x.fundCode,x.navPer10000,x.priceDate,new Date().toISOString()).run();
      return respond({ok:true});
    }
    if(sub==='transfer-month'&&method==='PUT'){
      const x=await request.json();
      if(!Number.isSafeInteger(x.entryId)||x.entryId<=0||!monthOk(x.purchaseMonth))
        return respond({error:'振替記録と買付月を確認してください'},400);
      const entry=await db.prepare("SELECT id FROM entries WHERE id=?1 AND type='transfer' AND transfer_target='sbi'").bind(x.entryId).first();
      if(!entry)return respond({error:'SBIへの資産移動が見つかりません'},404);
      await db.prepare(`INSERT INTO sbi_transfer_links(entry_id,purchase_month,updated_at)
        VALUES(?1,?2,?3)
        ON CONFLICT(entry_id) DO UPDATE SET purchase_month=excluded.purchase_month,updated_at=excluded.updated_at`)
        .bind(x.entryId,x.purchaseMonth,new Date().toISOString()).run();
      return respond({ok:true});
    }
    return respond({error:'未対応の操作です'},405);
  }catch(err){
    if(/no such table: (investment_plans|investment_plan_history|investment_holdings|fund_prices|sbi_transfer_links)/i.test(String(err)))
      return respond({error:'投資テーブルの移行が未実施です',code:'portfolio_migration_required'},503);
    console.error('SBIポートフォリオAPI',err);
    return respond({error:'投資情報を読み込めませんでした'},500);
  }
}
