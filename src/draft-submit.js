// Ledger writes are safe to retry only if the same client-request ID survives
// a browser restart. Keep this durability barrier independent of the API call.
export async function persistFinancialDraftBeforePost({hydrated,snapshot,persist}) {
  if (!hydrated) throw new Error('下書きの読み込みが完了していません。再度お試しください')
  if (!snapshot || snapshot.deleted || !Array.isArray(snapshot.forms) ||
      !snapshot.forms.length || typeof snapshot.forms[0].clientRequestId !== 'string' ||
      !snapshot.forms[0].clientRequestId.trim()) {
    throw new Error('再送防止IDを確認できないため、保存を中止しました')
  }
  // Reject, rather than continue, when the local draft cannot be written.
  // This does not change or delete any cloud draft or existing ledger entry.
  try { await persist(snapshot) }
  catch(error) {
    throw new Error('再送防止情報を端末へ保存できなかったため、記帳を中止しました：'+(error?.message||error))
  }
  return snapshot
}
