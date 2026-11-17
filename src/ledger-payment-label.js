// A ledger row may have a payment source redacted by the shared household API.
// Show only the current viewer's authorized label. A verified member-approved
// cash entry has an empty card source by design; old unspecified rows do not.
export function ledgerPaymentLabel(entry) {
 if (!entry || entry.type !== 'expense') return '';
 const authorizedDisplay=typeof entry.payment_source_display==='string'
  ? entry.payment_source_display.trim() : '';
 const source=typeof entry.payment_source==='string'?entry.payment_source.trim():'';
 // The shared-ledger approval path sometimes carries a legacy cash marker.
 // This is not a card grant and must never be shown as `shared:現金`.
 const cashLabels=new Set(['cash','現金','shared:cash','shared:現金']);
 if(cashLabels.has(authorizedDisplay)||cashLabels.has(source))return '現金';
 if (authorizedDisplay && authorizedDisplay !== source) return authorizedDisplay;
 if (source) return source;
 if (authorizedDisplay) return authorizedDisplay;
 const newMemberCash=entry.pending_approval===true&&
  entry.pending_operation==='create';
 const approvedMemberCash=typeof entry.shared_entry_requester_user_id==='string'&&
  entry.shared_entry_requester_user_id.length>0;
 return newMemberCash||approvedMemberCash?'現金':'';
}

/** Labels must survive redacted account IDs and missing personal choices. */
export function ledgerTransferTargetLabel(entry){
 const label=String(entry?.transfer_target_display||entry?.transfer_target||'').trim()
 if(!label)return '未設定'
 if(label==='spouse')return '配偶'
 if(label==='sbi')return 'SBI証券（投資信託）'
 if(label.startsWith('prepaid:'))return label.slice(8)||'個人口座'
 if(label.startsWith('credit:'))return label.slice(7)||'個人口座'
 if(label.startsWith('family:'))return '個人口座'
 return label
}
export function ledgerTransferSourceLabel(entry){
 const label=String(entry?.payment_source_display||entry?.payment_source||'').trim()
 return label.startsWith('family:')?'個人口座':label||'未設定'
}
