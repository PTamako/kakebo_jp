// Read-only provenance projection. Never infer a historical editor from an
// approval actor or a card owner. Older rows have an *assigned account owner*
// but no reliable per-entry creator event, so the UI labels them 旧記録.
export const ledgerRecorderColumns=[
 "CASE WHEN ls.actor_user_id IS NOT NULL THEN COALESCE(NULLIF(TRIM(shared_card_spender.display_name),''),'家庭成员')",
 " WHEN member_intent.requester_user_id IS NOT NULL THEN COALESCE(NULLIF(TRIM(requester.display_name),''),'家庭成员')",
 " WHEN sr.creator_user_id IS NOT NULL THEN COALESCE(NULLIF(TRIM(creator.display_name),''),'家庭成员')",
 " WHEN old.owner_user_id IS NOT NULL THEN COALESCE(NULLIF(TRIM(legacy_owner.display_name),''),'原管理员')",
 " ELSE NULL END AS recorded_by,",
 "CASE WHEN ls.actor_user_id IS NOT NULL THEN 'shared_card_spender'",
 " WHEN member_intent.requester_user_id IS NOT NULL THEN 'member_requester'",
 " WHEN sr.creator_user_id IS NOT NULL THEN 'creator'",
 " WHEN old.owner_user_id IS NOT NULL THEN 'legacy_assigned'",
 " ELSE NULL END AS recorder_basis"
].join(' ');

export const ledgerRecorderJoins=[
 "LEFT JOIN family_legacy_card_spends ls ON ls.entry_id=e.id",
 "LEFT JOIN homeflow_identity_links shared_card_spender ON shared_card_spender.user_id=ls.actor_user_id AND shared_card_spender.household_id=ls.household_id",
 "LEFT JOIN family_shared_entry_registry sr ON sr.entry_id=e.id AND sr.state='active'",
 "LEFT JOIN homeflow_identity_links creator ON creator.user_id=sr.creator_user_id AND creator.household_id=sr.household_id",
 "LEFT JOIN family_shared_mutation_applied member_intent ON member_intent.entry_id=e.id AND member_intent.action='create'",
 "LEFT JOIN homeflow_identity_links requester ON requester.user_id=member_intent.requester_user_id AND requester.household_id=member_intent.household_id",
 "LEFT JOIN family_legacy_owner_claims old ON old.record_scope='ledger' AND old.record_key=CAST(e.id AS TEXT)",
 "LEFT JOIN homeflow_identity_links legacy_owner ON legacy_owner.user_id=old.owner_user_id AND legacy_owner.household_id=old.household_id"
].join(' ');
