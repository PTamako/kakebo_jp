// One-off owner-requested replay of a *deleted* posted household expense.
// A replay row has a fresh proposal/approval ID, but can reference the original
// AES-GCM ciphertext without ever exposing the encryption key to an operator.
// The source journal stays immutable and the original record must be deleted.
// Ordinary app-generated intents are unchanged and never use this marker.
const marker=/^sealed-ref:([a-f0-9]{32})$/i;
export async function resolveSharedMutationSealedReference(db,proposal){
 if(!proposal||typeof proposal.payload_cipher!=='string')return null;
 const link=marker.exec(proposal.payload_cipher);
 if(!link)return proposal;
 if(proposal.payload_iv!=='sealed-ref'||proposal.operation!=='create'||
  proposal.resource_id!==null||proposal.expected_version!==0||
  proposal.status!=='submitted'||link[1]===proposal.proposal_id)return null;
 const source=await db.prepare('SELECT * FROM family_shared_mutation_intents WHERE proposal_id=?')
  .bind(link[1]).first();
 if(!source||source.proposal_id===proposal.proposal_id||
  source.operation!=='create'||source.resource_id!==null||
  source.expected_version!==0||source.status!=='submitted'||
  !source.payload_cipher||source.payload_cipher.startsWith('sealed-ref:')||
  source.household_id!==proposal.household_id||
  source.requester_user_id!==proposal.requester_user_id||
  source.payload_sha256!==proposal.payload_sha256||
  source.created_at>=proposal.created_at)return null;
 const original=await db.prepare('SELECT resource_id,entry_id FROM family_shared_mutation_applied '+
  'WHERE proposal_id=? AND action=? AND household_id=? AND requester_user_id=? '+
  'AND payload_sha256=? LIMIT 1')
  .bind(source.proposal_id,'create',source.household_id,source.requester_user_id,
   source.payload_sha256).first();
 if(!original)return null;
 const ledger=await db.prepare('SELECT state FROM family_shared_entry_registry '+
  'WHERE resource_id=? AND household_id=? AND entry_id=? LIMIT 1')
  .bind(original.resource_id,source.household_id,original.entry_id).first();
 if(ledger?.state!=='deleted')return null;
 const physical=await db.prepare('SELECT 1 AS present FROM entries WHERE id=? LIMIT 1')
  .bind(original.entry_id).first();
 if(physical)return null;
 return {...proposal,proposal_id:source.proposal_id,
  payload_cipher:source.payload_cipher,payload_iv:source.payload_iv};
}
