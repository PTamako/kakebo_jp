// The member sees one payment selector; never expose another person's accounts.
export function memberPaymentChoices(accounts = [], grants = []) {
 const choices = [{ value: 'cash', label: '現金' }];
 const seen = new Set(['cash']);
 for (const a of accounts) {
  if (!a || a.is_archived || a.origin !== 'member_created' ||
    !['credit_card', 'prepaid'].includes(a.account_kind) ||
    typeof a.account_id !== 'string' || !a.account_id ||
    typeof a.label !== 'string' || !a.label.trim()) continue;
  const value = 'personal:' + a.account_id;
  if (!seen.has(value)) { choices.push({ value, label: a.label }); seen.add(value); }
 }
 for (const c of grants) {
  if (!c || typeof c.card_name !== 'string' || !c.card_name.trim()) continue;
  const value = 'shared:' + c.card_name;
  if (!seen.has(value)) {
   const owner = typeof c.owner_display_name === 'string' && c.owner_display_name.trim()
    ? c.owner_display_name.trim() : '家族';
   choices.push({ value, label: c.card_name + '（' + owner + '）' });
   seen.add(value);
  }
 }
 return choices;
}
export function resolveMemberPayment(choice, accounts = [], grants = []) {
 if (choice === 'cash') return { kind: 'cash' };
 if (typeof choice !== 'string') return null;
 if (choice.startsWith('personal:')) {
  const account = accounts.find(a => a?.account_id === choice.slice(9) &&
   a?.is_archived !== 1 && a?.is_archived !== true &&
   a?.origin === 'member_created' && ['credit_card', 'prepaid'].includes(a?.account_kind));
  return account ? { kind: 'personal', account } : null;
 }
 if (choice.startsWith('shared:')) {
  const card = grants.find(c => c?.card_name === choice.slice(7));
  return card ? { kind: 'shared', card } : null;
 }
 return null;
}
