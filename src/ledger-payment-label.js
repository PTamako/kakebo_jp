// A ledger row may have a payment source redacted by the shared household API.
// Show only the current viewer's authorized label. A verified member-approved
// cash entry has an empty card source by design; old unspecified rows do not.
export function ledgerPaymentLabel(entry) {
 if (!entry || entry.type !== 'expense') return '';
 const authorizedDisplay=typeof entry.payment_source_display==='string'
  ? entry.payment_source_display.trim() : '';
 const source=typeof entry.payment_source==='string'?entry.payment_source.trim():'';
 if (authorizedDisplay && authorizedDisplay !== source) return authorizedDisplay;
 if (source) return source;
 if (authorizedDisplay) return authorizedDisplay;
 const newMemberCash=entry.pending_approval===true&&
  entry.pending_operation==='create';
 const approvedMemberCash=typeof entry.shared_entry_requester_user_id==='string'&&
  entry.shared_entry_requester_user_id.length>0;
 return newMemberCash||approvedMemberCash?'現金':'';
}
