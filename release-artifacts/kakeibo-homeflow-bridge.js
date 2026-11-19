var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// functions/api/payment-source-validation.js
var unassigned = /* @__PURE__ */ new Set(["", "\u73FE\u91D1", "\u305D\u306E\u4ED6", "\u5176\u4ED6"]);
async function validateRegisteredPaymentSource(db, value, { allowArchived = false, currentSource = "" } = {}) {
  if (typeof value !== "string" || value.length > 80) {
    return { error: "\u652F\u6255\u65B9\u6CD5\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044", code: "payment_source_invalid", status: 400 };
  }
  const name = value.trim();
  if (unassigned.has(name)) return null;
  const row = await db.prepare("SELECT name,is_archived FROM payment_sources WHERE name=?1").bind(name).first();
  if (!row) return { error: "\u767B\u9332\u3055\u308C\u3066\u3044\u306A\u3044\u652F\u6255\u65B9\u6CD5\u3067\u3059\u3002\u30AB\u30FC\u30C9\u8A2D\u5B9A\u3092\u66F4\u65B0\u3057\u3066\u304F\u3060\u3055\u3044", code: "payment_source_missing", status: 400 };
  if (Number(row.is_archived) === 1 && !allowArchived && name !== currentSource)
    return { error: "\u30A2\u30FC\u30AB\u30A4\u30D6\u6E08\u307F\u306E\u652F\u6255\u65B9\u6CD5\u306F\u65B0\u3057\u3044\u8A18\u5E33\u306B\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093", code: "payment_source_archived", status: 409 };
  return null;
}
__name(validateRegisteredPaymentSource, "validateRegisteredPaymentSource");

// functions/api/ledger-input-validation.js
var TEXT_LIMITS = Object.freeze({
  category: 120,
  merchant: 500,
  note: 2e3,
  raw: 2e4
});
function validateLedgerTextFields(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    return { code: "invalid_entry", error: "\u660E\u7D30\u306E\u5F62\u5F0F\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093" };
  for (const [key2, max] of Object.entries(TEXT_LIMITS)) {
    const value = entry[key2];
    if (value == null) continue;
    if (typeof value !== "string" || value.length > max)
      return { code: "invalid_entry_text", error: "\u660E\u7D30\u306E\u6587\u5B57\u6570\u30FB\u5F62\u5F0F\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\uFF08" + key2 + "\uFF09" };
  }
  if (entry.type != null && !["expense", "income", "transfer"].includes(entry.type))
    return { code: "invalid_entry_type", error: "\u8A18\u5E33\u7A2E\u985E\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044" };
  for (const key2 of ["rewardDestination", "transferTarget"]) {
    if (entry[key2] != null && (typeof entry[key2] !== "string" || entry[key2].length > 100))
      return { code: "invalid_transfer_target", error: "\u632F\u66FF\u5148\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044" };
  }
  return null;
}
__name(validateLedgerTextFields, "validateLedgerTextFields");

// src/station-merchant.js
function isStationMerchant(value) {
  const merchant = String(value || "").normalize("NFKC").trim();
  return /(?:^|[\s、,・（(])[^\s、,・（）()¥￥]{1,32}駅(?=$|[（(]|[ \t\n]+(?:[¥￥]?\d|$))/u.test(merchant);
}
__name(isStationMerchant, "isStationMerchant");

// src/relative-entry-time.js
var toKatakana = /* @__PURE__ */ __name((value) => value.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 96)), "toKatakana");
var bothKanaSpellings = /* @__PURE__ */ __name((words) => Object.freeze([...new Set(
  [...words].flatMap((word) => [word, toKatakana(word)])
)].sort((a, b) => b.length - a.length)), "bothKanaSpellings");
var DAY_OFFSETS = /* @__PURE__ */ new Map([
  ["\u4ECA\u65E5", 0],
  ["\u672C\u65E5", 0],
  ["\u304D\u3087\u3046", 0],
  ["\u307B\u3093\u3058\u3064", 0],
  ["\u4ECA\u5929", 0],
  ["\u4ECA\u65E5\u4E2D", 0],
  ["\u660E\u65E5", -1],
  ["\u3042\u3057\u305F", -1],
  ["\u3042\u3059", -1],
  ["\u307F\u3087\u3046\u306B\u3061", -1],
  ["\u660E\u5929", -1],
  ["\u660E\u5F8C\u65E5", -2],
  ["\u3042\u3055\u3063\u3066", -2],
  ["\u307F\u3087\u3046\u3054\u306B\u3061", -2],
  ["\u540E\u5929", -2],
  ["\u5F8C\u5929", -2],
  ["\u660E\u3005\u5F8C\u65E5", -3],
  ["\u660E\u660E\u5F8C\u65E5", -3],
  ["\u3057\u3042\u3055\u3063\u3066", -3],
  ["\u5927\u540E\u5929", -3],
  ["\u5927\u5F8C\u5929", -3],
  ["\u6628\u65E5", 1],
  ["\u304D\u306E\u3046", 1],
  ["\u3055\u304F\u3058\u3064", 1],
  ["\u6628\u5929", 1],
  ["\u4E00\u6628\u65E5", 2],
  ["\u304A\u3068\u3068\u3044", 2],
  ["\u3044\u3063\u3055\u304F\u3058\u3064", 2],
  ["\u524D\u5929", 2]
]);
var relativeDayTokens = bothKanaSpellings(DAY_OFFSETS.keys());
var NOW_WORDS = /* @__PURE__ */ new Set(["\u4ECA", "\u3044\u307E", "\u73FE\u5728", "\u3052\u3093\u3056\u3044", "\u305F\u3060\u4ECA", "\u305F\u3060\u3044\u307E", "\u305F\u3063\u305F\u4ECA", "\u305F\u3063\u305F\u3044\u307E", "\u4ECA\u73FE\u5728", "\u73B0\u5728", "\u73FE\u5728\u6642\u9593", "\u521A\u521A", "\u525B\u525B", "\u521A\u624D"]);
var relativeNowTokens = bothKanaSpellings(NOW_WORDS);
var HOUR_MS = 36e5;
var JST_OFFSET_MS = 9 * HOUR_MS;

// src/parse.js
function normalize(text) {
  return text.normalize("NFKC").replace(/(?<=[\u3040-\u30ff\u4e00-\u9fff])[ \t]+(?=[\u3040-\u30ff\u4e00-\u9fff])/g, "").trim();
}
__name(normalize, "normalize");
function classify(text, rules = []) {
  const normalizedText = normalize(text).toLowerCase();
  const merchantAliases = { "\u30B9\u30BF\u30D0": "\u30B9\u30BF\u30FC\u30D0\u30C3\u30AF\u30B9" };
  const matches = /* @__PURE__ */ __name((rule) => {
    const keyword = normalize(rule.keyword).toLowerCase();
    return normalizedText.includes(keyword) || merchantAliases[keyword] && normalizedText.includes(merchantAliases[keyword].toLowerCase());
  }, "matches");
  const candidates = rules.filter((r) => r?.keyword && r?.category && !String(r.keyword).startsWith("__")).sort((a, b) => normalize(b.keyword).length - normalize(a.keyword).length);
  const matchedDefaults = candidates.filter((r) => r.is_custom === false && matches(r));
  const isGenericBusCollision = /* @__PURE__ */ __name((rule) => normalize(rule.keyword).toLowerCase() === "\u30D0\u30B9" && matchedDefaults.some((base) => normalize(base.keyword).toLowerCase().includes("\u307E\u3044\u3070\u3059")), "isGenericBusCollision");
  const custom = candidates.find((r) => r.is_custom !== false && matches(r) && !isGenericBusCollision(r));
  if (custom) return { category: custom.category, keyword: custom.keyword };
  if (isStationMerchant(text)) return { category: "\u4EA4\u901A", keyword: "\u99C5" };
  const chosen = matchedDefaults[0] || candidates.find(matches);
  return chosen ? { category: chosen.category, keyword: chosen.keyword } : { category: "\u65E5\u7528\u54C1", keyword: "" };
}
__name(classify, "classify");

// src/payment-rules.js
var normalizeMerchant = /* @__PURE__ */ __name((name) => String(name || "").normalize("NFKC").toLowerCase().replace(/[\s　・]/g, ""), "normalizeMerchant");
function paymentForDraft({ merchant = "", recognized = "", importSource = "", rules = [], registeredSources = [], defaultSource = "", type = "expense" }) {
  if (type !== "expense") return "";
  const available = new Set(registeredSources.map((x) => String(x).normalize("NFKC").trim()));
  const allowed2 = /* @__PURE__ */ __name((name) => available.has(name) || name === "\u73FE\u91D1", "allowed");
  if (importSource && allowed2(importSource)) return importSource;
  const key2 = normalizeMerchant(merchant);
  const rule = [...rules].filter((x) => x?.keyword && x?.payment_source).sort((a, b) => normalizeMerchant(b.keyword).length - normalizeMerchant(a.keyword).length).find((x) => key2 && key2.includes(normalizeMerchant(x.keyword)));
  const suica = registeredSources.find((name) => String(name).normalize("NFKC").trim().toLowerCase() === "suica");
  const savedRule = rule?.payment_source && allowed2(rule.payment_source) ? rule.payment_source : "";
  const paypayCredit = /^(?:paypayクレジット|paypaycredit)$/i.test(
    String(recognized || "").normalize("NFKC").replace(/[\s　・]/g, "")
  );
  const paypayCards = registeredSources.filter((name) => /^paypay/i.test(String(name).normalize("NFKC").replace(/[\s　・]/g, "")) && /(?:カード|card|visa|クレジット|credit)/i.test(String(name).normalize("NFKC")));
  const isOlive = /^(?:olive|oliveクレジット|olivecredit)$/i.test(
    String(recognized || "").normalize("NFKC").replace(/[\s　・/／]/g, "")
  );
  const smbcCards = registeredSources.filter((name) => /^(?:三井住友カード|SMBCカード)/i.test(String(name).normalize("NFKC").trim()));
  const ocrCard = recognized && allowed2(recognized) ? recognized : paypayCredit && paypayCards.length === 1 ? paypayCards[0] : isOlive && smbcCards.length === 1 ? smbcCards[0] : "";
  return savedRule || ocrCard || (suica && isStationMerchant(merchant) ? suica : "") || (allowed2(defaultSource) ? defaultSource : "");
}
__name(paymentForDraft, "paymentForDraft");

// functions/api/bridge/variable-bill-sync.js
var ok = /* @__PURE__ */ __name((x, s = 200) => Response.json(x, { status: s, headers: { "cache-control": "no-store" } }), "ok");
var fail = /* @__PURE__ */ __name((code, s = 400) => ok({ ok: false, error: code }, s), "fail");
var uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
var month = /^20\d\d-(0[1-9]|1[0-2])$/;
var isDate = /* @__PURE__ */ __name((d) => typeof d === "string" && /^20\d\d-\d\d-\d\d$/.test(d) && Number.isFinite(Date.parse(d + "T00:00:00Z")) && (/* @__PURE__ */ new Date(d + "T00:00:00Z")).toISOString().slice(0, 10) === d, "isDate");
var isId = /* @__PURE__ */ __name((x) => typeof x === "string" && x.length >= 8 && x.length <= 128 && /^[A-Za-z0-9_:-]+$/.test(x), "isId");
function onCycle(p, period) {
  if (period < p.start_month) return false;
  const a = p.start_month.split("-").map(Number), b = period.split("-").map(Number);
  return ((b[0] - a[0]) * 12 + b[1] - a[1]) % p.interval_months === 0;
}
__name(onCycle, "onCycle");
async function variableBillOptions(db) {
  try {
    const r = await db.prepare("SELECT id,name,payment_source FROM variable_recurring_plans WHERE enabled=1 ORDER BY name LIMIT 60").all();
    return (r.results || []).map((x) => ({ value: x.id, label: x.name + " \xB7 " + x.payment_source }));
  } catch (e) {
    return [];
  }
}
__name(variableBillOptions, "variableBillOptions");
async function lookupVariableBill(db, sourceCandidate) {
  if (!isId(sourceCandidate)) return null;
  try {
    const b = await db.prepare("SELECT plan_id,period_month,status FROM variable_recurring_bills WHERE source_candidate_id=? LIMIT 1").bind(sourceCandidate).first();
    return b ? { remote_id: "variable-bill:" + b.plan_id + ":" + b.period_month, status: b.status } : null;
  } catch {
    return null;
  }
}
__name(lookupVariableBill, "lookupVariableBill");
async function importVariableBillDraft(db, requestPayload) {
  const p = requestPayload?.payload, sourceCandidate = requestPayload?.source_candidate_id;
  const sourceDocument = requestPayload?.source_document_id;
  if (!p || !uuid.test(p.planId || "") || !month.test(p.periodMonth || "") || !Number.isSafeInteger(p.amount) || p.amount < 1 || p.amount > 1e7 || !(p.billDate === null || p.billDate === void 0 || isDate(p.billDate)) || ![p.expenseDate, p.serviceStart, p.serviceEnd].every((d) => d === void 0 || d === null || isDate(d)) || p.serviceStart && p.serviceEnd && p.serviceStart > p.serviceEnd || !isId(sourceCandidate) || !isId(sourceDocument) || typeof p.merchant !== "string" || !p.merchant.trim() || p.merchant.length > 120)
    return fail("invalid_variable_bill", 400);
  try {
    const existing = await lookupVariableBill(db, sourceCandidate);
    if (existing) {
      return existing.remote_id === "variable-bill:" + p.planId + ":" + p.periodMonth ? ok({ ok: true, remote_id: existing.remote_id, reused: true, draft_only: true }) : fail("variable_bill_candidate_conflict", 409);
    }
    const plan = await db.prepare("SELECT start_month,interval_months,enabled FROM variable_recurring_plans WHERE id=?").bind(p.planId).first();
    if (!plan || !plan.enabled || !onCycle(plan, p.periodMonth))
      return fail("variable_bill_plan_changed", 409);
    const inserted = await db.prepare("INSERT INTO variable_recurring_bills (plan_id,period_month,amount_jpy,bill_date,expense_date,service_start,service_end,source_type,source_document_id,source_candidate_id,updated_at) VALUES(?,?,?,?,?,?,?,'document',?,?,?) ON CONFLICT(plan_id,period_month) DO NOTHING").bind(
      p.planId,
      p.periodMonth,
      p.amount,
      p.billDate ?? null,
      p.expenseDate ?? null,
      p.serviceStart ?? null,
      p.serviceEnd ?? null,
      sourceDocument,
      sourceCandidate,
      Date.now()
    ).run();
    if (inserted.meta?.changes !== 1) {
      const current = await lookupVariableBill(db, sourceCandidate);
      if (!current || current.remote_id !== "variable-bill:" + p.planId + ":" + p.periodMonth)
        return fail("variable_bill_period_conflict", 409);
    }
    return ok({
      ok: true,
      remote_id: "variable-bill:" + p.planId + ":" + p.periodMonth,
      reused: inserted.meta?.changes !== 1,
      draft_only: true
    });
  } catch (e) {
    if (/no such table: variable_recurring_/i.test(String(e))) return fail("variable_bill_not_ready", 503);
    return fail("variable_bill_draft_failed", 503);
  }
}
__name(importVariableBillDraft, "importVariableBillDraft");

// functions/api/bridge/document-assistant.js
var enc = new TextEncoder();
var json = /* @__PURE__ */ __name((value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }), "json");
async function verified(secret, raw, stamp, signature) {
  if (!/^[0-9a-f]{64}$/i.test(signature || "")) return false;
  const key2 = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key2, enc.encode(`${stamp}
${raw}`)));
  const supplied = Uint8Array.from(signature.match(/.{2}/g), (h) => parseInt(h, 16));
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= expected[i] ^ supplied[i];
  return diff === 0;
}
__name(verified, "verified");
async function stableRequestId(value) {
  const hash9 = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return "jda_" + Array.from(new Uint8Array(hash9), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 60);
}
__name(stableRequestId, "stableRequestId");
async function onRequestPost({ request, env }) {
  if (env.JPDA_BRIDGE_ENABLED !== "true") return json({ ok: false, error: "bridge_disabled" }, 404);
  if (!env.JPDA_BRIDGE_SECRET || env.JPDA_BRIDGE_SECRET.length < 32) return json({ ok: false, error: "bridge_not_configured" }, 503);
  const stamp = request.headers.get("X-DA-Timestamp") || "";
  if (!/^\d{13}$/.test(stamp) || Math.abs(Date.now() - Number(stamp)) > 3e5) return json({ ok: false, error: "expired_signature" }, 401);
  const raw = await request.text();
  if (raw.length > 8e3) return json({ ok: false, error: "too_large" }, 413);
  if (!await verified(env.JPDA_BRIDGE_SECRET, raw, stamp, request.headers.get("X-DA-Signature")))
    return json({ ok: false, error: "invalid_signature" }, 401);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  if (body?.source !== "jp-document-assistant") return json({ ok: false, error: "invalid_source" }, 400);
  const actor = body.actor_user_id;
  const internalOnly = env.JPDA_PRIVATE_BRIDGE === "true";
  if (internalOnly) {
    if (typeof actor !== "string" || actor.length < 1 || actor.length > 100) return json({ ok: false, error: "actor_not_allowed" }, 403);
  } else if (!env.JPDA_BRIDGE_ALLOWED_USER || actor !== env.JPDA_BRIDGE_ALLOWED_USER)
    return json({ ok: false, error: "actor_not_allowed" }, 403);
  if (body?.payload?.operation === "options") {
    const type = body.payload.entryType;
    if (!["income", "expense", "transfer"].includes(type)) return json({ ok: false, error: "invalid_entry_type" }, 400);
    const merchant2 = body.payload.merchant ?? "";
    const recognized = body.payload.recognizedPayment ?? "";
    if (typeof merchant2 !== "string" || merchant2.length > 100 || typeof recognized !== "string" || recognized.length > 80)
      return json({ ok: false, error: "invalid_merchant_lookup" }, 400);
    try {
      const [categories, methods, builtIn, custom, paymentRules] = await env.DB.batch([
        env.DB.prepare("SELECT category,COALESCE(NULLIF(display_name,''),category) AS display_name,is_default FROM category_source WHERE entry_type=?1 ORDER BY COALESCE(sort_order,10000),category LIMIT 120").bind(type),
        env.DB.prepare("SELECT name,is_default FROM payment_sources WHERE is_archived=0 ORDER BY CASE WHEN name IN ('\u305D\u306E\u4ED6','\u5176\u4ED6') THEN 1 ELSE 0 END,sort_order,name LIMIT 120"),
        env.DB.prepare("SELECT keyword,category FROM rules WHERE category IS NOT NULL"),
        env.DB.prepare("SELECT keyword,category FROM merchant_rules WHERE category IS NOT NULL"),
        env.DB.prepare("SELECT keyword,payment_source FROM merchant_rules WHERE payment_source IS NOT NULL")
      ]);
      const categoryRows = categories.results || [];
      const methodRows = methods.results || [];
      const names = methodRows.map((row) => String(row.name || "")).filter(Boolean);
      if (!names.includes("\u73FE\u91D1")) names.unshift("\u73FE\u91D1");
      const choices = type === "transfer" ? [{ value: "\u6295\u8CC7\u30FB\u8CC7\u7523\u79FB\u52D5", label: "\u8D44\u4EA7\u8F6C\u79FB" }] : categoryRows.map((row) => ({
        value: String(row.category || ""),
        label: String(row.display_name || row.category || "")
      })).filter((row) => row.value && row.label);
      const availableCategories = new Set(choices.map((c) => c.value));
      const categoryDefault = type === "transfer" ? "\u6295\u8CC7\u30FB\u8CC7\u7523\u79FB\u52D5" : categoryRows.find((row) => Number(row.is_default) === 1)?.category || categoryRows[0]?.category || "";
      const registered = names;
      const paymentDefault = methodRows.find((row) => Number(row.is_default) === 1)?.name || "";
      let recommendedCategory = categoryDefault, recommendedPayment = "";
      let categoryOrigin = "default", paymentOrigin = "default";
      if (type === "expense" || type === "transfer") {
        const customRules = (custom.results || []).map((row) => ({ ...row, is_custom: true }));
        const defaults = (builtIn.results || []).map((row) => ({ ...row, is_custom: false }));
        const byKeyword = new Map(defaults.map((row) => [row.keyword, row]));
        for (const row of customRules) byKeyword.set(row.keyword, row);
        const classified = type === "expense" && merchant2 ? classify(merchant2, [...byKeyword.values()]) : null;
        if (classified?.keyword && availableCategories.has(classified.category)) {
          recommendedCategory = classified.category;
          categoryOrigin = "merchant_rule";
        }
        const payment = paymentForDraft({
          merchant: merchant2,
          recognized,
          rules: paymentRules.results || [],
          registeredSources: registered,
          defaultSource: paymentDefault,
          type: "expense"
        });
        recommendedPayment = payment;
        const normalized = normalizeMerchant(merchant2);
        const matchedPayment = (paymentRules.results || []).filter((row) => row.keyword && row.payment_source).sort((a, b) => normalizeMerchant(b.keyword).length - normalizeMerchant(a.keyword).length).find((row) => normalized && normalized.includes(normalizeMerchant(row.keyword)) && registered.includes(row.payment_source));
        if (matchedPayment && payment === matchedPayment.payment_source) paymentOrigin = "merchant_rule";
        else if (payment && recognized && payment !== paymentDefault) paymentOrigin = "recognized";
      }
      const suggested = {
        category: availableCategories.has(recommendedCategory) ? recommendedCategory : "",
        payment_source: registered.includes(recommendedPayment) ? recommendedPayment : "",
        category_origin: categoryOrigin,
        payment_origin: paymentOrigin
      };
      const variable_plans = type === "expense" ? await variableBillOptions(env.DB) : [];
      return json({
        ok: true,
        categories: choices,
        payment_sources: names.map((value) => ({ value, label: value })),
        variable_plans,
        suggested
      });
    } catch {
      return json({ ok: false, error: "catalog_unavailable" }, 503);
    }
  }
  const key2 = body?.idempotency_key;
  if (body?.payload?.operation === "variable_bill_draft") {
    if (typeof key2 !== "string" || !/^jda:kakebo:[a-f0-9]{16,64}$/i.test(key2) || request.headers.get("Idempotency-Key") !== key2)
      return json({ ok: false, error: "invalid_source" }, 400);
    return importVariableBillDraft(env.DB, body);
  }
  if (["lookup", "status"].includes(body?.payload?.operation)) {
    if (typeof key2 !== "string" || !/^jda:kakebo:[a-f0-9]{16,64}$/i.test(key2) || request.headers.get("Idempotency-Key") !== key2)
      return json({ ok: false, error: "invalid_source" }, 400);
    const requestId2 = await stableRequestId(key2);
    try {
      const row = await env.DB.prepare("SELECT id FROM entries WHERE client_request_id=?1").bind(requestId2).first();
      const tombstone = row?.id ? null : await env.DB.prepare(`SELECT item_id FROM trash_items
        WHERE item_type='entry' AND json_valid(payload_json)
          AND json_extract(payload_json,'$.entry.client_request_id')=?1 LIMIT 1`).bind(requestId2).first();
      const draft = row?.id || tombstone?.item_id ? null : await lookupVariableBill(env.DB, body.source_candidate_id);
      const remoteId = row?.id ?? tombstone?.item_id ?? draft?.remote_id ?? null;
      const result2 = { ok: true, exists: remoteId !== null, remote_id: remoteId !== null ? String(remoteId) : null };
      if (body.payload.operation === "status") result2.record_state = row?.id || draft ? "active" : tombstone ? "trashed" : "missing";
      return json(result2);
    } catch {
      return json({ ok: false, error: "ledger_lookup_failed" }, 503);
    }
  }
  if (body?.payload?.operation !== "entry" || typeof key2 !== "string" || !/^jda:kakebo:[a-f0-9]{16,64}$/i.test(key2) || request.headers.get("Idempotency-Key") !== key2) return json({ ok: false, error: "invalid_source" }, 400);
  const p = body.payload;
  const date8 = p.date, amount = p.amount, source = p.paymentSource;
  const transactionTime = p.time === void 0 ? "" : p.time;
  if (typeof transactionTime !== "string" || transactionTime !== "" && !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(transactionTime))
    return json({ ok: false, error: "invalid_entry_time" }, 400);
  if (!["income", "expense", "transfer"].includes(p.type) || !Number.isSafeInteger(amount) || amount <= 0 || typeof date8 !== "string" || !/^\d{4}-\d\d-\d\d$/.test(date8) || !Number.isFinite(Date.parse(date8 + "T00:00:00Z")) || (/* @__PURE__ */ new Date(date8 + "T00:00:00Z")).toISOString().slice(0, 10) !== date8 || typeof p.category !== "string" || !p.category.trim() || p.category.length > 80 || typeof source !== "string" || source.length > 80 || p.merchant !== void 0 && (typeof p.merchant !== "string" || p.merchant.length > 100))
    return json({ ok: false, error: "invalid_entry" }, 400);
  const transfer = p.type === "transfer";
  const validDate3 = /* @__PURE__ */ __name((value) => typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z")) && (/* @__PURE__ */ new Date(value + "T00:00:00Z")).toISOString().slice(0, 10) === value, "validDate");
  if (transfer) {
    if (p.category !== "\u6295\u8CC7\u30FB\u8CC7\u7523\u79FB\u52D5" || p.transferTarget !== "sbi" || !validDate3(p.transferDate) || !["monthly", "purchase"].includes(p.sbiPurpose))
      return json({ ok: false, error: "invalid_transfer" }, 400);
  } else if (p.transferTarget !== void 0 || p.transferDate !== void 0 || p.sbiPurpose !== void 0) {
    return json({ ok: false, error: "invalid_transfer" }, 400);
  }
  const merchant = typeof p.merchant === "string" ? p.merchant.trim() : "";
  if (!merchant) return json({ ok: false, error: "merchant_confirmation_required" }, 400);
  const field = {
    type: p.type,
    date: date8,
    time: transactionTime,
    amount,
    category: p.category.trim(),
    paymentSource: source.trim(),
    note: typeof p.note === "string" ? p.note.slice(0, 180) : "",
    merchant
  };
  const fieldErr = validateLedgerTextFields(field);
  if (fieldErr) return json({ ok: false, error: "invalid_text" }, 400);
  if (!transfer) {
    try {
      const row = await env.DB.prepare("SELECT category FROM category_source WHERE category=?1 AND entry_type=?2").bind(field.category, field.type).first();
      if (!row) return json({ ok: false, error: "category_not_registered" }, 400);
    } catch {
      return json({ ok: false, error: "catalog_unavailable" }, 503);
    }
  }
  const paymentErr = await validateRegisteredPaymentSource(env.DB, field.paymentSource);
  if (paymentErr) return json({ ok: false, error: paymentErr.code || "invalid_source" }, paymentErr.status || 400);
  const requestId = await stableRequestId(key2);
  try {
    const tokyoToday = new Date(Date.now() + 9 * 60 * 60 * 1e3).toISOString().slice(0, 10);
    const applied = transfer && p.transferDate <= tokyoToday ? 1 : 0;
    const insert = env.DB.prepare(`INSERT INTO entries
      (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source)
      SELECT ?1,?9,?2,?3,?4,?5,'',?6,?10,?11,?12,?7,?8
      WHERE NOT EXISTS (SELECT 1 FROM entries
        WHERE date=?1 AND amount=?2 AND type=?6 AND COALESCE(payment_source,'')=?8
          AND TRIM(COALESCE(merchant,''))=TRIM(?4)
          AND (type<>'transfer' OR COALESCE(transfer_target,'')=COALESCE(?10,''))
          AND (COALESCE(time,'')='' OR COALESCE(?9,'')=''
            OR ABS((CAST(SUBSTR(time,1,2) AS INTEGER)*60 + CAST(SUBSTR(time,4,2) AS INTEGER))
              -(CAST(SUBSTR(?9,1,2) AS INTEGER)*60 + CAST(SUBSTR(?9,4,2) AS INTEGER)))<=5))
      ON CONFLICT(client_request_id) DO NOTHING`).bind(
      date8,
      amount,
      field.category,
      field.merchant,
      field.note,
      field.type,
      requestId,
      field.paymentSource,
      field.time,
      transfer ? "sbi" : null,
      applied,
      transfer ? p.transferDate : null
    );
    const result2 = transfer ? (await env.DB.batch([insert, env.DB.prepare(`INSERT OR IGNORE INTO sbi_transfer_links
          (entry_id,purchase_month,purpose)
          SELECT id,?2,?3 FROM entries WHERE client_request_id=?1
            AND type='transfer' AND transfer_target='sbi'`).bind(requestId, p.transferDate.slice(0, 7), p.sbiPurpose)]))[0] : await insert.run();
    const row = await env.DB.prepare("SELECT id FROM entries WHERE client_request_id=?1").bind(requestId).first();
    if (!row?.id && result2.meta?.changes === 0) return json({ ok: false, error: "duplicate_candidate", message: "\u540C\u65E5\u540C\u91D1\u989D\u4E0E\u4ED8\u6B3E\u6765\u6E90\u7684\u8BB0\u5F55\u53EF\u80FD\u5DF2\u5B58\u5728\uFF0C\u8BF7\u5148\u6838\u5BF9\u5BB6\u8A08\u7C3F\u5E76\u624B\u52A8\u5173\u8054" }, 409);
    if (!row?.id) return json({ ok: false, error: "idempotency_lookup_failed" }, 503);
    return json({ ok: true, remote_id: String(row.id), reused: result2.meta?.changes === 0 });
  } catch {
    return json({ ok: false, error: "ledger_write_failed" }, 503);
  }
}
__name(onRequestPost, "onRequestPost");

// functions/api/internal/approved-actions/[[path]].js
var enc2 = new TextEncoder();
var hex = /^[a-f0-9]{64}$/i;
var uuid2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var id32 = /^[a-f0-9]{32}$/i;
var reply = /* @__PURE__ */ __name((body, status = 200) => Response.json(body, { status, headers: {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
} }), "reply");
var refuse = /* @__PURE__ */ __name((code, status = 409) => reply({ ok: false, code, applied: false }, status), "refuse");
var randomId = /* @__PURE__ */ __name(() => Array.from(
  crypto.getRandomValues(new Uint8Array(16)),
  (x) => x.toString(16).padStart(2, "0")
).join(""), "randomId");
var sha = /* @__PURE__ */ __name(async (raw) => Array.from(new Uint8Array(
  await crypto.subtle.digest("SHA-256", enc2.encode(raw))
), (x) => x.toString(16).padStart(2, "0")).join(""), "sha");
function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || !hex.test(a) || !hex.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(same, "same");
function enabled(env) {
  return env.APP_ENV === "production" && env.KAKEIBO_FAMILY_EXECUTION_ENABLED === "true" && env.KAKEIBO_FAMILY_FINANCE_ENABLED === "true" && env.KAKEIBO_APPROVAL_PROOF_ENABLED === "true" && hex.test(env.KAKEIBO_APPROVAL_VERIFICATION_SECRET) && hex.test(env.KAKEIBO_FAMILY_PENDING_KEY) && typeof env.HOMEFLOW_IDENTITY_SERVICE?.fetch === "function" && typeof env.DB?.prepare === "function" && typeof env.HOMEFLOW_OAUTH_ORIGIN === "string" && /^https:\/\/[A-Za-z0-9.-]+$/.test(env.HOMEFLOW_OAUTH_ORIGIN);
}
__name(enabled, "enabled");
async function hmac(secret, client, stamp, raw) {
  const bytes = Uint8Array.from(secret.match(/.{2}/g), (x) => parseInt(x, 16));
  const key2 = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const result2 = await crypto.subtle.sign(
    "HMAC",
    key2,
    enc2.encode(client + "\n" + stamp + "\n" + raw)
  );
  return Array.from(new Uint8Array(result2), (x) => x.toString(16).padStart(2, "0")).join("");
}
__name(hmac, "hmac");
async function decodePayload(env, row) {
  try {
    const iv = Uint8Array.from(atob(row.payload_iv), (x) => x.charCodeAt(0));
    const cipher = Uint8Array.from(atob(row.payload_cipher), (x) => x.charCodeAt(0));
    if (iv.length !== 12 || cipher.length > 4500 || cipher.length < 16) return null;
    const key2 = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(
        env.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),
        (x) => parseInt(x, 16)
      ),
      "AES-GCM",
      false,
      ["decrypt"]
    );
    const plain = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: enc2.encode("kakeibo-finance:" + row.request_id)
    }, key2, cipher);
    const raw = new TextDecoder().decode(plain);
    if (!same(await sha(raw), row.payload_sha256)) return null;
    const payload2 = JSON.parse(raw);
    return { raw, payload: payload2 };
  } catch {
    return null;
  }
}
__name(decodePayload, "decodePayload");
function validDate(v) {
  if (typeof v !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v))
    return false;
  const stamp = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === v;
}
__name(validDate, "validDate");
function validCash(p, row) {
  return p && typeof p === "object" && !Array.isArray(p) && Object.keys(p).sort().join(",") === ["account_id", "amount_jpy", "category", "date", "merchant", "note", "type"].sort().join(",") && p.account_id === row.account_id && ["expense", "income"].includes(p.type) && Number.isSafeInteger(p.amount_jpy) && p.amount_jpy >= 1 && p.amount_jpy <= 1e7 && validDate(p.date) && typeof p.merchant === "string" && p.merchant.trim().length >= 1 && p.merchant.length <= 160 && typeof p.category === "string" && p.category.trim().length >= 1 && p.category.length <= 40 && typeof p.note === "string" && p.note.length <= 300;
}
__name(validCash, "validCash");
function publicResult(row, already) {
  return {
    ok: true,
    applied: true,
    status: already ? "already_applied" : "applied",
    approval_id: row.homeflow_request_id,
    proposal_id: row.proposal_id,
    household_id: row.household_id,
    requester_user_id: row.requester_user_id,
    payload_sha256: row.payload_sha256,
    entry_id: Number(row.entry_id),
    already_applied: already,
    applied_at: row.applied_at
  };
}
__name(publicResult, "publicResult");
function exact(row, body) {
  return row && row.homeflow_request_id === body.request_id && row.proposal_id === body.resource_id && row.household_id === body.household_id && row.requester_user_id === body.requester_user_id && row.payload_sha256 === body.payload_sha256;
}
__name(exact, "exact");
async function approvedActionRoute(request, env, parts) {
  if (!enabled(env)) return refuse("EXECUTION_DISABLED", 503);
  const receiptOnly = parts.length === 1 && parts[0] === "receipt";
  if (parts.length !== 1 || !["execute", "receipt"].includes(parts[0]) || request.method !== "POST")
    return refuse("NOT_FOUND", 404);
  if (request.headers.has("cookie") || request.headers.has("origin") || request.headers.has("authorization") || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    return refuse("BACKEND_ONLY", 403);
  const stamp = request.headers.get("x-approval-timestamp");
  const signature = request.headers.get("x-approval-signature");
  if (request.headers.get("x-approval-client") !== "homeflow" || !/^\d{13}$/.test(stamp || "") || Math.abs(Date.now() - Number(stamp)) > 3e5 || !hex.test(signature))
    return refuse("INVALID_SIGNATURE", 403);
  let raw, body;
  try {
    raw = await request.text();
    if (raw.length > 1600) throw Error("too large");
    body = JSON.parse(raw);
  } catch {
    return refuse("INVALID_INPUT", 400);
  }
  const mac10 = await hmac(
    env.KAKEIBO_APPROVAL_VERIFICATION_SECRET,
    receiptOnly ? "homeflow:receipt" : "homeflow",
    stamp,
    raw
  );
  if (!same(mac10, signature)) return refuse("INVALID_SIGNATURE", 403);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== [
    "request_id",
    "resource_id",
    "household_id",
    "requester_user_id",
    "payload_sha256",
    ...!receiptOnly ? ["execution_nonce"] : []
  ].sort().join(",") || !uuid2.test(body.request_id) || !id32.test(body.resource_id) || !hex.test(body.payload_sha256) || !receiptOnly && !hex.test(body.execution_nonce) || typeof body.household_id !== "string" || body.household_id.length < 1 || body.household_id.length > 128 || typeof body.requester_user_id !== "string" || body.requester_user_id.length < 1 || body.requester_user_id.length > 128)
    return refuse("INVALID_INPUT", 400);
  const db = env.DB;
  const existing = await db.prepare("SELECT * FROM family_finance_applied_actions WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1").bind(body.request_id, body.resource_id).first();
  if (existing) {
    if (!exact(existing, body)) return refuse("APPLIED_IDENTITY_CONFLICT", 409);
    return reply(publicResult(existing, true));
  }
  if (receiptOnly) return refuse("RECEIPT_NOT_FOUND", 404);
  const row = await db.prepare("SELECT p.*,a.account_kind,a.origin,a.owner_user_id,a.is_archived,a.household_id AS account_household,l.role AS owner_role,l.state AS owner_state FROM family_finance_pending_actions p JOIN family_financial_accounts a ON a.account_id=p.account_id JOIN homeflow_identity_links l ON l.user_id=p.requester_user_id WHERE p.request_id=? AND p.homeflow_approval_id=?").bind(body.resource_id, body.request_id).first();
  if (!row || row.state !== "submitted" || row.operation !== "finance.entry.create" || row.requester_user_id !== body.requester_user_id || row.household_id !== body.household_id || row.payload_sha256 !== body.payload_sha256 || row.owner_user_id !== body.requester_user_id || row.account_household !== body.household_id || row.owner_role !== "member" || row.owner_state !== "active" || row.is_archived !== 0 || row.origin !== "member_created" || row.expires_at <= Date.now())
    return refuse("PROPOSAL_CONFLICT", 409);
  if (row.account_kind !== "cash")
    return refuse("ACCOUNT_TYPE_NOT_EXECUTABLE", 409);
  const decrypted = await decodePayload(env, row);
  if (!decrypted || !validCash(decrypted.payload, row))
    return refuse("PRIVATE_PAYLOAD_INTEGRITY_FAILED", 409);
  const ask = {
    request_id: body.request_id,
    resource_id: body.resource_id,
    household_id: body.household_id,
    requester_user_id: body.requester_user_id,
    payload_sha256: body.payload_sha256,
    idempotency_key: "kakeibo:finance:" + body.resource_id,
    expected_version: null,
    purpose: "execute",
    execution_nonce: body.execution_nonce
  };
  const query = JSON.stringify(ask), timestamp = String(Date.now());
  const proofReq = new Request(new URL("/api/internal/approvals/verify", env.HOMEFLOW_OAUTH_ORIGIN), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "x-approval-client": "kakeibo",
      "x-approval-timestamp": timestamp,
      "x-approval-signature": await hmac(env.KAKEIBO_APPROVAL_VERIFICATION_SECRET, "kakeibo", timestamp, query)
    },
    body: query
  });
  let proof7;
  try {
    const response3 = await env.HOMEFLOW_IDENTITY_SERVICE.fetch(proofReq);
    if (response3.status === 409) return refuse("APPROVAL_NOT_EXECUTING", 409);
    if (response3.status !== 200 || response3.headers.has("location"))
      return refuse("HOMEFLOW_PROOF_UNAVAILABLE", 503);
    const raw2 = await response3.text();
    if (raw2.length > 1800) return refuse("INVALID_HOMEFLOW_PROOF", 503);
    proof7 = JSON.parse(raw2);
  } catch {
    return refuse("HOMEFLOW_PROOF_UNAVAILABLE", 503);
  }
  if (proof7?.ok !== true || proof7.verified !== true || proof7.execution_authorized !== true || proof7.execution_status !== "executing" || proof7.request_id !== body.request_id || proof7.resource_id !== body.resource_id || proof7.household_id !== body.household_id || proof7.requester_user_id !== body.requester_user_id || proof7.payload_sha256 !== body.payload_sha256 || proof7.idempotency_key !== ask.idempotency_key || proof7.expected_version !== null || !proof7.approver_user_id || proof7.approver_user_id === body.requester_user_id || !Number.isSafeInteger(proof7.expires_at) || proof7.expires_at <= Date.now() || !Number.isSafeInteger(proof7.approved_at) || proof7.applied !== false)
    return refuse("INVALID_HOMEFLOW_PROOF", 503);
  const payload2 = decrypted.payload, clientRequest = "hf:" + body.request_id;
  const appliedAt = Date.now(), eventId = randomId();
  try {
    const changes = await db.batch([
      db.prepare("INSERT INTO entries (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id) SELECT ?,'',?,?,?,?,?, ?,NULL,0,NULL,?,'',? WHERE EXISTS(SELECT 1 FROM family_finance_pending_actions p JOIN family_financial_accounts a ON a.account_id=p.account_id WHERE p.request_id=? AND p.state='submitted' AND p.homeflow_approval_id=? AND p.payload_sha256=? AND a.account_kind='cash' AND a.is_archived=0 AND a.owner_user_id=?) ON CONFLICT(client_request_id) DO NOTHING").bind(
        payload2.date,
        payload2.amount_jpy,
        payload2.category,
        payload2.merchant,
        payload2.note,
        "",
        payload2.type,
        clientRequest,
        payload2.account_id,
        body.resource_id,
        body.request_id,
        body.payload_sha256,
        body.requester_user_id
      ),
      db.prepare("INSERT INTO family_finance_applied_actions (homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,account_id,payload_sha256,client_request_id,entry_id,applied_at) VALUES(?,?,?,?,?,?,?,?,(SELECT e.id FROM entries e WHERE e.client_request_id=? AND e.family_account_id=? AND e.date=? AND e.amount=? AND e.category=? AND e.merchant=? AND e.note=? AND e.type=? AND e.payment_source=? LIMIT 1),?)").bind(
        body.request_id,
        body.resource_id,
        body.household_id,
        body.requester_user_id,
        proof7.approver_user_id,
        payload2.account_id,
        body.payload_sha256,
        clientRequest,
        clientRequest,
        payload2.account_id,
        payload2.date,
        payload2.amount_jpy,
        payload2.category,
        payload2.merchant,
        payload2.note,
        payload2.type,
        "",
        appliedAt
      ),
      db.prepare("INSERT INTO family_finance_events (event_id,household_id,actor_user_id,resource_id,action,created_at) SELECT ?,?,?,?,'finance_entry_applied',? WHERE changes()=1").bind(
        eventId,
        body.household_id,
        body.requester_user_id,
        body.resource_id,
        new Date(appliedAt).toISOString()
      )
    ]);
    if (changes[1]?.meta?.changes !== 1 || changes[2]?.meta?.changes !== 1) {
      const raced = await db.prepare("SELECT * FROM family_finance_applied_actions WHERE homeflow_request_id=?").bind(body.request_id).first();
      return exact(raced, body) ? reply(publicResult(raced, true)) : refuse("LEDGER_IDEMPOTENCY_CONFLICT", 409);
    }
  } catch {
    const raced = await db.prepare("SELECT * FROM family_finance_applied_actions WHERE homeflow_request_id=?").bind(body.request_id).first().catch(() => null);
    return exact(raced, body) ? reply(publicResult(raced, true)) : refuse("LEDGER_TRANSACTION_RETRY", 503);
  }
  const applied = await db.prepare("SELECT * FROM family_finance_applied_actions WHERE homeflow_request_id=?").bind(body.request_id).first();
  return applied && exact(applied, body) ? reply(publicResult(applied, false)) : refuse("LEDGER_COMMIT_RECONCILE", 503);
}
__name(approvedActionRoute, "approvedActionRoute");
async function onRequest({ request, env, params }) {
  return approvedActionRoute(request, env, params.path || []);
}
__name(onRequest, "onRequest");

// functions/api/internal/bank-transfers/cross-member.js
var enc3 = new TextEncoder();
var h64 = /^[a-f0-9]{64}$/i;
var response = /* @__PURE__ */ __name((x, status = 200) => Response.json(x, { status, headers: { "cache-control": "no-store" } }), "response");
var deny = /* @__PURE__ */ __name((code, status = 409) => response({ ok: false, code, applied: false }, status), "deny");
var exact2 = /* @__PURE__ */ __name((x, keys) => x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).sort().join(",") === keys.slice().sort().join(","), "exact");
var hash = /* @__PURE__ */ __name(async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc3.encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join(""), "hash");
var fresh = /* @__PURE__ */ __name(() => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join(""), "fresh");
var iso = /* @__PURE__ */ __name((s) => typeof s === "string" && /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) && (/* @__PURE__ */ new Date(s + "T00:00:00Z")).toISOString().slice(0, 10) === s, "iso");
var today = /* @__PURE__ */ __name(() => new Date(Date.now() + 324e5).toISOString().slice(0, 10), "today");
var ready = /* @__PURE__ */ __name((e) => e.APP_ENV === "production" && e.KAKEIBO_FAMILY_FINANCE_ENABLED === "true" && e.KAKEIBO_CROSS_MEMBER_BANK_ENABLED === "true" && e.KAKEIBO_BANK_TRANSFER_ENABLED === "true" && h64.test(e.KAKEIBO_FAMILY_PENDING_KEY || "") && h64.test(e.KAKEIBO_BANK_TRANSFER_PROOF_SECRET || "") && h64.test(e.KAKEIBO_CROSS_MEMBER_PROOF_SECRET || "") && e.DB?.prepare && typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch === "function" && /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN || ""), "ready");
async function mac(secret, domain, stamp, raw) {
  const key2 = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(secret.match(/.{2}/g), (x) => parseInt(x, 16)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key2, enc3.encode(domain + "\n" + stamp + "\n" + raw)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
__name(mac, "mac");
async function remote(e, path, client, secret, domain, body) {
  const raw = JSON.stringify(body), stamp = String(Date.now());
  try {
    const res = await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(new URL(path, e.HOMEFLOW_OAUTH_ORIGIN), {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "x-approval-client": client,
        "x-approval-timestamp": stamp,
        "x-approval-signature": await mac(secret, domain, stamp, raw)
      },
      body: raw
    }));
    if (res.status !== 200 || res.headers.has("location")) return null;
    const txt = await res.text();
    return txt.length <= 2400 ? JSON.parse(txt) : null;
  } catch {
    return null;
  }
}
__name(remote, "remote");
async function payload(e, p) {
  try {
    const iv = Uint8Array.from(atob(p.payload_iv), (x2) => x2.charCodeAt(0));
    const cipher = Uint8Array.from(atob(p.payload_cipher), (x2) => x2.charCodeAt(0));
    if (iv.length !== 12 || cipher.length < 16 || cipher.length > 3e3) return null;
    const key2 = await crypto.subtle.importKey("raw", Uint8Array.from(
      e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),
      (x2) => parseInt(x2, 16)
    ), "AES-GCM", false, ["decrypt"]);
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: enc3.encode("kakeibo-cross-bank:" + p.request_id)
    }, key2, cipher));
    if (await hash(raw) !== p.payload_sha256) return null;
    const x = JSON.parse(raw);
    if (!exact2(x, [
      "source_user_id",
      "recipient_user_id",
      "source_account_id",
      "source_version",
      "target_account_id",
      "target_version",
      "debit_date",
      "amount_jpy",
      "source_reference_hash",
      "bank_debit_posted",
      "evidence_kind"
    ]) || x.source_user_id !== p.requester_user_id || x.recipient_user_id !== p.recipient_user_id || x.source_account_id !== p.source_account_id || x.target_account_id !== p.target_account_id || x.source_version !== p.source_version || x.target_version !== p.target_version || x.debit_date !== p.debit_date || x.amount_jpy !== p.amount_jpy || x.source_reference_hash !== p.source_reference_hash || x.bank_debit_posted !== true || x.evidence_kind !== "source_attested_posted_debit") return null;
    return x;
  } catch {
    return null;
  }
}
__name(payload, "payload");
var match = /* @__PURE__ */ __name((j, b) => j && j.homeflow_request_id === b.request_id && j.proposal_id === b.resource_id && j.household_id === b.household_id && j.requester_user_id === b.requester_user_id && j.payload_sha256 === b.payload_sha256, "match");
async function receipt(db, j, b, replayed) {
  const [entry, r, a, source, target] = await Promise.all([
    db.prepare("SELECT * FROM entries WHERE id=?").bind(j.transfer_entry_id).first(),
    db.prepare("SELECT * FROM family_cross_bank_recipient_evidence WHERE request_id=?").bind(j.proposal_id).first(),
    db.prepare("SELECT * FROM family_cross_bank_actor_audit WHERE homeflow_request_id=?").bind(j.homeflow_request_id).first(),
    db.prepare("SELECT owner_user_id FROM family_financial_accounts WHERE account_id=?").bind(j.source_account_id).first(),
    db.prepare("SELECT owner_user_id FROM family_financial_accounts WHERE account_id=?").bind(j.target_account_id).first()
  ]);
  if (!match(j, b) || !entry || !r || !a || !source || !target || source.owner_user_id !== j.requester_user_id || target.owner_user_id !== j.recipient_user_id || r.recipient_user_id !== j.recipient_user_id || r.credit_reference_hash !== j.credit_reference_hash || r.credit_date !== j.credit_date || r.amount_jpy !== j.amount_jpy || r.credit_posted !== 1 || entry.client_request_id !== "hfcrossbank:" + j.homeflow_request_id || entry.type !== "transfer" || entry.amount !== j.amount_jpy || entry.date !== j.debit_date || entry.transfer_date !== j.credit_date || entry.transfer_applied !== 1 || entry.payment_source !== "bank:" + j.source_account_id || entry.transfer_target !== "bank:" + j.target_account_id || entry.family_account_id !== j.source_account_id || entry.family_transfer_target_account_id !== j.target_account_id || a.source_actor_user_id !== j.requester_user_id || a.recipient_actor_user_id !== j.recipient_user_id || a.owner_authorizer_user_id !== j.approver_user_id || a.execute_actor_user_id !== j.actor_user_id || a.created_at !== j.applied_at)
    return deny("CROSS_BANK_DOUBLE_JOURNAL_RECEIPT_INVALID", 503);
  return response({
    ok: true,
    applied: true,
    approval_id: j.homeflow_request_id,
    proposal_id: j.proposal_id,
    household_id: j.household_id,
    requester_user_id: j.requester_user_id,
    approver_user_id: j.approver_user_id,
    actor_user_id: j.actor_user_id,
    payload_sha256: j.payload_sha256,
    source_account_id: j.source_account_id,
    source_version: j.source_version,
    target_account_id: j.target_account_id,
    target_version: j.target_version,
    amount_jpy: j.amount_jpy,
    debit_date: j.debit_date,
    credit_date: j.credit_date,
    source_reference_hash: j.source_reference_hash,
    target_reference_hash: j.credit_reference_hash,
    entry_type: "transfer",
    transfer_applied: true,
    balance_conserving: true,
    transfer_entry_id: j.transfer_entry_id,
    entry_id: j.transfer_entry_id,
    applied_at: j.applied_at,
    already_applied: replayed,
    cross_member: true,
    consent_id: j.consent_id,
    recipient_user_id: j.recipient_user_id,
    source_owner_user_id: j.requester_user_id,
    target_owner_user_id: j.recipient_user_id,
    owner_authorizer_user_id: j.approver_user_id,
    bank_statements_verified_by_institution: false
  });
}
__name(receipt, "receipt");
async function executionProof(e, b, version) {
  const body = {
    ...b,
    idempotency_key: "kakeibo:bank-transfer:" + b.resource_id,
    expected_version: version,
    purpose: "execute"
  };
  const r = await remote(
    e,
    "/api/internal/approvals/verify",
    "kakeibo-bank-transfer",
    e.KAKEIBO_BANK_TRANSFER_PROOF_SECRET,
    "kakeibo-bank-transfer:execution-proof",
    body
  );
  return r?.ok === true && r.verified === true && r.execution_authorized === true && r.execution_status === "executing" && r.source_app === "kakebo" && r.target_app === "kakebo" && r.operation === "finance.asset_transfer.bank_to_bank" && r.resource_type === "bank_transfer_posted" && r.idempotency_key === body.idempotency_key && r.request_id === b.request_id && r.resource_id === b.resource_id && r.household_id === b.household_id && r.requester_user_id === b.requester_user_id && r.payload_sha256 === b.payload_sha256 && r.expected_version === version && r.approved_at > 0 && r.expires_at > Date.now() && r.approver_user_id && r.approver_user_id !== b.requester_user_id && r.applied === false ? r : null;
}
__name(executionProof, "executionProof");
async function independentConsent(e, p) {
  const body = {
    consent_id: p.consent_id,
    resource_id: p.request_id,
    household_id: p.household_id,
    source_user_id: p.requester_user_id,
    recipient_user_id: p.recipient_user_id,
    payload_sha256: p.payload_sha256,
    source_account_version: p.source_version,
    recipient_account_version: p.target_version
  };
  const r = await remote(
    e,
    "/api/internal/cross-member/consent-proof",
    "kakeibo-cross-member",
    e.KAKEIBO_CROSS_MEMBER_PROOF_SECRET,
    "kakeibo-cross-member:consent-proof",
    body
  );
  return r?.ok === true && r.consent_verified === true && r.ledger_applied === false && r.target_ledger_authorized === false && r.bank_statements_verified === false && r.consent_id === p.consent_id && r.resource_id === p.request_id && r.payload_sha256 === p.payload_sha256 && r.household_id === p.household_id && r.source_user_id === p.requester_user_id && r.recipient_user_id === p.recipient_user_id && r.source_account_version === p.source_version && r.recipient_account_version === p.target_version && r.owner_authorizer_user_id === p.recipient_user_id && r.consent_version === 3 && Number.isSafeInteger(r.valid_until) && r.valid_until > Date.now();
}
__name(independentConsent, "independentConsent");
async function crossMemberBankExecution(e, b, mode) {
  if (!ready(e)) return deny("CROSS_BANK_EXECUTION_DISABLED", 503);
  const db = e.DB;
  const prior = await db.prepare("SELECT * FROM family_cross_bank_journal WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1").bind(b.request_id, b.resource_id).first();
  if (prior) return match(prior, b) ? receipt(db, prior, b, true) : deny("CROSS_BANK_APPROVAL_ID_CONFLICT");
  if (mode === "receipt") return deny("CROSS_BANK_RECEIPT_UNKNOWN", 404);
  const p = await db.prepare("SELECT i.*,r.credit_reference_hash,r.credit_date,r.credit_posted,r.amount_jpy AS confirmed_amount,src.version AS live_source,src.is_archived AS archived_source,dst.version AS live_target,dst.is_archived AS archived_target,src.owner_user_id AS source_owner,dst.owner_user_id AS recipient_owner,src.account_kind AS source_kind,dst.account_kind AS target_kind,src.origin AS source_origin,dst.origin AS target_origin,src.household_id AS source_household,dst.household_id AS target_household,sender.role AS source_role,sender.state AS source_state,recipient.role AS recipient_role,recipient.state AS recipient_state FROM family_cross_bank_intents i JOIN family_cross_bank_recipient_evidence r ON r.request_id=i.request_id JOIN family_financial_accounts src ON src.account_id=i.source_account_id JOIN family_financial_accounts dst ON dst.account_id=i.target_account_id JOIN homeflow_identity_links sender ON sender.user_id=i.requester_user_id JOIN homeflow_identity_links recipient ON recipient.user_id=i.recipient_user_id WHERE i.request_id=? AND i.homeflow_approval_id=? LIMIT 1").bind(b.resource_id, b.request_id).first();
  if (!p || p.status !== "submitted" || p.expires_at <= Date.now() || p.household_id !== b.household_id || p.requester_user_id !== b.requester_user_id || p.payload_sha256 !== b.payload_sha256 || !p.consent_id || p.live_source !== p.source_version || p.live_target !== p.target_version || p.archived_source !== 0 || p.archived_target !== 0 || p.source_owner !== p.requester_user_id || p.recipient_owner !== p.recipient_user_id || p.source_kind !== "bank" || p.target_kind !== "bank" || p.source_origin !== "member_created" || p.target_origin !== "member_created" || p.source_household !== p.household_id || p.target_household !== p.household_id || p.source_role !== "member" || p.recipient_role !== "owner" || p.source_state !== "active" || p.recipient_state !== "active" || p.credit_posted !== 1 || p.confirmed_amount !== p.amount_jpy || !iso(p.debit_date) || !iso(p.credit_date) || p.debit_date > p.credit_date || p.credit_date > today())
    return deny("CROSS_BANK_MEMBER_ACCOUNT_OR_EVIDENCE_CHANGED");
  const decoded = await payload(e, p);
  if (!decoded) return deny("CROSS_BANK_ENCRYPTED_INTENT_MISMATCH");
  const [approval, consented] = await Promise.all([
    executionProof(e, b, p.source_version),
    independentConsent(e, p)
  ]);
  if (!approval || !consented || approval.approver_user_id !== p.recipient_user_id)
    return deny("CROSS_BANK_INDEPENDENT_PROOF_MISSING");
  const at = Date.now(), entryId = "hfcrossbank:" + b.request_id;
  const actions = [
    db.prepare("INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) VALUES(?,'',?,'\u8CC7\u7523\u79FB\u52D5','\u9280\u884C\u632F\u66FF','\u53CC\u65B9\u78BA\u8A8D\u6E08\u632F\u66FF','','transfer',?,1,?,?,?,?,?)").bind(
      p.debit_date,
      p.amount_jpy,
      "bank:" + p.target_account_id,
      p.credit_date,
      entryId,
      "bank:" + p.source_account_id,
      p.source_account_id,
      p.target_account_id
    ),
    db.prepare("INSERT INTO family_cross_bank_journal (homeflow_request_id,proposal_id,household_id,requester_user_id,recipient_user_id,approver_user_id,actor_user_id,consent_id,source_account_id,source_version,target_account_id,target_version,amount_jpy,debit_date,credit_date,source_reference_hash,credit_reference_hash,payload_sha256,transfer_entry_id,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT id FROM entries WHERE client_request_id=?),?)").bind(
      b.request_id,
      b.resource_id,
      b.household_id,
      b.requester_user_id,
      p.recipient_user_id,
      approval.approver_user_id,
      approval.approver_user_id,
      p.consent_id,
      p.source_account_id,
      p.source_version,
      p.target_account_id,
      p.target_version,
      p.amount_jpy,
      p.debit_date,
      p.credit_date,
      p.source_reference_hash,
      p.credit_reference_hash,
      p.payload_sha256,
      entryId,
      at
    ),
    db.prepare("INSERT INTO family_cross_bank_actor_audit (event_id,homeflow_request_id,source_actor_user_id,recipient_actor_user_id,owner_authorizer_user_id,execute_actor_user_id,action,created_at) VALUES(?,?,?,?,?,?,'cross_member_posted_bank_transfer',?)").bind(
      fresh(),
      b.request_id,
      b.requester_user_id,
      p.recipient_user_id,
      approval.approver_user_id,
      approval.approver_user_id,
      at
    )
  ];
  try {
    const changes = await db.batch(actions);
    if (changes.length !== 3 || changes.some((x) => x.meta?.changes !== 1))
      return deny("CROSS_BANK_ATOMIC_CONFIRMATION_REQUIRED", 503);
  } catch {
    const raced = await db.prepare("SELECT * FROM family_cross_bank_journal WHERE homeflow_request_id=?").bind(b.request_id).first().catch(() => null);
    return match(raced, b) ? receipt(db, raced, b, true) : deny("CROSS_BANK_TRANSACTION_RETRY", 503);
  }
  const saved = await db.prepare("SELECT * FROM family_cross_bank_journal WHERE homeflow_request_id=?").bind(b.request_id).first();
  return match(saved, b) ? receipt(db, saved, b, false) : deny("CROSS_BANK_RECEIPT_UNCONFIRMED", 503);
}
__name(crossMemberBankExecution, "crossMemberBankExecution");

// functions/api/internal/bank-transfers/[[path]].js
var enc4 = new TextEncoder();
var hex2 = /^[a-f0-9]{64}$/i;
var id = /^[a-f0-9]{32}$/i;
var uuid3 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var json2 = /* @__PURE__ */ __name((data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } }), "json");
var fail2 = /* @__PURE__ */ __name((code, status = 409) => json2({ ok: false, code, applied: false }, status), "fail");
var exact3 = /* @__PURE__ */ __name((x, keys) => !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).sort().join(",") === keys.slice().sort().join(","), "exact");
var hash2 = /* @__PURE__ */ __name(async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc4.encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join(""), "hash");
var same2 = /* @__PURE__ */ __name((a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && hex2.test(a) && [...a].reduce((n, x, i) => n | x.charCodeAt(0) ^ b.charCodeAt(i), 0) === 0, "same");
var unique = /* @__PURE__ */ __name(() => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join(""), "unique");
var date = /* @__PURE__ */ __name((s) => typeof s === "string" && /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) && Number.isFinite(Date.parse(s + "T00:00:00Z")) && (/* @__PURE__ */ new Date(s + "T00:00:00Z")).toISOString().slice(0, 10) === s, "date");
var ready2 = /* @__PURE__ */ __name((e) => e.APP_ENV === "production" && e.KAKEIBO_FAMILY_FINANCE_ENABLED === "true" && e.KAKEIBO_BANK_TRANSFER_ENABLED === "true" && e.DB?.prepare && hex2.test(e.KAKEIBO_FAMILY_PENDING_KEY || "") && hex2.test(e.KAKEIBO_BANK_TRANSFER_EXECUTION_SECRET || "") && hex2.test(e.KAKEIBO_BANK_TRANSFER_PROOF_SECRET || "") && typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch === "function" && /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN || ""), "ready");
async function mac2(secret, domain, stamp, raw) {
  const key2 = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(secret.match(/.{2}/g), (x) => parseInt(x, 16)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key2, enc4.encode(domain + "\n" + stamp + "\n" + raw)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
__name(mac2, "mac");
var fields = ["request_id", "resource_id", "household_id", "requester_user_id", "payload_sha256"];
async function signed(req, e, mode) {
  if (req.method !== "POST" || req.headers.has("origin") || req.headers.has("cookie") || req.headers.has("authorization") || req.headers.get("x-approval-client") !== "homeflow" || req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return null;
  const stamp = req.headers.get("x-approval-timestamp") || "", signature = req.headers.get("x-approval-signature") || "";
  if (!/^\d{13}$/.test(stamp) || Math.abs(Date.now() - Number(stamp)) > 3e5 || !hex2.test(signature)) return null;
  let b, raw;
  try {
    raw = await req.text();
    if (raw.length > 1300) return null;
    b = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!exact3(b, mode === "execute" ? [...fields, "execution_nonce"] : fields) || !uuid3.test(b.request_id) || !id.test(b.resource_id) || !hex2.test(b.payload_sha256) || mode === "execute" && !hex2.test(b.execution_nonce) || typeof b.household_id !== "string" || !b.household_id || b.household_id.length > 128 || typeof b.requester_user_id !== "string" || !b.requester_user_id || b.requester_user_id.length > 128)
    return null;
  return same2(signature, await mac2(
    e.KAKEIBO_BANK_TRANSFER_EXECUTION_SECRET,
    "homeflow:bank-transfer-" + mode,
    stamp,
    raw
  )) ? b : null;
}
__name(signed, "signed");
var identity = /* @__PURE__ */ __name((r, b) => !!r && r.homeflow_request_id === b.request_id && r.proposal_id === b.resource_id && r.household_id === b.household_id && r.requester_user_id === b.requester_user_id && r.payload_sha256 === b.payload_sha256, "identity");
async function receipt2(db, r, b, replayed) {
  const [evidence, entry, audit] = await Promise.all([
    db.prepare("SELECT * FROM family_bank_transfer_posted_evidence WHERE evidence_id=?").bind(r.evidence_id).first(),
    db.prepare("SELECT * FROM entries WHERE id=?").bind(r.transfer_entry_id).first(),
    db.prepare("SELECT * FROM family_bank_transfer_actor_audit WHERE homeflow_request_id=?").bind(r.homeflow_request_id).first()
  ]);
  if (!identity(r, b) || !evidence || !entry || !audit || evidence.household_id !== r.household_id || evidence.source_account_id !== r.source_account_id || evidence.target_account_id !== r.target_account_id || evidence.source_version !== r.source_version || evidence.target_version !== r.target_version || evidence.amount_jpy !== r.amount_jpy || evidence.debit_date !== r.debit_date || evidence.credit_date !== r.credit_date || evidence.bank_debit_posted !== 1 || evidence.bank_credit_posted !== 1 || entry.type !== "transfer" || entry.amount !== r.amount_jpy || entry.client_request_id !== "hfbanktransfer:" + r.homeflow_request_id || entry.family_account_id !== r.source_account_id || entry.family_transfer_target_account_id !== r.target_account_id || entry.transfer_target !== "bank:" + r.target_account_id || entry.payment_source !== "bank:" + r.source_account_id || entry.transfer_applied !== 1 || entry.date !== r.debit_date || entry.transfer_date !== r.credit_date || audit.requester_user_id !== r.requester_user_id || audit.approver_user_id !== r.approver_user_id || audit.actor_user_id !== r.actor_user_id || audit.created_at !== r.applied_at)
    return fail2("BANK_TRANSFER_COUNTERPART_UNCONFIRMED", 503);
  return json2({
    ok: true,
    applied: true,
    approval_id: r.homeflow_request_id,
    proposal_id: r.proposal_id,
    household_id: r.household_id,
    requester_user_id: r.requester_user_id,
    approver_user_id: r.approver_user_id,
    actor_user_id: r.actor_user_id,
    payload_sha256: r.payload_sha256,
    source_account_id: r.source_account_id,
    source_version: r.source_version,
    target_account_id: r.target_account_id,
    target_version: r.target_version,
    amount_jpy: r.amount_jpy,
    debit_date: r.debit_date,
    credit_date: r.credit_date,
    source_reference_hash: evidence.source_reference_hash,
    target_reference_hash: evidence.target_reference_hash,
    entry_type: "transfer",
    transfer_applied: true,
    balance_conserving: true,
    transfer_entry_id: r.transfer_entry_id,
    entry_id: r.transfer_entry_id,
    applied_at: r.applied_at,
    already_applied: replayed
  });
}
__name(receipt2, "receipt");
async function decode(e, p) {
  try {
    const iv = Uint8Array.from(atob(p.payload_iv), (x2) => x2.charCodeAt(0));
    const cipher = Uint8Array.from(atob(p.payload_cipher), (x2) => x2.charCodeAt(0));
    if (iv.length !== 12 || cipher.length < 16 || cipher.length > 3e3) return null;
    const key2 = await crypto.subtle.importKey("raw", Uint8Array.from(
      e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),
      (x2) => parseInt(x2, 16)
    ), "AES-GCM", false, ["decrypt"]);
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: enc4.encode("kakeibo-bank-transfer:" + p.request_id)
    }, key2, cipher));
    if (!same2(await hash2(raw), p.payload_sha256)) return null;
    const x = JSON.parse(raw);
    if (!exact3(x, [
      "source_account_id",
      "source_version",
      "target_account_id",
      "target_version",
      "debit_date",
      "credit_date",
      "amount_jpy",
      "source_reference_hash",
      "target_reference_hash",
      "bank_debit_posted",
      "bank_credit_posted",
      "evidence_kind"
    ]) || x.source_account_id !== p.source_account_id || x.source_version !== p.source_version || x.target_account_id !== p.target_account_id || x.target_version !== p.target_version || !id.test(x.source_account_id) || !id.test(x.target_account_id) || x.source_account_id === x.target_account_id || !date(x.debit_date) || !date(x.credit_date) || x.debit_date > x.credit_date || x.credit_date > new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10) || !Number.isSafeInteger(x.amount_jpy) || x.amount_jpy < 1 || x.amount_jpy > 1e7 || !hex2.test(x.source_reference_hash) || !hex2.test(x.target_reference_hash) || x.bank_debit_posted !== true || x.bank_credit_posted !== true || x.evidence_kind !== "owner_attested_two_posted_bank_statements") return null;
    return x;
  } catch {
    return null;
  }
}
__name(decode, "decode");
async function proof(e, b, version) {
  const wire = {
    ...Object.fromEntries(fields.map((k) => [k, b[k]])),
    idempotency_key: "kakeibo:bank-transfer:" + b.resource_id,
    expected_version: version,
    purpose: "execute",
    execution_nonce: b.execution_nonce
  };
  const raw = JSON.stringify(wire), stamp = String(Date.now());
  try {
    const res = await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
      new URL("/api/internal/approvals/verify", e.HOMEFLOW_OAUTH_ORIGIN),
      {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "x-approval-client": "kakeibo-bank-transfer",
          "x-approval-timestamp": stamp,
          "x-approval-signature": await mac2(
            e.KAKEIBO_BANK_TRANSFER_PROOF_SECRET,
            "kakeibo-bank-transfer:execution-proof",
            stamp,
            raw
          )
        },
        body: raw
      }
    ));
    if (res.status !== 200 || res.headers.has("location")) return null;
    const text = await res.text();
    if (text.length > 1900) return null;
    const x = JSON.parse(text);
    return x?.ok === true && x.verified === true && x.execution_authorized === true && x.execution_status === "executing" && x.source_app === "kakebo" && x.target_app === "kakebo" && x.operation === "finance.asset_transfer.bank_to_bank" && x.resource_type === "bank_transfer_posted" && x.idempotency_key === wire.idempotency_key && x.expected_version === version && x.request_id === b.request_id && x.resource_id === b.resource_id && x.household_id === b.household_id && x.requester_user_id === b.requester_user_id && x.payload_sha256 === b.payload_sha256 && x.approver_user_id && x.approver_user_id !== b.requester_user_id && Number.isSafeInteger(x.approved_at) && Number.isSafeInteger(x.expires_at) && x.expires_at > Date.now() && x.applied === false ? x : null;
  } catch {
    return null;
  }
}
__name(proof, "proof");
async function approvedBankTransferRoute(req, e, parts) {
  if (!ready2(e)) return fail2("BANK_TRANSFER_EXECUTION_DISABLED", 503);
  if (parts.length !== 1 || !["execute", "receipt"].includes(parts[0])) return fail2("NOT_FOUND", 404);
  const mode = parts[0], b = await signed(req, e, mode);
  if (!b) return fail2("BANK_TRANSFER_UNAUTHORIZED", 403);
  const db = e.DB;
  const cross = e.KAKEIBO_CROSS_MEMBER_BANK_ENABLED === "true" ? await db.prepare("SELECT request_id FROM family_cross_bank_intents WHERE request_id=? LIMIT 1").bind(b.resource_id).first() : null;
  const crossJournal = e.KAKEIBO_CROSS_MEMBER_BANK_ENABLED === "true" ? await db.prepare("SELECT homeflow_request_id FROM family_cross_bank_journal WHERE homeflow_request_id=? LIMIT 1").bind(b.request_id).first() : null;
  if (cross || crossJournal) return crossMemberBankExecution(e, b, mode);
  const prior = await db.prepare("SELECT * FROM family_bank_transfers_applied WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1").bind(b.request_id, b.resource_id).first();
  if (prior) return identity(prior, b) ? receipt2(db, prior, b, true) : fail2("BANK_TRANSFER_RECEIPT_CONFLICT");
  if (mode === "receipt") return fail2("BANK_TRANSFER_RECEIPT_UNKNOWN", 404);
  const row = await db.prepare("SELECT i.*,src.version AS live_src,src.is_archived AS src_archived,src.account_kind AS src_kind,src.origin AS src_origin,src.household_id AS src_hh,src.owner_user_id AS src_owner,dst.version AS live_dst,dst.is_archived AS dst_archived,dst.account_kind AS dst_kind,dst.origin AS dst_origin,dst.household_id AS dst_hh,dst.owner_user_id AS dst_owner,member.role AS member_role,member.state AS member_state FROM family_bank_transfer_intents i JOIN family_financial_accounts src ON src.account_id=i.source_account_id JOIN family_financial_accounts dst ON dst.account_id=i.target_account_id JOIN homeflow_identity_links member ON member.user_id=i.requester_user_id WHERE i.request_id=? AND i.homeflow_approval_id=? LIMIT 1").bind(b.resource_id, b.request_id).first();
  if (!row || row.status !== "submitted" || row.expires_at <= Date.now() || row.household_id !== b.household_id || row.requester_user_id !== b.requester_user_id || row.payload_sha256 !== b.payload_sha256 || row.source_account_id === row.target_account_id || row.live_src !== row.source_version || row.live_dst !== row.target_version || row.src_archived !== 0 || row.dst_archived !== 0 || row.src_kind !== "bank" || row.dst_kind !== "bank" || row.src_origin !== "member_created" || row.dst_origin !== "member_created" || row.src_hh !== b.household_id || row.dst_hh !== b.household_id || row.src_owner !== b.requester_user_id || row.dst_owner !== b.requester_user_id || row.member_role !== "member" || row.member_state !== "active")
    return fail2("BANK_TRANSFER_ACCOUNT_OR_MEMBER_CHANGED");
  const payload2 = await decode(e, row), approved = payload2 && await proof(e, b, row.source_version);
  if (!payload2 || !approved) return fail2("BANK_TRANSFER_PAYLOAD_OR_APPROVAL_INVALID");
  const at = Date.now(), evidenceId = unique(), clientId = "hfbanktransfer:" + b.request_id;
  const actions = [
    db.prepare("INSERT INTO family_bank_transfer_posted_evidence (evidence_id,household_id,source_account_id,source_version,target_account_id,target_version,source_reference_hash,target_reference_hash,debit_date,credit_date,amount_jpy,bank_debit_posted,bank_credit_posted,evidence_kind,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,1,'owner_attested_two_posted_bank_statements',?)").bind(
      evidenceId,
      b.household_id,
      row.source_account_id,
      row.source_version,
      row.target_account_id,
      row.target_version,
      payload2.source_reference_hash,
      payload2.target_reference_hash,
      payload2.debit_date,
      payload2.credit_date,
      payload2.amount_jpy,
      at
    ),
    db.prepare("INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) VALUES(?,'',?,'\u8CC7\u7523\u79FB\u52D5','\u9280\u884C\u632F\u66FF','\u78BA\u8A8D\u6E08\u632F\u66FF','','transfer',?,1,?,?,?,?,?)").bind(
      payload2.debit_date,
      payload2.amount_jpy,
      "bank:" + row.target_account_id,
      payload2.credit_date,
      clientId,
      "bank:" + row.source_account_id,
      row.source_account_id,
      row.target_account_id
    ),
    db.prepare("INSERT INTO family_bank_transfers_applied (homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,actor_user_id,source_account_id,source_version,target_account_id,target_version,payload_sha256,evidence_id,transfer_entry_id,amount_jpy,debit_date,credit_date,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,(SELECT id FROM entries WHERE client_request_id=?),?,?,?,?)").bind(
      b.request_id,
      b.resource_id,
      b.household_id,
      b.requester_user_id,
      approved.approver_user_id,
      approved.approver_user_id,
      row.source_account_id,
      row.source_version,
      row.target_account_id,
      row.target_version,
      b.payload_sha256,
      evidenceId,
      clientId,
      payload2.amount_jpy,
      payload2.debit_date,
      payload2.credit_date,
      at
    ),
    db.prepare("INSERT INTO family_bank_transfer_actor_audit (event_id,homeflow_request_id,requester_user_id,approver_user_id,actor_user_id,action,created_at) VALUES(?,?,?,?,?,'posted_bank_to_bank_transfer_applied',?)").bind(
      unique(),
      b.request_id,
      b.requester_user_id,
      approved.approver_user_id,
      approved.approver_user_id,
      at
    )
  ];
  try {
    const result2 = await db.batch(actions);
    if (result2.length !== actions.length || result2.some((x) => x.meta?.changes !== 1))
      return fail2("BANK_TRANSFER_ATOMIC_CONFIRMATION_REQUIRED", 503);
  } catch {
    const raced = await db.prepare("SELECT * FROM family_bank_transfers_applied WHERE homeflow_request_id=?").bind(b.request_id).first().catch(() => null);
    return identity(raced, b) ? receipt2(db, raced, b, true) : fail2("BANK_TRANSFER_TRANSACTION_RETRY", 503);
  }
  const saved = await db.prepare("SELECT * FROM family_bank_transfers_applied WHERE homeflow_request_id=?").bind(b.request_id).first();
  return identity(saved, b) ? receipt2(db, saved, b, false) : fail2("BANK_TRANSFER_RECEIPT_UNCONFIRMED", 503);
}
__name(approvedBankTransferRoute, "approvedBankTransferRoute");

// functions/api/internal/future-paid-registration.js
var enc5 = new TextEncoder();
var hash3 = /* @__PURE__ */ __name(async (x) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc5.encode(x)))].map((b) => b.toString(16).padStart(2, "0")).join(""), "hash");
async function futurePaidRegistrationCommands(db, {
  householdId: householdId2,
  memberUserId,
  requestId,
  kind,
  accountId,
  date: date8,
  amount,
  category,
  merchant,
  note,
  at
}) {
  if (!["credit_card", "prepaid"].includes(kind) || !requestId || !memberUserId || !householdId2 || !accountId || !Number.isSafeInteger(amount) || amount < 1)
    throw Error("FUTURE_PAID_REGISTRATION_INVALID");
  const resourceId = (await hash3("kakeibo:future-paid:" + requestId)).slice(0, 32);
  const reference = "hf" + (kind === "credit_card" ? "card" : "prepaid") + ":" + requestId;
  const snapshot = JSON.stringify({
    date: date8,
    time: "",
    amount,
    type: "expense",
    category,
    merchant,
    note,
    payment_source: (kind === "credit_card" ? "cc:" : "prepaid:") + accountId
  });
  const payloadSha = await hash3(snapshot);
  const statements = [
    db.prepare("INSERT INTO family_shared_entry_write_context (resource_id,entry_id,actor_user_id,action,expected_version,stamp) SELECT ?,id,?,'create',0,? FROM entries WHERE client_request_id=?").bind(resourceId, memberUserId, at, reference),
    db.prepare("INSERT INTO family_shared_entry_registry (resource_id,household_id,entry_id,creator_user_id,last_actor_user_id,state,version,snapshot_json,payload_sha256,created_at,updated_at) SELECT ?,?,id,?,?,'active',1,?,?,?,? FROM entries WHERE client_request_id=?").bind(resourceId, householdId2, memberUserId, memberUserId, snapshot, payloadSha, at, at, reference),
    db.prepare("DELETE FROM family_shared_entry_write_context WHERE resource_id=?").bind(resourceId)
  ];
  return { resourceId, statements };
}
__name(futurePaidRegistrationCommands, "futurePaidRegistrationCommands");

// functions/api/internal/card-purchases/[[path]].js
var enc6 = new TextEncoder();
var hex3 = /^[a-f0-9]{64}$/i;
var uuid4 = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
var id322 = /^[a-f0-9]{32}$/i;
var reply2 = /* @__PURE__ */ __name((v, status = 200) => Response.json(v, { status, headers: { "cache-control": "no-store" } }), "reply");
var fail3 = /* @__PURE__ */ __name((code, status = 409) => reply2({ ok: false, code, applied: false }, status), "fail");
var hash4 = /* @__PURE__ */ __name(async (s) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", enc6.encode(s))),
  (x) => x.toString(16).padStart(2, "0")
).join(""), "hash");
var newid = /* @__PURE__ */ __name(() => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join(""), "newid");
var exact4 = /* @__PURE__ */ __name((o, keys) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join(",") === keys.slice().sort().join(","), "exact");
var equal = /* @__PURE__ */ __name((a, b) => typeof a === "string" && typeof b === "string" && hex3.test(a) && hex3.test(b) && a.length === b.length && Array.from(a).reduce((d, x, i) => d | x.charCodeAt(0) ^ b.charCodeAt(i), 0) === 0, "equal");
function enabled2(e) {
  return e.APP_ENV === "production" && e.KAKEIBO_FAMILY_FINANCE_ENABLED === "true" && e.KAKEIBO_CARD_PURCHASES_ENABLED === "true" && hex3.test(e.KAKEIBO_FAMILY_PENDING_KEY || "") && hex3.test(e.KAKEIBO_CARD_EXECUTION_SECRET || "") && hex3.test(e.KAKEIBO_CARD_PROOF_SECRET || "") && typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch === "function" && /^https:\/\/[A-Za-z0-9.-]+$/.test(e.HOMEFLOW_OAUTH_ORIGIN || "") && !!e.DB?.prepare;
}
__name(enabled2, "enabled");
async function mac3(secret, domain, stamp, raw) {
  const key2 = await crypto.subtle.importKey("raw", Uint8Array.from(
    secret.match(/.{2}/g),
    (x) => parseInt(x, 16)
  ), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const b = await crypto.subtle.sign("HMAC", key2, enc6.encode(domain + "\n" + stamp + "\n" + raw));
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
}
__name(mac3, "mac");
function cardClosingMonth(date8, closingDay) {
  if (typeof date8 !== "string" || !/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date8)) return null;
  const stamp = /* @__PURE__ */ new Date(date8 + "T00:00:00.000Z");
  if (!Number.isFinite(stamp.getTime()) || stamp.toISOString().slice(0, 10) !== date8) return null;
  const year = stamp.getUTCFullYear(), month2 = stamp.getUTCMonth() + 1, day = stamp.getUTCDate();
  if (closingDay !== null && (!Number.isInteger(closingDay) || closingDay < 0 || closingDay > 31)) return null;
  const last = new Date(Date.UTC(year, month2, 0)).getUTCDate();
  const cutoff = closingDay === null || closingDay === 0 ? last : Math.min(closingDay, last);
  const closeDate = day > cutoff ? new Date(Date.UTC(year, month2, 1)) : new Date(Date.UTC(year, month2 - 1, 1));
  return closeDate.toISOString().slice(0, 7);
}
__name(cardClosingMonth, "cardClosingMonth");
async function sealed(env, row) {
  try {
    const iv = Uint8Array.from(atob(row.payload_iv), (x) => x.charCodeAt(0));
    const cipher = Uint8Array.from(atob(row.payload_cipher), (x) => x.charCodeAt(0));
    if (iv.length !== 12 || cipher.length > 3500 || cipher.length < 16) return null;
    const key2 = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(
        env.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),
        (x) => parseInt(x, 16)
      ),
      "AES-GCM",
      false,
      ["decrypt"]
    );
    const bytes = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: enc6.encode("kakeibo-card:" + row.request_id)
    }, key2, cipher);
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!equal(await hash4(raw), row.payload_sha256)) return null;
    const p = JSON.parse(raw);
    if (!exact4(p, ["account_id", "account_version", "type", "date", "amount_jpy", "merchant", "category", "note"]) || p.account_id !== row.account_id || p.account_version !== row.account_version || p.type !== "expense" || cardClosingMonth(p.date, row.closing_day) === null || !Number.isSafeInteger(p.amount_jpy) || p.amount_jpy < 1 || p.amount_jpy > 1e7 || typeof p.merchant !== "string" || !p.merchant.trim() || p.merchant.length > 160 || typeof p.category !== "string" || !p.category.trim() || p.category.length > 40 || typeof p.note !== "string" || p.note.length > 300) return null;
    return p;
  } catch {
    return null;
  }
}
__name(sealed, "sealed");
var core = ["request_id", "resource_id", "household_id", "requester_user_id", "payload_sha256"];
async function signed2(req, env, mode) {
  if (req.method !== "POST" || req.headers.has("cookie") || req.headers.has("origin") || req.headers.has("authorization") || req.headers.get("x-approval-client") !== "homeflow" || req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    return null;
  const timestamp = req.headers.get("x-approval-timestamp") || "";
  const sig = req.headers.get("x-approval-signature") || "";
  if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 3e5 || !hex3.test(sig))
    return null;
  let raw, b;
  try {
    raw = await req.text();
    if (raw.length > 1800) return null;
    b = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!exact4(b, mode === "execute" ? [...core, "execution_nonce"] : core) || !uuid4.test(b.request_id) || !id322.test(b.resource_id) || !hex3.test(b.payload_sha256) || mode === "execute" && !hex3.test(b.execution_nonce) || typeof b.household_id !== "string" || !b.household_id || b.household_id.length > 128 || typeof b.requester_user_id !== "string" || !b.requester_user_id || b.requester_user_id.length > 128) return null;
  const expected = await mac3(
    env.KAKEIBO_CARD_EXECUTION_SECRET,
    "homeflow:card-" + mode,
    timestamp,
    raw
  );
  return equal(expected, sig) ? b : null;
}
__name(signed2, "signed");
var shape = /* @__PURE__ */ __name((row, replay) => ({
  ok: true,
  applied: true,
  approval_id: row.homeflow_request_id,
  proposal_id: row.proposal_id,
  household_id: row.household_id,
  requester_user_id: row.requester_user_id,
  payload_sha256: row.payload_sha256,
  entry_id: row.entry_id,
  approver_user_id: row.approver_user_id,
  account_id: row.account_id,
  account_version: row.account_version,
  amount_jpy: row.amount_jpy,
  bill_month: row.bill_month,
  applied_at: row.applied_at,
  already_applied: replay
}), "shape");
var identity2 = /* @__PURE__ */ __name((r, b) => !!r && r.homeflow_request_id === b.request_id && r.proposal_id === b.resource_id && r.household_id === b.household_id && r.requester_user_id === b.requester_user_id && r.payload_sha256 === b.payload_sha256, "identity");
async function proof2(env, b, version) {
  const query = {
    ...Object.fromEntries(core.map((k) => [k, b[k]])),
    idempotency_key: "kakeibo:card:" + b.resource_id,
    expected_version: version,
    purpose: "execute",
    execution_nonce: b.execution_nonce
  };
  const raw = JSON.stringify(query), stamp = String(Date.now());
  try {
    const response3 = await env.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
      new URL("/api/internal/approvals/verify", env.HOMEFLOW_OAUTH_ORIGIN),
      {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "x-approval-client": "kakeibo-card",
          "x-approval-timestamp": stamp,
          "x-approval-signature": await mac3(
            env.KAKEIBO_CARD_PROOF_SECRET,
            "kakeibo-card:execution-proof",
            stamp,
            raw
          )
        },
        body: raw
      }
    ));
    if (response3.status !== 200 || response3.headers.has("location")) return null;
    const text = await response3.text();
    if (text.length > 1900) return null;
    const p = JSON.parse(text);
    return p?.ok === true && p.verified === true && p.execution_authorized === true && p.execution_status === "executing" && p.source_app === "kakebo" && p.target_app === "kakebo" && p.operation === "finance.credit_card.purchase" && p.resource_type === "credit_card_purchase" && p.request_id === b.request_id && p.resource_id === b.resource_id && p.household_id === b.household_id && p.requester_user_id === b.requester_user_id && p.payload_sha256 === b.payload_sha256 && p.idempotency_key === query.idempotency_key && p.expected_version === version && p.approver_user_id && p.approver_user_id !== b.requester_user_id && Number.isSafeInteger(p.approved_at) && Number.isSafeInteger(p.expires_at) && p.expires_at > Date.now() && p.applied === false ? p : null;
  } catch {
    return null;
  }
}
__name(proof2, "proof");
async function approvedCardPurchaseRoute(req, env, parts) {
  if (!enabled2(env)) return fail3("CARD_EXECUTION_DISABLED", 503);
  if (parts.length !== 1 || !["execute", "receipt"].includes(parts[0])) return fail3("NOT_FOUND", 404);
  const mode = parts[0], b = await signed2(req, env, mode);
  if (!b) return fail3("CARD_UNAUTHORIZED", 403);
  const db = env.DB;
  const existing = await db.prepare("SELECT * FROM family_card_purchase_applied WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1").bind(b.request_id, b.resource_id).first();
  if (existing) return identity2(existing, b) ? reply2(shape(existing, true)) : fail3("CARD_RECEIPT_CONFLICT");
  if (mode === "receipt") return fail3("CARD_RECEIPT_UNKNOWN", 404);
  const row = await db.prepare("SELECT p.*,a.account_kind,a.version AS live_version,a.owner_user_id,a.household_id AS account_household,a.is_archived,a.origin,a.closing_day,m.role AS requester_role,m.state AS requester_state FROM family_card_purchase_intents p JOIN family_financial_accounts a ON a.account_id=p.account_id JOIN homeflow_identity_links m ON m.user_id=p.requester_user_id WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1").bind(b.resource_id, b.request_id).first();
  if (!row || row.status !== "submitted" || row.requester_user_id !== b.requester_user_id || row.household_id !== b.household_id || row.payload_sha256 !== b.payload_sha256 || row.owner_user_id !== b.requester_user_id || row.account_household !== b.household_id || row.account_kind !== "credit_card" || row.origin !== "member_created" || row.is_archived !== 0 || row.account_version !== row.live_version || row.requester_role !== "member" || row.requester_state !== "active" || row.expires_at <= Date.now())
    return fail3("CARD_SOURCE_OR_VERSION_CHANGED");
  const p = await sealed(env, row), approved = p && await proof2(env, b, row.account_version);
  if (!p || !approved) return fail3("CARD_SOURCE_OR_APPROVAL_INVALID");
  const billMonth = cardClosingMonth(p.date, row.closing_day), clientId = "hfcard:" + b.request_id, at = Date.now();
  if (!billMonth) return fail3("CARD_BILL_PERIOD_INVALID");
  const registry = env.KAKEIBO_ACCOUNT_CORRECTIONS_ENABLED === "true" ? await futurePaidRegistrationCommands(db, {
    householdId: b.household_id,
    memberUserId: b.requester_user_id,
    requestId: b.request_id,
    kind: "credit_card",
    accountId: row.account_id,
    date: p.date,
    amount: p.amount_jpy,
    category: p.category,
    merchant: p.merchant,
    note: p.note,
    at
  }) : null;
  try {
    const changes = await db.batch([
      db.prepare("INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id) SELECT ?,'',?,?,?,?,?,'expense',NULL,0,NULL,?,?,? WHERE EXISTS(SELECT 1 FROM family_financial_accounts a JOIN family_card_purchase_intents p ON p.account_id=a.account_id JOIN homeflow_identity_links l ON l.user_id=a.owner_user_id WHERE p.request_id=? AND p.status='submitted' AND p.homeflow_approval_id=? AND p.payload_sha256=? AND a.version=? AND a.is_archived=0 AND a.owner_user_id=? AND a.account_kind='credit_card' AND a.origin='member_created' AND l.state='active' AND l.role='member') ON CONFLICT(client_request_id) DO NOTHING").bind(
        p.date,
        p.amount_jpy,
        p.category,
        p.merchant,
        p.note,
        "",
        clientId,
        "cc:" + row.account_id,
        row.account_id,
        b.resource_id,
        b.request_id,
        b.payload_sha256,
        row.account_version,
        b.requester_user_id
      ),
      db.prepare("INSERT INTO family_card_purchase_applied(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,account_id,account_version,payload_sha256,client_request_id,entry_id,amount_jpy,purchase_date,bill_month,applied_at) VALUES(?,?,?,?,?,?,?,?,?,(SELECT id FROM entries WHERE client_request_id=? AND family_account_id=? AND payment_source=? AND type='expense' AND date=? AND amount=? AND category=? AND merchant=? AND note=? LIMIT 1),?,?,?,?)").bind(
        b.request_id,
        b.resource_id,
        b.household_id,
        b.requester_user_id,
        approved.approver_user_id,
        row.account_id,
        row.account_version,
        b.payload_sha256,
        clientId,
        clientId,
        row.account_id,
        "cc:" + row.account_id,
        p.date,
        p.amount_jpy,
        p.category,
        p.merchant,
        p.note,
        p.amount_jpy,
        p.date,
        billMonth,
        at
      ),
      db.prepare("INSERT INTO family_card_purchase_audit(event_id,homeflow_request_id,requester_user_id,approver_user_id,action,created_at) SELECT ?,?,?,?,'credit_card_purchase_applied',? WHERE changes()=1").bind(newid(), b.request_id, b.requester_user_id, approved.approver_user_id, at),
      ...registry?.statements || []
    ]);
    if (changes.length !== 3 + (registry?.statements.length || 0) || changes.some((x) => x.meta?.changes !== 1))
      return fail3("CARD_TRANSACTION_UNCONFIRMED", 503);
  } catch {
    const raced = await db.prepare("SELECT * FROM family_card_purchase_applied WHERE homeflow_request_id=?").bind(b.request_id).first().catch(() => null);
    return identity2(raced, b) ? reply2(shape(raced, true)) : fail3("CARD_TRANSACTION_RETRY", 503);
  }
  const recorded = await db.prepare("SELECT * FROM family_card_purchase_applied WHERE homeflow_request_id=?").bind(b.request_id).first();
  return identity2(recorded, b) ? reply2(shape(recorded, false)) : fail3("CARD_RECEIPT_UNCONFIRMED", 503);
}
__name(approvedCardPurchaseRoute, "approvedCardPurchaseRoute");
var onRequest2 = /* @__PURE__ */ __name(({ request, env, params }) => approvedCardPurchaseRoute(request, env, params.path || []), "onRequest");

// functions/api/internal/points-actions/points-execution.js
var enc7 = new TextEncoder();
var hash64 = /^[a-f0-9]{64}$/i;
var id2 = /^[a-f0-9]{32}$/i;
var uuid5 = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
var supported = /* @__PURE__ */ new Set(["earn_campaign", "earn_purchase", "redeem_discount", "redeem_purchase", "expire", "transfer_prepaid", "offset_card", "transfer_out", "exchange_out", "reversal", "redeem_asset"]);
var json3 = /* @__PURE__ */ __name((body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } }), "json");
var fail4 = /* @__PURE__ */ __name((code, status = 409) => json3({ ok: false, code, applied: false }, status), "fail");
var exact5 = /* @__PURE__ */ __name((x, keys) => x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).sort().join(",") === keys.slice().sort().join(","), "exact");
var sha2 = /* @__PURE__ */ __name(async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc7.encode(s)))].map((n) => n.toString(16).padStart(2, "0")).join(""), "sha");
async function hmac2(secret, domain, stamp, raw) {
  const key2 = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(secret.match(/.{2}/g), (x) => parseInt(x, 16)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key2, enc7.encode(domain + "\n" + stamp + "\n" + raw)))].map((n) => n.toString(16).padStart(2, "0")).join("");
}
__name(hmac2, "hmac");
var eq = /* @__PURE__ */ __name((a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && [...a].reduce((n, c, i) => n | c.charCodeAt(0) ^ b.charCodeAt(i), 0) === 0, "eq");
var ready3 = /* @__PURE__ */ __name((e) => e.APP_ENV === "production" && e.KAKEIBO_FAMILY_FINANCE_ENABLED === "true" && e.KAKEIBO_POINTS_ACTIONS_ENABLED === "true" && e.DB?.prepare && hash64.test(e.KAKEIBO_FAMILY_PENDING_KEY || "") && hash64.test(e.KAKEIBO_POINTS_EXECUTION_SECRET || "") && hash64.test(e.KAKEIBO_POINTS_PROOF_SECRET || "") && typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch === "function" && /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN || ""), "ready");
var core2 = ["request_id", "resource_id", "household_id", "requester_user_id", "payload_sha256"];
async function signed3(req, e, mode) {
  if (req.method !== "POST" || req.headers.has("origin") || req.headers.has("cookie") || req.headers.has("authorization") || req.headers.get("x-approval-client") !== "homeflow" || req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return null;
  const stamp = req.headers.get("x-approval-timestamp") || "", tag = req.headers.get("x-approval-signature") || "";
  if (!/^\d{13}$/.test(stamp) || Math.abs(Date.now() - Number(stamp)) > 3e5 || !hash64.test(tag)) return null;
  let raw, b;
  try {
    raw = await req.text();
    if (raw.length > 1600) return null;
    b = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!exact5(b, mode === "execute" ? [...core2, "execution_nonce"] : core2) || !uuid5.test(b.request_id) || !id2.test(b.resource_id) || !hash64.test(b.payload_sha256) || mode === "execute" && !hash64.test(b.execution_nonce) || !b.household_id || typeof b.household_id !== "string" || b.household_id.length > 128 || typeof b.requester_user_id !== "string" || !b.requester_user_id || b.requester_user_id.length > 128) return null;
  const expected = await hmac2(e.KAKEIBO_POINTS_EXECUTION_SECRET, "homeflow:points-" + mode, stamp, raw);
  return eq(tag, expected) ? b : null;
}
__name(signed3, "signed");
var receipt3 = /* @__PURE__ */ __name((r, replayed, credit = null, card = null, move = null, sbi = null, transferRefund = null, prepaidRefund = null, cardRefund = null, sbiRefund = null) => ({
  ok: true,
  applied: true,
  approval_id: r.homeflow_request_id,
  proposal_id: r.proposal_id,
  household_id: r.household_id,
  requester_user_id: r.requester_user_id,
  payload_sha256: r.payload_sha256,
  approver_user_id: r.approver_user_id,
  actor_user_id: r.actor_user_id,
  points_account_id: r.points_account_id,
  points_version: r.account_version,
  operation: r.operation,
  delta_units: r.delta_units,
  balance_after_units: r.balance_after_units,
  yen_value: r.yen_value,
  linked_entry_id: r.linked_entry_id,
  reversed_request_id: r.reversed_request_id,
  applied_at: r.applied_at,
  already_applied: replayed,
  target_account_id: r.target_account_id,
  prepaid_version: credit?.prepaid_version ?? null,
  prepaid_credit_jpy: credit?.amount_jpy ?? null,
  prepaid_balance_after_jpy: credit?.balance_after_jpy ?? null,
  card_version: card?.card_version ?? null,
  card_offset_jpy: card?.amount_jpy ?? null,
  card_remaining_after_jpy: card?.remaining_after_jpy ?? null,
  card_purchase_request_id: card?.purchase_request_id ?? null,
  transfer_target_units: move?.target_units ?? null,
  transfer_target_balance_after_units: move?.target_balance_after_units ?? null,
  transfer_target_version: move?.target_version ?? null,
  transfer_target_rate_numerator: move?.target_rate_numerator ?? null,
  transfer_target_rate_denominator: move?.target_rate_denominator ?? null,
  sbi_securities_version: sbi?.securities_version ?? null,
  sbi_fund_code: sbi?.fund_code ?? null,
  sbi_account_type: sbi?.account_type ?? null,
  sbi_confirmed_units: sbi?.confirmed_units ?? null,
  sbi_acquisition_cost_jpy: sbi?.acquisition_cost_jpy ?? null,
  sbi_total_units_after: sbi?.total_units_after ?? null,
  sbi_total_cost_after_jpy: sbi?.total_cost_after_jpy ?? null,
  sbi_trade_date: sbi?.trade_date ?? null,
  sbi_reference_hash: sbi?.broker_reference_hash ?? null,
  sbi_evidence_kind: sbi?.evidence_kind ?? null,
  refunded_target_account_id: transferRefund?.target_account_id ?? null,
  refunded_target_units: transferRefund?.debited_target_units ?? null,
  refunded_target_balance_after_units: transferRefund?.target_balance_after_units ?? null,
  refunded_target_version: transferRefund?.target_version ?? null,
  refunded_prepaid_account_id: prepaidRefund?.prepaid_account_id ?? null,
  refunded_prepaid_jpy: prepaidRefund?.debited_prepaid_jpy ?? null,
  refunded_prepaid_balance_after_jpy: prepaidRefund?.balance_after_jpy ?? null,
  refunded_prepaid_version: prepaidRefund?.prepaid_version ?? null,
  refunded_card_account_id: cardRefund?.card_account_id ?? null,
  refunded_card_version: cardRefund?.card_version ?? null,
  refunded_card_purchase_request_id: cardRefund?.purchase_request_id ?? null,
  refunded_card_offset_jpy: cardRefund?.restored_jpy ?? null,
  refunded_card_liability_after_jpy: cardRefund?.liability_after_jpy ?? null,
  refunded_sbi_securities_account_id: sbiRefund?.securities_account_id ?? null,
  refunded_sbi_securities_version: sbiRefund?.securities_version ?? null,
  refunded_sbi_units: sbiRefund?.reversed_units ?? null,
  refunded_sbi_cost_jpy: sbiRefund?.reversed_cost_jpy ?? null,
  refunded_sbi_points_units: sbiRefund?.refunded_points_units ?? null,
  refunded_sbi_broker_cancel_hash: sbiRefund?.broker_cancel_hash ?? null,
  refunded_sbi_issuer_reference_hash: sbiRefund?.points_refund_hash ?? null,
  refunded_sbi_broker_cancel_date: sbiRefund?.broker_cancel_date ?? null,
  refunded_sbi_points_returned_date: sbiRefund?.points_refund_date ?? null,
  refunded_sbi_evidence_kind: sbiRefund?.evidence_kind ?? null,
  refunded_sbi_fund_code: sbiRefund?.fund_code ?? null,
  refunded_sbi_account_type: sbiRefund?.account_type ?? null,
  refunded_sbi_original_trade_hash: sbiRefund?.broker_reference_hash ?? null
}), "receipt");
async function receiptFor(db, r, replayed) {
  if (r.operation === "reversal" && r.target_account_id) {
    const compensating = await db.prepare("SELECT * FROM family_points_transfer_refunds WHERE homeflow_request_id=?").bind(r.homeflow_request_id).first();
    if (compensating) {
      if (compensating.original_request_id !== r.reversed_request_id || compensating.source_account_id !== r.points_account_id || compensating.target_account_id !== r.target_account_id || compensating.household_id !== r.household_id || compensating.requester_user_id !== r.requester_user_id || compensating.yen_value !== r.yen_value)
        return fail4("POINTS_TRANSFER_REFUND_COUNTERPART_MISSING", 503);
      return json3(receipt3(r, replayed, null, null, null, null, compensating));
    }
    const prepaid = await db.prepare("SELECT * FROM family_points_prepaid_refunds WHERE homeflow_request_id=?").bind(r.homeflow_request_id).first();
    if (prepaid) {
      if (prepaid.original_request_id !== r.reversed_request_id || prepaid.points_account_id !== r.points_account_id || prepaid.prepaid_account_id !== r.target_account_id || prepaid.household_id !== r.household_id || prepaid.requester_user_id !== r.requester_user_id || prepaid.debited_prepaid_jpy !== r.yen_value)
        return fail4("POINTS_PREPAID_REFUND_COUNTERPART_MISSING", 503);
      return json3(receipt3(r, replayed, null, null, null, null, null, prepaid));
    }
    const cardRefund = await db.prepare("SELECT * FROM family_points_card_offset_refunds WHERE homeflow_request_id=?").bind(r.homeflow_request_id).first();
    if (!cardRefund) {
      const sbiRefund = await db.prepare("SELECT * FROM family_sbi_point_refunds WHERE homeflow_request_id=?").bind(r.homeflow_request_id).first();
      const original = sbiRefund ? await db.prepare("SELECT * FROM family_sbi_point_lots WHERE homeflow_request_id=?").bind(r.reversed_request_id).first() : null;
      if (!sbiRefund || !original || sbiRefund.original_request_id !== r.reversed_request_id || sbiRefund.points_account_id !== r.points_account_id || sbiRefund.securities_account_id !== r.target_account_id || sbiRefund.household_id !== r.household_id || sbiRefund.requester_user_id !== r.requester_user_id || sbiRefund.approver_user_id !== r.approver_user_id || sbiRefund.actor_user_id !== r.actor_user_id || sbiRefund.refunded_points_units !== r.delta_units || sbiRefund.reversed_cost_jpy !== r.yen_value || sbiRefund.reversed_units !== original.confirmed_units || sbiRefund.reversed_cost_jpy !== original.acquisition_cost_jpy || sbiRefund.points_refund_hash !== r.source_reference_hash || sbiRefund.created_at !== r.applied_at)
        return fail4("POINTS_SBI_REFUND_COUNTERPART_UNCONFIRMED", 503);
      return json3(receipt3(
        r,
        replayed,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        {
          ...sbiRefund,
          fund_code: original.fund_code,
          account_type: original.account_type,
          broker_reference_hash: original.broker_reference_hash
        }
      ));
    }
    if (cardRefund.original_request_id !== r.reversed_request_id || cardRefund.points_account_id !== r.points_account_id || cardRefund.card_account_id !== r.target_account_id || cardRefund.household_id !== r.household_id || cardRefund.requester_user_id !== r.requester_user_id || cardRefund.restored_jpy !== r.yen_value)
      return fail4("POINTS_CARD_REFUND_COUNTERPART_MISSING", 503);
    return json3(receipt3(r, replayed, null, null, null, null, null, null, cardRefund));
  }
  if (r.operation === "redeem_asset") {
    const lot = await db.prepare("SELECT * FROM family_sbi_point_lots WHERE homeflow_request_id=?").bind(r.homeflow_request_id).first();
    if (!lot || lot.points_account_id !== r.points_account_id || lot.securities_account_id !== r.target_account_id || lot.owner_user_id !== r.requester_user_id || lot.household_id !== r.household_id || lot.acquisition_cost_jpy !== r.yen_value || lot.recorded_at !== r.applied_at)
      return fail4("POINTS_SBI_LOT_UNCONFIRMED", 503);
    return json3(receipt3(r, replayed, null, null, null, lot));
  }
  if (r.operation === "transfer_out" || r.operation === "exchange_out") {
    const c2 = await db.prepare("SELECT * FROM family_points_transfer_credits WHERE homeflow_request_id=?").bind(r.homeflow_request_id).first();
    if (!c2 || c2.target_account_id !== r.target_account_id || c2.source_account_id !== r.points_account_id || c2.operation !== r.operation || c2.yen_value !== r.yen_value || c2.household_id !== r.household_id || c2.requester_user_id !== r.requester_user_id)
      return fail4("POINTS_TRANSFER_COUNTERPART_UNCONFIRMED", 503);
    return json3(receipt3(r, replayed, null, null, c2));
  }
  if (r.operation === "offset_card") {
    const c2 = await db.prepare("SELECT * FROM family_points_card_offsets WHERE homeflow_request_id=?").bind(r.homeflow_request_id).first();
    if (!c2 || c2.card_account_id !== r.target_account_id || c2.amount_jpy !== r.yen_value || c2.household_id !== r.household_id || c2.requester_user_id !== r.requester_user_id)
      return fail4("POINTS_COUNTERPART_UNCONFIRMED", 503);
    return json3(receipt3(r, replayed, null, c2));
  }
  if (r.operation !== "transfer_prepaid") return json3(receipt3(r, replayed));
  const c = await db.prepare("SELECT * FROM family_points_prepaid_credits WHERE homeflow_request_id=?").bind(r.homeflow_request_id).first();
  if (!c || c.prepaid_account_id !== r.target_account_id || c.amount_jpy !== r.yen_value || c.household_id !== r.household_id || c.requester_user_id !== r.requester_user_id)
    return fail4("POINTS_COUNTERPART_UNCONFIRMED", 503);
  return json3(receipt3(r, replayed, c));
}
__name(receiptFor, "receiptFor");
var match2 = /* @__PURE__ */ __name((r, b) => r && r.homeflow_request_id === b.request_id && r.proposal_id === b.resource_id && r.household_id === b.household_id && r.requester_user_id === b.requester_user_id && r.payload_sha256 === b.payload_sha256, "match");
async function decode2(e, p) {
  try {
    const iv = Uint8Array.from(atob(p.payload_iv), (x2) => x2.charCodeAt(0)), cipher = Uint8Array.from(atob(p.payload_cipher), (x2) => x2.charCodeAt(0));
    if (iv.length !== 12 || cipher.length < 16 || cipher.length > 4e3) return null;
    const key2 = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g), (x2) => parseInt(x2, 16)),
      "AES-GCM",
      false,
      ["decrypt"]
    );
    const b = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: enc7.encode("kakeibo-points:" + p.request_id)
    }, key2, cipher);
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(b);
    if (!eq(await sha2(raw), p.payload_sha256)) return null;
    const x = JSON.parse(raw);
    if (!exact5(x, [
      "operation",
      "points_account_id",
      "points_version",
      "units",
      "effective_date",
      "yen_value",
      "rate_numerator",
      "rate_denominator",
      "reference_hash",
      "linked_entry_id",
      "expense_net_confirmed",
      ...["transfer_prepaid", "offset_card", "transfer_out", "exchange_out", "redeem_asset"].includes(x.operation) ? ["target_account_id", "target_version"] : [],
      ...x.operation === "offset_card" ? ["target_purchase_request_id"] : [],
      ...x.operation === "reversal" ? [
        "original_request_id",
        ...x.sbi_reversal === true ? [
          "sbi_reversal",
          "sbi_securities_version",
          "sbi_broker_cancel_hash",
          "sbi_points_refund_hash",
          "sbi_broker_cancel_date",
          "sbi_points_refund_date",
          "sbi_broker_cancel_confirmed",
          "sbi_points_returned_confirmed"
        ] : []
      ] : [],
      ...x.operation === "redeem_asset" ? [
        "sbi_fund_code",
        "sbi_account_type",
        "sbi_confirmed_units",
        "sbi_broker_reference_hash",
        "sbi_broker_execution_attested"
      ] : [],
      ...["transfer_out", "exchange_out"].includes(x.operation) ? ["target_units", "target_rate_numerator", "target_rate_denominator"] : []
    ]) || !supported.has(x.operation) || x.operation !== p.operation || x.points_account_id !== p.points_account_id || x.points_version !== p.expected_version || !Number.isSafeInteger(x.units) || x.units < 1 || x.units > 1e9 || !hash64.test(x.reference_hash) || typeof x.effective_date !== "string" || !/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(x.effective_date) || (/* @__PURE__ */ new Date(x.effective_date + "T00:00:00Z")).toISOString().slice(0, 10) !== x.effective_date || x.effective_date > new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10)) return null;
    if (["earn_purchase", "redeem_discount", "redeem_purchase"].includes(x.operation) ? !Number.isSafeInteger(x.linked_entry_id) || x.linked_entry_id <= 0 : x.linked_entry_id !== null) return null;
    if (x.expense_net_confirmed !== (x.operation === "redeem_discount")) return null;
    if (["transfer_prepaid", "offset_card", "transfer_out", "exchange_out", "redeem_asset"].includes(x.operation) && (!id2.test(x.target_account_id) || x.target_account_id === x.points_account_id || !Number.isSafeInteger(x.target_version) || x.target_version < 1 || !Number.isSafeInteger(x.yen_value) || x.yen_value < 1 || x.yen_value > 1e7)) return null;
    if (x.operation === "offset_card" && !uuid5.test(x.target_purchase_request_id)) return null;
    if (x.operation === "reversal" && !uuid5.test(x.original_request_id)) return null;
    if (x.operation === "reversal" && x.sbi_reversal === true && (!Number.isSafeInteger(x.sbi_securities_version) || x.sbi_securities_version < 1 || !hash64.test(x.sbi_broker_cancel_hash) || !hash64.test(x.sbi_points_refund_hash) || x.sbi_broker_cancel_hash === x.sbi_points_refund_hash || !/^20\d\d-\d\d-\d\d$/.test(x.sbi_broker_cancel_date || "") || !/^20\d\d-\d\d-\d\d$/.test(x.sbi_points_refund_date || "") || x.sbi_broker_cancel_date > x.sbi_points_refund_date || x.sbi_points_refund_date > x.effective_date || x.sbi_broker_cancel_confirmed !== true || x.sbi_points_returned_confirmed !== true))
      return null;
    if (x.operation === "redeem_asset" && (!/^[A-Z0-9]{8}$/.test(x.sbi_fund_code || "") || !["growth", "tsumitate"].includes(x.sbi_account_type) || !Number.isSafeInteger(x.sbi_confirmed_units) || x.sbi_confirmed_units < 1 || x.sbi_confirmed_units > 1e12 || !hash64.test(x.sbi_broker_reference_hash) || x.sbi_broker_execution_attested !== true))
      return null;
    if (["transfer_out", "exchange_out"].includes(x.operation) && (!Number.isSafeInteger(x.target_units) || x.target_units < 1 || x.target_units > 1e9 || !Number.isSafeInteger(x.target_rate_numerator) || x.target_rate_numerator < 1 || x.target_rate_numerator > 1e9 || !Number.isSafeInteger(x.target_rate_denominator) || x.target_rate_denominator < 1 || x.target_rate_denominator > 1e9 || BigInt(x.target_units) * BigInt(x.target_rate_numerator) !== BigInt(x.yen_value) * BigInt(x.target_rate_denominator) || x.operation === "transfer_out" && (x.target_units !== x.units || x.target_rate_numerator !== x.rate_numerator || x.target_rate_denominator !== x.rate_denominator))) return null;
    if (x.yen_value !== null || x.rate_numerator !== null || x.rate_denominator !== null) {
      if (!Number.isSafeInteger(x.yen_value) || x.yen_value < 0 || x.yen_value > 1e9 || !Number.isSafeInteger(x.rate_numerator) || x.rate_numerator < 1 || x.rate_numerator > 1e9 || !Number.isSafeInteger(x.rate_denominator) || x.rate_denominator < 1 || x.rate_denominator > 1e9 || BigInt(x.yen_value) * BigInt(x.rate_denominator) !== BigInt(x.units) * BigInt(x.rate_numerator)) return null;
    }
    return x;
  } catch {
    return null;
  }
}
__name(decode2, "decode");
async function proof3(e, b, p) {
  const x = {
    ...Object.fromEntries(core2.map((k) => [k, b[k]])),
    idempotency_key: "kakeibo:points:" + b.resource_id,
    expected_version: p.expected_version,
    purpose: "execute",
    execution_nonce: b.execution_nonce
  };
  const raw = JSON.stringify(x), stamp = String(Date.now());
  try {
    const response3 = await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
      new URL("/api/internal/approvals/verify", e.HOMEFLOW_OAUTH_ORIGIN),
      {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "x-approval-client": "kakeibo-points",
          "x-approval-timestamp": stamp,
          "x-approval-signature": await hmac2(
            e.KAKEIBO_POINTS_PROOF_SECRET,
            "kakeibo-points:execution-proof",
            stamp,
            raw
          )
        },
        body: raw
      }
    ));
    if (response3.status !== 200 || response3.headers.has("location")) return null;
    const rawResponse = await response3.text();
    if (rawResponse.length > 2e3) return null;
    const a = JSON.parse(rawResponse);
    return a?.ok === true && a.verified === true && a.execution_authorized === true && a.execution_status === "executing" && a.source_app === "kakebo" && a.target_app === "kakebo" && a.operation === "finance.points." + p.operation && a.resource_type === "points_action" && a.request_id === b.request_id && a.resource_id === b.resource_id && a.household_id === b.household_id && a.requester_user_id === b.requester_user_id && a.payload_sha256 === b.payload_sha256 && a.idempotency_key === x.idempotency_key && a.expected_version === p.expected_version && a.approver_user_id && a.approver_user_id !== b.requester_user_id && a.expires_at > Date.now() && a.applied === false ? a : null;
  } catch {
    return null;
  }
}
__name(proof3, "proof");
async function permittedPurchase(db, row, x) {
  if (!x.linked_entry_id) return x.operation !== "earn_purchase" && x.operation !== "redeem_discount" && x.operation !== "redeem_purchase";
  const entry = await db.prepare("SELECT type,family_account_id,payment_source FROM entries WHERE id=?").bind(x.linked_entry_id).first();
  if (entry?.type !== "expense" || x.operation === "redeem_purchase" && (entry.family_account_id !== row.points_account_id || entry.payment_source !== "points:" + row.points_account_id)) return false;
  if (entry.family_account_id) {
    const account2 = await db.prepare("SELECT owner_user_id,household_id FROM family_financial_accounts WHERE account_id=?").bind(entry.family_account_id).first();
    return account2?.owner_user_id === row.requester_user_id && account2.household_id === row.household_id;
  }
  const legacy = await db.prepare("SELECT a.owner_user_id,l.household_id FROM family_finance_legacy_entry_links l JOIN family_financial_accounts a ON a.account_id=l.account_id AND a.household_id=l.household_id WHERE l.entry_id=?").bind(x.linked_entry_id).first();
  return legacy?.owner_user_id === row.requester_user_id && legacy.household_id === row.household_id;
}
__name(permittedPurchase, "permittedPurchase");
async function approvedPointsRoute(request, e, parts) {
  if (!ready3(e)) return fail4("POINTS_EXECUTION_DISABLED", 503);
  if (parts.length !== 1 || !["execute", "receipt"].includes(parts[0])) return fail4("NOT_FOUND", 404);
  const mode = parts[0], b = await signed3(request, e, mode);
  if (!b) return fail4("POINTS_UNAUTHORIZED", 403);
  const db = e.DB;
  const prior = await db.prepare("SELECT * FROM family_points_journal WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1").bind(b.request_id, b.resource_id).first();
  if (prior) return match2(prior, b) ? receiptFor(db, prior, true) : fail4("POINTS_RECEIPT_CONFLICT");
  if (mode === "receipt") return fail4("POINTS_RECEIPT_UNKNOWN", 404);
  const row = await db.prepare("SELECT p.*,a.account_kind,a.origin,a.version,a.is_archived,a.opening_balance,a.owner_user_id,a.household_id AS account_household,u.role AS requester_role,u.state AS requester_state FROM family_points_intents p JOIN family_financial_accounts a ON a.account_id=p.points_account_id JOIN homeflow_identity_links u ON u.user_id=p.requester_user_id WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1").bind(b.resource_id, b.request_id).first();
  if (!row || row.status !== "submitted" || row.requester_user_id !== b.requester_user_id || row.household_id !== b.household_id || row.payload_sha256 !== b.payload_sha256 || row.expires_at <= Date.now() || row.account_kind !== "points" || row.origin !== "member_created" || row.version !== row.expected_version || row.is_archived !== 0 || row.opening_balance !== 0 || row.owner_user_id !== b.requester_user_id || row.account_household !== b.household_id || row.requester_state !== "active" || row.requester_role !== "member")
    return fail4("POINTS_ACCOUNT_OR_IDENTITY_CHANGED");
  const x = await decode2(e, row);
  if (!x || !await permittedPurchase(db, row, x))
    return fail4("POINTS_SOURCE_INVALID");
  if (["transfer_prepaid", "offset_card", "transfer_out", "exchange_out", "redeem_asset"].includes(row.operation)) {
    if (row.target_account_id !== x.target_account_id || row.target_version !== x.target_version || row.operation === "offset_card" && row.target_purchase_request_id !== x.target_purchase_request_id || row.operation === "redeem_asset" && (row.sbi_fund_code !== x.sbi_fund_code || row.sbi_account_type !== x.sbi_account_type || row.sbi_confirmed_units !== x.sbi_confirmed_units || row.sbi_broker_reference_hash !== x.sbi_broker_reference_hash) || ["transfer_out", "exchange_out"].includes(row.operation) && (row.target_units !== x.target_units || row.target_rate_numerator !== x.target_rate_numerator || row.target_rate_denominator !== x.target_rate_denominator))
      return fail4("POINTS_PREPAID_TARGET_CHANGED");
    const target = await db.prepare("SELECT account_kind,origin,version,is_archived,owner_user_id,household_id,opening_balance FROM family_financial_accounts WHERE account_id=?").bind(x.target_account_id).first();
    if (!target || target.account_kind !== (row.operation === "offset_card" ? "credit_card" : row.operation === "transfer_prepaid" ? "prepaid" : row.operation === "redeem_asset" ? "securities" : "points") || target.origin !== "member_created" || target.version !== x.target_version || target.is_archived !== 0 || target.owner_user_id !== row.requester_user_id || target.household_id !== row.household_id || target.opening_balance !== 0) return fail4("POINTS_TARGET_CHANGED");
    if (row.operation === "offset_card") {
      const purchased = await db.prepare("SELECT p.account_id,p.household_id,p.requester_user_id,p.purchase_date,p.amount_jpy,COALESCE((SELECT SUM(a.amount_jpy) FROM family_card_settlement_allocations a WHERE a.purchase_request_id=p.homeflow_request_id),0) paid_jpy,COALESCE((SELECT SUM(o.amount_jpy) FROM family_points_card_offsets o WHERE o.purchase_request_id=p.homeflow_request_id),0)-COALESCE((SELECT SUM(ref.restored_jpy) FROM family_points_card_offset_refunds ref WHERE ref.purchase_request_id=p.homeflow_request_id),0) offset_jpy FROM family_card_purchase_applied p WHERE p.homeflow_request_id=?").bind(x.target_purchase_request_id).first();
      if (!purchased || purchased.account_id !== x.target_account_id || purchased.household_id !== b.household_id || purchased.requester_user_id !== b.requester_user_id || purchased.purchase_date > x.effective_date || !Number.isSafeInteger(purchased.amount_jpy) || !Number.isSafeInteger(purchased.paid_jpy) || !Number.isSafeInteger(purchased.offset_jpy) || purchased.amount_jpy - purchased.paid_jpy - purchased.offset_jpy < x.yen_value)
        return fail4("POINTS_CARD_LIABILITY_CHANGED");
    }
  }
  let original = null;
  if (row.operation === "reversal") {
    if (row.original_request_id !== x.original_request_id) return fail4("POINTS_REVERSAL_ORIGINAL_CHANGED");
    original = await db.prepare("SELECT old.* FROM family_points_journal old WHERE old.homeflow_request_id=? AND old.household_id=? AND old.requester_user_id=? AND old.points_account_id=? AND old.operation IN ('earn_campaign','earn_purchase','expire','transfer_out','exchange_out','transfer_prepaid','offset_card','redeem_asset') AND (old.target_account_id IS NULL OR EXISTS (SELECT 1 FROM family_points_transfer_credits c WHERE c.homeflow_request_id=old.homeflow_request_id AND c.target_account_id=old.target_account_id) OR EXISTS (SELECT 1 FROM family_points_prepaid_credits c WHERE c.homeflow_request_id=old.homeflow_request_id AND c.prepaid_account_id=old.target_account_id) OR EXISTS (SELECT 1 FROM family_sbi_point_lots c WHERE c.homeflow_request_id=old.homeflow_request_id AND c.securities_account_id=old.target_account_id) OR EXISTS (SELECT 1 FROM family_points_card_offsets c WHERE c.homeflow_request_id=old.homeflow_request_id AND c.card_account_id=old.target_account_id)) AND NOT EXISTS (SELECT 1 FROM family_points_journal other WHERE other.reversed_request_id=old.homeflow_request_id)").bind(x.original_request_id, row.household_id, row.requester_user_id, row.points_account_id).first();
    if (!original || x.effective_date < original.effective_date || x.units !== Math.abs(original.delta_units) || x.yen_value !== original.yen_value || x.rate_numerator !== original.yen_per_unit_numerator || x.rate_denominator !== original.yen_per_unit_denominator)
      return fail4("POINTS_REVERSAL_ORIGINAL_CHANGED");
  }
  if (row.operation === "reversal" && original?.operation === "redeem_asset") {
    if (e.KAKEIBO_SBI_POINT_REFUNDS_ENABLED !== "true" || x.sbi_reversal !== true || !Number.isSafeInteger(row.sbi_refund_securities_version) || row.sbi_refund_securities_version !== x.sbi_securities_version || row.sbi_refund_broker_hash !== x.sbi_broker_cancel_hash || row.sbi_refund_points_hash !== x.sbi_points_refund_hash || row.sbi_refund_broker_date !== x.sbi_broker_cancel_date || row.sbi_refund_points_date !== x.sbi_points_refund_date || x.sbi_points_refund_hash !== x.reference_hash)
      return fail4("POINTS_SBI_REFUND_EVIDENCE_OR_FLAG_INVALID");
    const lot = await db.prepare("SELECT * FROM family_sbi_point_lots WHERE homeflow_request_id=?").bind(original.homeflow_request_id).first();
    const sec = lot ? await db.prepare("SELECT * FROM family_financial_accounts WHERE account_id=?").bind(lot.securities_account_id).first() : null;
    if (!lot || !sec || lot.securities_account_id !== original.target_account_id || lot.points_account_id !== row.points_account_id || sec.account_kind !== "securities" || sec.origin !== "member_created" || sec.owner_user_id !== row.requester_user_id || sec.household_id !== row.household_id || sec.is_archived !== 0 || sec.opening_balance !== 0 || sec.version !== x.sbi_securities_version || x.sbi_broker_cancel_date < lot.trade_date || x.sbi_points_refund_date < x.sbi_broker_cancel_date || x.sbi_broker_cancel_hash === lot.broker_reference_hash)
      return fail4("POINTS_SBI_REFUND_TARGET_OR_PROOF_CHANGED");
    const candidate = await db.prepare("SELECT candidate_id FROM family_sbi_legacy_holding_candidates WHERE lot_type='points' AND lot_homeflow_request_id=?").bind(original.homeflow_request_id).first();
    if (candidate) return fail4("POINTS_SBI_REFUND_RECONCILIATION_CONFLICT");
  } else if (row.operation === "reversal" && x.sbi_reversal === true)
    return fail4("POINTS_SBI_REFUND_NON_ASSET_ORIGINAL");
  const approved = await proof3(e, b, row);
  if (!approved) return fail4("POINTS_APPROVAL_OR_LEASE_INVALID");
  const priorBalance = await db.prepare("SELECT (COALESCE((SELECT SUM(delta_units) FROM family_points_journal WHERE points_account_id=?),0) +COALESCE((SELECT SUM(target_units) FROM family_points_transfer_credits WHERE target_account_id=?),0)-COALESCE((SELECT SUM(debited_target_units) FROM family_points_transfer_refunds WHERE target_account_id=?),0)) AS units").bind(row.points_account_id, row.points_account_id, row.points_account_id).first();
  if (!Number.isSafeInteger(priorBalance?.units) || priorBalance.units < 0)
    return fail4("POINTS_BALANCE_CORRUPT");
  const positive = x.operation === "earn_campaign" || x.operation === "earn_purchase";
  const delta = x.operation === "reversal" ? -original.delta_units : positive ? x.units : -x.units, after = priorBalance.units + delta;
  if (!Number.isSafeInteger(after) || after < 0 || after > 1e12)
    return fail4("POINTS_INSUFFICIENT_BALANCE");
  const at = Date.now();
  try {
    const result2 = await db.prepare("INSERT INTO family_points_journal (homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,actor_user_id,points_account_id,account_version,operation,delta_units,balance_after_units,yen_value,yen_per_unit_numerator,yen_per_unit_denominator,target_account_id,linked_entry_id,legacy_entry_id,source_reference_hash,reversed_request_id,payload_sha256,effective_date,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
      b.request_id,
      b.resource_id,
      row.household_id,
      row.requester_user_id,
      approved.approver_user_id,
      approved.approver_user_id,
      row.points_account_id,
      row.expected_version,
      row.operation,
      delta,
      after,
      x.yen_value,
      x.rate_numerator,
      x.rate_denominator,
      ["transfer_prepaid", "offset_card", "transfer_out", "exchange_out", "redeem_asset"].includes(x.operation) ? x.target_account_id : x.operation === "reversal" ? original.target_account_id : null,
      x.operation === "reversal" ? original.linked_entry_id : x.linked_entry_id,
      null,
      x.reference_hash,
      x.operation === "reversal" ? original.homeflow_request_id : null,
      row.payload_sha256,
      x.effective_date,
      at
    ).run();
    if (result2.meta?.changes !== 1) return fail4("POINTS_WRITE_UNCONFIRMED", 503);
  } catch {
    const raced = await db.prepare("SELECT * FROM family_points_journal WHERE homeflow_request_id=?").bind(b.request_id).first().catch(() => null);
    return match2(raced, b) ? receiptFor(db, raced, true) : fail4("POINTS_WRITE_RETRY", 503);
  }
  const applied = await db.prepare("SELECT * FROM family_points_journal WHERE homeflow_request_id=?").bind(b.request_id).first();
  return match2(applied, b) ? receiptFor(db, applied, false) : fail4("POINTS_RECEIPT_UNCONFIRMED", 503);
}
__name(approvedPointsRoute, "approvedPointsRoute");

// functions/api/internal/points-actions/[[path]].js
async function onRequest3({ request, env, params }) {
  return approvedPointsRoute(request, env, params.path || []);
}
__name(onRequest3, "onRequest");

// functions/api/internal/prepaid-actions/[[path]].js
var enc8 = new TextEncoder();
var hex4 = /^[a-f0-9]{64}$/i;
var id323 = /^[a-f0-9]{32}$/i;
var uuid6 = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
var result = /* @__PURE__ */ __name((body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } }), "result");
var reject = /* @__PURE__ */ __name((code, status = 409) => result({ ok: false, code, applied: false }, status), "reject");
var makeId = /* @__PURE__ */ __name(() => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join(""), "makeId");
var hash5 = /* @__PURE__ */ __name(async (s) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", enc8.encode(s))),
  (x) => x.toString(16).padStart(2, "0")
).join(""), "hash");
var eq2 = /* @__PURE__ */ __name((a, b) => typeof a === "string" && typeof b === "string" && hex4.test(a) && hex4.test(b) && Array.from(a).reduce((n, c, i) => n | c.charCodeAt(0) ^ b.charCodeAt(i), 0) === 0, "eq");
var exact6 = /* @__PURE__ */ __name((o, k) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join(",") === k.slice().sort().join(","), "exact");
var money = /* @__PURE__ */ __name((x) => Number.isSafeInteger(x) && x >= 1 && x <= 1e7, "money");
var date2 = /* @__PURE__ */ __name((s) => typeof s === "string" && /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) && Number.isFinite(Date.parse(s + "T00:00:00Z")) && (/* @__PURE__ */ new Date(s + "T00:00:00Z")).toISOString().slice(0, 10) === s && s <= new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10), "date");
var enabled3 = /* @__PURE__ */ __name((e) => e.APP_ENV === "production" && e.KAKEIBO_FAMILY_FINANCE_ENABLED === "true" && e.KAKEIBO_PREPAID_ACTIONS_ENABLED === "true" && hex4.test(e.KAKEIBO_FAMILY_PENDING_KEY || "") && hex4.test(e.KAKEIBO_PREPAID_EXECUTION_SECRET || "") && hex4.test(e.KAKEIBO_PREPAID_PROOF_SECRET || "") && e.DB?.prepare && typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch === "function" && /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN || ""), "enabled");
async function mac4(secret, domain, stamp, raw) {
  const key2 = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(secret.match(/.{2}/g), (x) => parseInt(x, 16)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key2, enc8.encode(domain + "\n" + stamp + "\n" + raw));
  return Array.from(new Uint8Array(sig), (x) => x.toString(16).padStart(2, "0")).join("");
}
__name(mac4, "mac");
var CORE = ["request_id", "resource_id", "household_id", "requester_user_id", "payload_sha256"];
async function signed4(request, env, mode) {
  if (request.method !== "POST" || request.headers.has("origin") || request.headers.has("cookie") || request.headers.has("authorization") || request.headers.get("x-approval-client") !== "homeflow" || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return null;
  const stamp = request.headers.get("x-approval-timestamp") || "", tag = request.headers.get("x-approval-signature") || "";
  if (!/^\d{13}$/.test(stamp) || Math.abs(Date.now() - Number(stamp)) > 3e5 || !hex4.test(tag)) return null;
  let raw, b;
  try {
    raw = await request.text();
    if (raw.length > 1600) return null;
    b = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!exact6(b, mode === "execute" ? [...CORE, "execution_nonce"] : CORE) || !uuid6.test(b.request_id) || !id323.test(b.resource_id) || !hex4.test(b.payload_sha256) || mode === "execute" && !hex4.test(b.execution_nonce) || typeof b.household_id !== "string" || !b.household_id || b.household_id.length > 128 || typeof b.requester_user_id !== "string" || !b.requester_user_id || b.requester_user_id.length > 128) return null;
  return eq2(tag, await mac4(
    env.KAKEIBO_PREPAID_EXECUTION_SECRET,
    "homeflow:prepaid-" + mode,
    stamp,
    raw
  )) ? b : null;
}
__name(signed4, "signed");
var match3 = /* @__PURE__ */ __name((r, b) => !!r && r.homeflow_request_id === b.request_id && r.proposal_id === b.resource_id && r.household_id === b.household_id && r.requester_user_id === b.requester_user_id && r.payload_sha256 === b.payload_sha256, "match");
var receipt4 = /* @__PURE__ */ __name((r, replayed) => ({
  ok: true,
  applied: true,
  approval_id: r.homeflow_request_id,
  proposal_id: r.proposal_id,
  household_id: r.household_id,
  requester_user_id: r.requester_user_id,
  payload_sha256: r.payload_sha256,
  approver_user_id: r.approver_user_id,
  actor_user_id: r.actor_user_id,
  prepaid_account_id: r.prepaid_account_id,
  prepaid_version: r.prepaid_version,
  bank_account_id: r.bank_account_id,
  bank_version: r.bank_version,
  action: r.action,
  amount_jpy: r.amount_jpy,
  date: r.date,
  delta_jpy: r.action === "topup" ? r.amount_jpy : -r.amount_jpy,
  balance_after_jpy: r.balance_after_jpy,
  entry_id: r.entry_id,
  applied_at: r.applied_at,
  already_applied: replayed
}), "receipt");
async function decode3(env, p) {
  try {
    const iv = Uint8Array.from(atob(p.payload_iv), (x2) => x2.charCodeAt(0)), cipher = Uint8Array.from(atob(p.payload_cipher), (x2) => x2.charCodeAt(0));
    if (iv.length !== 12 || cipher.length < 16 || cipher.length > 5e3) return null;
    const k = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(env.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g), (x2) => parseInt(x2, 16)),
      "AES-GCM",
      false,
      ["decrypt"]
    );
    const bytes = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: enc8.encode("kakeibo-prepaid:" + p.request_id)
    }, k, cipher);
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!eq2(await hash5(raw), p.payload_sha256)) return null;
    const x = JSON.parse(raw);
    if (!["topup", "spend"].includes(x.action) || x.action !== p.action || !date2(x.date) || !money(x.amount_jpy) || x.prepaid_account_id !== p.prepaid_account_id || x.prepaid_version !== p.prepaid_version) return null;
    if (x.action === "topup") {
      if (!exact6(x, [
        "action",
        "prepaid_account_id",
        "prepaid_version",
        "bank_account_id",
        "bank_version",
        "date",
        "amount_jpy",
        "reference_hash"
      ]) || x.bank_account_id !== p.bank_account_id || x.bank_version !== p.bank_version || !hex4.test(x.reference_hash)) return null;
    } else {
      if (!exact6(x, [
        "action",
        "prepaid_account_id",
        "prepaid_version",
        "date",
        "amount_jpy",
        "merchant",
        "category",
        "note"
      ]) || p.bank_account_id !== null || p.bank_version !== null || typeof x.merchant !== "string" || !x.merchant.trim() || x.merchant.length > 160 || typeof x.category !== "string" || !x.category.trim() || x.category.length > 40 || typeof x.note !== "string" || x.note.length > 300) return null;
    }
    return x;
  } catch {
    return null;
  }
}
__name(decode3, "decode");
async function proof4(env, b, p) {
  const input2 = {
    ...Object.fromEntries(CORE.map((k) => [k, b[k]])),
    idempotency_key: "kakeibo:prepaid:" + b.resource_id,
    expected_version: p.prepaid_version,
    purpose: "execute",
    execution_nonce: b.execution_nonce
  };
  const raw = JSON.stringify(input2), stamp = String(Date.now());
  try {
    const r = await env.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
      new URL("/api/internal/approvals/verify", env.HOMEFLOW_OAUTH_ORIGIN),
      {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "x-approval-client": "kakeibo-prepaid",
          "x-approval-timestamp": stamp,
          "x-approval-signature": await mac4(
            env.KAKEIBO_PREPAID_PROOF_SECRET,
            "kakeibo-prepaid:execution-proof",
            stamp,
            raw
          )
        },
        body: raw
      }
    ));
    if (r.status !== 200 || r.headers.has("location")) return null;
    const text = await r.text();
    if (text.length > 1800) return null;
    const x = JSON.parse(text);
    return x?.ok === true && x.verified === true && x.execution_authorized === true && x.execution_status === "executing" && x.source_app === "kakebo" && x.target_app === "kakebo" && x.operation === "finance.prepaid." + p.action && x.resource_type === "prepaid_action" && x.request_id === b.request_id && x.resource_id === b.resource_id && x.household_id === b.household_id && x.requester_user_id === b.requester_user_id && x.payload_sha256 === b.payload_sha256 && x.idempotency_key === input2.idempotency_key && x.expected_version === p.prepaid_version && x.approver_user_id && x.approver_user_id !== b.requester_user_id && x.expires_at > Date.now() && x.applied === false ? x : null;
  } catch {
    return null;
  }
}
__name(proof4, "proof");
async function currentBalance(db, id6) {
  const corrections = !!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='family_approved_account_effects' LIMIT 1").bind().first();
  const effect = corrections ? "+COALESCE((SELECT SUM(delta_jpy) FROM family_approved_account_effects WHERE account_id=? AND account_kind='prepaid'),0)" : "";
  const r = await db.prepare("SELECT (COALESCE((SELECT SUM(delta_jpy) FROM family_prepaid_balance_journal WHERE prepaid_account_id=?),0) " + effect + "+COALESCE((SELECT SUM(amount_jpy) FROM family_member_prepaid_topups WHERE prepaid_account_id=?),0)+COALESCE((SELECT SUM(amount_jpy) FROM family_points_prepaid_credits WHERE prepaid_account_id=?),0)-COALESCE((SELECT SUM(debited_prepaid_jpy) FROM family_points_prepaid_refunds WHERE prepaid_account_id=?),0)) amount").bind(id6, ...corrections ? [id6] : [], id6, id6, id6).first();
  return Number.isSafeInteger(r?.amount) && r.amount >= 0 ? r.amount : null;
}
__name(currentBalance, "currentBalance");
async function approvedPrepaidActionRoute(request, env, parts) {
  if (!enabled3(env)) return reject("PREPAID_EXECUTION_DISABLED", 503);
  if (parts.length !== 1 || !["execute", "receipt"].includes(parts[0])) return reject("NOT_FOUND", 404);
  const mode = parts[0], b = await signed4(request, env, mode);
  if (!b) return reject("PREPAID_UNAUTHORIZED", 403);
  const db = env.DB;
  const prior = await db.prepare("SELECT * FROM family_prepaid_actions_applied WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1").bind(b.request_id, b.resource_id).first();
  if (prior) return match3(prior, b) ? result(receipt4(prior, true)) : reject("PREPAID_RECEIPT_CONFLICT");
  if (mode === "receipt") return reject("PREPAID_RECEIPT_UNKNOWN", 404);
  const row = await db.prepare("SELECT p.*,a.account_kind AS prepaid_kind,a.origin AS prepaid_origin,a.version AS prepaid_live,a.is_archived AS prepaid_archived,a.owner_user_id AS prepaid_owner,a.household_id AS prepaid_household,bank.account_kind AS bank_kind,bank.origin AS bank_origin,bank.version AS bank_live,bank.is_archived AS bank_archived,bank.owner_user_id AS bank_owner,bank.household_id AS bank_household,link.role AS requester_role,link.state AS requester_state FROM family_prepaid_action_intents p JOIN family_financial_accounts a ON a.account_id=p.prepaid_account_id LEFT JOIN family_financial_accounts bank ON bank.account_id=p.bank_account_id JOIN homeflow_identity_links link ON link.user_id=p.requester_user_id WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1").bind(b.resource_id, b.request_id).first();
  if (!row || row.status !== "submitted" || row.requester_user_id !== b.requester_user_id || row.household_id !== b.household_id || row.payload_sha256 !== b.payload_sha256 || row.expires_at <= Date.now() || row.prepaid_kind !== "prepaid" || row.prepaid_origin !== "member_created" || row.prepaid_live !== row.prepaid_version || row.prepaid_archived !== 0 || row.prepaid_owner !== b.requester_user_id || row.prepaid_household !== b.household_id || row.requester_role !== "member" || row.requester_state !== "active" || row.action === "topup" && (row.bank_kind !== "bank" || row.bank_origin !== "member_created" || row.bank_live !== row.bank_version || row.bank_archived !== 0 || row.bank_owner !== b.requester_user_id || row.bank_household !== b.household_id))
    return reject("PREPAID_ACCOUNT_OR_IDENTITY_CHANGED");
  const x = await decode3(env, row);
  const approved = x && await proof4(env, b, row);
  if (!x || !approved) return reject("PREPAID_SOURCE_OR_APPROVAL_INVALID");
  const current = await currentBalance(db, row.prepaid_account_id);
  const delta = x.action === "topup" ? x.amount_jpy : -x.amount_jpy;
  const balanceAfter = current === null ? null : current + delta;
  if (balanceAfter === null || !Number.isSafeInteger(balanceAfter) || balanceAfter < 0 || balanceAfter > 1e8)
    return reject("PREPAID_INSUFFICIENT_OR_INVALID_BALANCE");
  const at = Date.now(), clientId = "hfprepaid:" + b.request_id;
  const entry = x.action === "topup" ? db.prepare("INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) VALUES(?,'',?,'\u8CC7\u7523\u79FB\u52D5','\u50A8\u503C\u5361\u5145\u503C','','','transfer',?,1,?,?,?,?,?)").bind(
    x.date,
    x.amount_jpy,
    "prepaid:" + row.prepaid_account_id,
    x.date,
    clientId,
    "bank:" + row.bank_account_id,
    row.bank_account_id,
    row.prepaid_account_id
  ) : db.prepare("INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) VALUES(?,'',?,?,?,?,?,'expense',NULL,NULL,NULL,?,?,?,NULL)").bind(
    x.date,
    x.amount_jpy,
    x.category,
    x.merchant,
    x.note,
    "",
    clientId,
    "prepaid:" + row.prepaid_account_id,
    row.prepaid_account_id
  );
  const commands = [
    entry,
    db.prepare("INSERT INTO family_prepaid_actions_applied (homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,actor_user_id,prepaid_account_id,prepaid_version,action,bank_account_id,bank_version,bank_reference_hash,payload_sha256,entry_id,amount_jpy,date,balance_after_jpy,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT id FROM entries WHERE client_request_id=?),?,?,?,?)").bind(
      b.request_id,
      b.resource_id,
      b.household_id,
      b.requester_user_id,
      approved.approver_user_id,
      approved.approver_user_id,
      row.prepaid_account_id,
      row.prepaid_version,
      row.action,
      row.bank_account_id,
      row.bank_version,
      x.action === "topup" ? x.reference_hash : null,
      row.payload_sha256,
      clientId,
      x.amount_jpy,
      x.date,
      balanceAfter,
      at
    ),
    db.prepare("INSERT INTO family_prepaid_balance_journal (homeflow_request_id,household_id,prepaid_account_id,delta_jpy,balance_after_jpy,effective_date,created_at) VALUES(?,?,?,?,?,?,?)").bind(b.request_id, b.household_id, row.prepaid_account_id, delta, balanceAfter, x.date, at),
    db.prepare("INSERT INTO family_prepaid_action_audit (event_id,homeflow_request_id,requester_user_id,approver_user_id,actor_user_id,action,created_at) VALUES(?,?,?,?,?,?,?)").bind(
      makeId(),
      b.request_id,
      b.requester_user_id,
      approved.approver_user_id,
      approved.approver_user_id,
      x.action === "topup" ? "prepaid_topup_applied" : "prepaid_spend_applied",
      at
    )
  ];
  if (x.action === "spend" && env.KAKEIBO_ACCOUNT_CORRECTIONS_ENABLED === "true") {
    const registered = await futurePaidRegistrationCommands(db, {
      householdId: b.household_id,
      memberUserId: b.requester_user_id,
      requestId: b.request_id,
      kind: "prepaid",
      accountId: row.prepaid_account_id,
      date: x.date,
      amount: x.amount_jpy,
      category: x.category,
      merchant: x.merchant,
      note: x.note,
      at
    });
    commands.push(...registered.statements);
  }
  try {
    const results = await db.batch(commands);
    if (results.length !== commands.length || results.some((r) => r.meta?.changes !== 1))
      return reject("PREPAID_TRANSACTION_UNCONFIRMED", 503);
  } catch {
    const raced = await db.prepare("SELECT * FROM family_prepaid_actions_applied WHERE homeflow_request_id=?").bind(b.request_id).first().catch(() => null);
    return match3(raced, b) ? result(receipt4(raced, true)) : reject("PREPAID_TRANSACTION_RETRY", 503);
  }
  const applied = await db.prepare("SELECT * FROM family_prepaid_actions_applied WHERE homeflow_request_id=?").bind(b.request_id).first();
  return match3(applied, b) ? result(receipt4(applied, false)) : reject("PREPAID_RECEIPT_UNCONFIRMED", 503);
}
__name(approvedPrepaidActionRoute, "approvedPrepaidActionRoute");
var onRequest4 = /* @__PURE__ */ __name(({ request, env, params }) => approvedPrepaidActionRoute(request, env, params.path || []), "onRequest");

// functions/api/internal/sbi-cash-actions/reversal.js
var enc9 = new TextEncoder();
var hex5 = /^[a-f0-9]{64}$/i;
var json4 = /* @__PURE__ */ __name((data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } }), "json");
var fail5 = /* @__PURE__ */ __name((code, status = 409) => json4({ ok: false, code, applied: false }, status), "fail");
var same3 = /* @__PURE__ */ __name((a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && hex5.test(a) && [...a].reduce((n, x, i) => n | x.charCodeAt(0) ^ b.charCodeAt(i), 0) === 0, "same");
var hash6 = /* @__PURE__ */ __name(async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc9.encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join(""), "hash");
var newid2 = /* @__PURE__ */ __name(() => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join(""), "newid");
var exact7 = /* @__PURE__ */ __name((x, keys) => !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).sort().join(",") === keys.slice().sort().join(","), "exact");
var date3 = /* @__PURE__ */ __name((s) => typeof s === "string" && /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) && Number.isFinite(Date.parse(s + "T00:00:00Z")) && (/* @__PURE__ */ new Date(s + "T00:00:00Z")).toISOString().slice(0, 10) === s, "date");
var identity3 = /* @__PURE__ */ __name((r, b) => !!r && r.homeflow_request_id === b.request_id && r.proposal_id === b.resource_id && r.household_id === b.household_id && r.requester_user_id === b.requester_user_id && r.payload_sha256 === b.payload_sha256, "identity");
async function receipt5(db, r, b, replay) {
  const [orig, lot, evidence, audit, transfer] = await Promise.all([
    db.prepare("SELECT * FROM family_sbi_cash_applied WHERE homeflow_request_id=?").bind(r.original_request_id).first(),
    db.prepare("SELECT * FROM family_sbi_cash_lots WHERE homeflow_request_id=?").bind(r.original_request_id).first(),
    db.prepare("SELECT * FROM family_sbi_cash_refund_evidence WHERE evidence_id=?").bind(r.evidence_id).first(),
    db.prepare("SELECT * FROM family_sbi_cash_reversal_audit WHERE homeflow_request_id=?").bind(r.homeflow_request_id).first(),
    db.prepare("SELECT * FROM entries WHERE id=?").bind(r.reversal_entry_id).first()
  ]);
  if (!identity3(r, b) || !orig || !lot || !evidence || !audit || !transfer || orig.household_id !== r.household_id || orig.requester_user_id !== r.requester_user_id || orig.bank_account_id !== r.bank_account_id || orig.securities_account_id !== r.securities_account_id || orig.amount_jpy !== r.amount_jpy || lot.confirmed_units !== r.reversed_units || lot.acquisition_cost_jpy !== r.reversed_cost_jpy || r.reversed_cost_jpy !== r.amount_jpy || evidence.original_request_id !== r.original_request_id || evidence.amount_jpy !== r.amount_jpy || evidence.bank_refund_confirmed !== 1 || evidence.broker_cancel_confirmed !== 1 || evidence.bank_refund_date !== r.bank_refund_date || evidence.broker_cancel_date !== r.broker_cancel_date || audit.original_request_id !== r.original_request_id || audit.actor_user_id !== r.actor_user_id || audit.approver_user_id !== r.approver_user_id || audit.requester_user_id !== r.requester_user_id || transfer.type !== "transfer" || transfer.amount !== r.amount_jpy || transfer.family_account_id !== r.securities_account_id || transfer.family_transfer_target_account_id !== r.bank_account_id || transfer.client_request_id !== "hfsbicashrefund:" + r.homeflow_request_id)
    return fail5("SBI_REFUND_COUNTERPART_UNCONFIRMED", 503);
  return json4({
    ok: true,
    applied: true,
    approval_id: r.homeflow_request_id,
    proposal_id: r.proposal_id,
    household_id: r.household_id,
    requester_user_id: r.requester_user_id,
    approver_user_id: r.approver_user_id,
    actor_user_id: r.actor_user_id,
    payload_sha256: r.payload_sha256,
    kind: "reversal",
    original_request_id: r.original_request_id,
    bank_account_id: r.bank_account_id,
    bank_version: r.bank_version,
    securities_account_id: r.securities_account_id,
    securities_version: r.securities_version,
    amount_jpy: r.amount_jpy,
    confirmed_units: r.reversed_units,
    acquisition_cost_jpy: r.reversed_cost_jpy,
    fund_code: lot.fund_code,
    account_type: lot.account_type,
    broker_reference_hash: lot.broker_reference_hash,
    debit_date: orig.debit_date,
    trade_date: orig.trade_date,
    effective_date: orig.effective_date,
    bank_refund_date: r.bank_refund_date,
    broker_cancel_date: r.broker_cancel_date,
    bank_refund_hash: evidence.bank_refund_hash,
    broker_cancel_hash: evidence.broker_cancel_hash,
    original_transfer_entry_id: orig.transfer_entry_id,
    reversal_entry_id: r.reversal_entry_id,
    transfer_entry_id: r.reversal_entry_id,
    entry_id: r.reversal_entry_id,
    broker_reconciled: false,
    included_in_tracked_assets_jpy: false,
    applied_at: r.applied_at,
    already_applied: replay
  });
}
__name(receipt5, "receipt");
async function decode4(e, p) {
  try {
    const iv = Uint8Array.from(atob(p.payload_iv), (x2) => x2.charCodeAt(0));
    const cipher = Uint8Array.from(atob(p.payload_cipher), (x2) => x2.charCodeAt(0));
    if (iv.length !== 12 || cipher.length < 16 || cipher.length > 5e3) return null;
    const key2 = await crypto.subtle.importKey("raw", Uint8Array.from(
      e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),
      (x2) => parseInt(x2, 16)
    ), "AES-GCM", false, ["decrypt"]);
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: enc9.encode("kakeibo-sbi-cash-reversal:" + p.request_id)
    }, key2, cipher));
    if (!same3(await hash6(raw), p.payload_sha256)) return null;
    const x = JSON.parse(raw);
    if (!exact7(x, [
      "original_request_id",
      "bank_account_id",
      "bank_version",
      "securities_account_id",
      "securities_version",
      "bank_refund_hash",
      "broker_cancel_hash",
      "bank_refund_date",
      "broker_cancel_date",
      "amount_jpy",
      "confirmed_units",
      "acquisition_cost_jpy",
      "fund_code",
      "account_type",
      "bank_refund_confirmed",
      "broker_cancel_confirmed"
    ]) || x.original_request_id !== p.original_request_id || x.bank_account_id !== p.bank_account_id || x.bank_version !== p.bank_version || x.securities_account_id !== p.securities_account_id || x.securities_version !== p.securities_version || !hex5.test(x.bank_refund_hash) || !hex5.test(x.broker_cancel_hash) || !date3(x.bank_refund_date) || !date3(x.broker_cancel_date) || x.bank_refund_date < x.broker_cancel_date || x.bank_refund_date > new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10) || !Number.isSafeInteger(x.amount_jpy) || x.amount_jpy < 1 || x.amount_jpy > 1e7 || !Number.isSafeInteger(x.confirmed_units) || x.confirmed_units < 1 || x.confirmed_units > 1e12 || x.acquisition_cost_jpy !== x.amount_jpy || !/^[A-Z0-9]{8}$/.test(x.fund_code) || !["growth", "tsumitate"].includes(x.account_type) || x.bank_refund_confirmed !== true || x.broker_cancel_confirmed !== true) return null;
    return x;
  } catch {
    return null;
  }
}
__name(decode4, "decode");
async function approvedSbiCashReversalInternal(db, e, b, mode, verifyProof) {
  if (e.KAKEIBO_SBI_CASH_REVERSALS_ENABLED !== "true") return fail5("SBI_REFUND_DISABLED", 503);
  const existing = await db.prepare("SELECT * FROM family_sbi_cash_reversals WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1").bind(b.request_id, b.resource_id).first();
  if (existing) return identity3(existing, b) ? receipt5(db, existing, b, true) : fail5("SBI_REFUND_RECEIPT_CONFLICT");
  if (mode === "receipt") return fail5("SBI_REFUND_RECEIPT_UNKNOWN", 404);
  const r = await db.prepare("SELECT i.*,bank.version AS live_bank,bank.is_archived AS bank_archived,bank.origin AS bank_origin,bank.account_kind AS bank_kind,bank.owner_user_id AS bank_owner,bank.household_id AS bank_household,sec.version AS live_securities,sec.is_archived AS sec_archived,sec.origin AS sec_origin,sec.account_kind AS sec_kind,sec.owner_user_id AS sec_owner,sec.household_id AS sec_household,member.state AS member_state,member.role AS member_role FROM family_sbi_cash_reversal_intents i JOIN family_financial_accounts bank ON bank.account_id=i.bank_account_id JOIN family_financial_accounts sec ON sec.account_id=i.securities_account_id JOIN homeflow_identity_links member ON member.user_id=i.requester_user_id WHERE i.request_id=? AND i.homeflow_approval_id=? LIMIT 1").bind(b.resource_id, b.request_id).first();
  if (!r || r.status !== "submitted" || r.expires_at <= Date.now() || r.household_id !== b.household_id || r.requester_user_id !== b.requester_user_id || r.payload_sha256 !== b.payload_sha256 || r.bank_version !== r.live_bank || r.securities_version !== r.live_securities || r.bank_archived !== 0 || r.sec_archived !== 0 || r.bank_origin !== "member_created" || r.sec_origin !== "member_created" || r.bank_kind !== "bank" || r.sec_kind !== "securities" || r.bank_owner !== b.requester_user_id || r.sec_owner !== b.requester_user_id || r.bank_household !== b.household_id || r.sec_household !== b.household_id || r.member_state !== "active" || r.member_role !== "member")
    return fail5("SBI_REFUND_IDENTITY_OR_ACCOUNT_CHANGED");
  const [original, lot] = await Promise.all([
    db.prepare("SELECT * FROM family_sbi_cash_applied WHERE homeflow_request_id=?").bind(r.original_request_id).first(),
    db.prepare("SELECT * FROM family_sbi_cash_lots WHERE homeflow_request_id=?").bind(r.original_request_id).first()
  ]);
  const p = await decode4(e, r), authorized = p && await verifyProof(e, b, r.bank_version, "reversal");
  if (!p || !authorized || !original || !lot || original.household_id !== r.household_id || original.requester_user_id !== r.requester_user_id || original.bank_account_id !== r.bank_account_id || original.securities_account_id !== r.securities_account_id || original.amount_jpy !== p.amount_jpy || lot.confirmed_units !== p.confirmed_units || lot.acquisition_cost_jpy !== p.acquisition_cost_jpy || lot.fund_code !== p.fund_code || lot.account_type !== p.account_type || p.broker_cancel_date < original.trade_date || p.bank_refund_date < original.effective_date)
    return fail5("SBI_REFUND_ORIGINAL_OR_APPROVAL_INVALID");
  const at = Date.now(), eid = newid2(), clientId = "hfsbicashrefund:" + b.request_id;
  const statements = [
    db.prepare("INSERT INTO family_sbi_cash_refund_evidence (evidence_id,household_id,original_request_id,bank_account_id,bank_version,bank_refund_hash,broker_cancel_hash,bank_refund_date,broker_cancel_date,amount_jpy,bank_refund_confirmed,broker_cancel_confirmed,evidence_kind,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,1,'owner_attested_posted_refund',?)").bind(
      eid,
      b.household_id,
      r.original_request_id,
      r.bank_account_id,
      r.bank_version,
      p.bank_refund_hash,
      p.broker_cancel_hash,
      p.bank_refund_date,
      p.broker_cancel_date,
      p.amount_jpy,
      at
    ),
    db.prepare("INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) VALUES(?,'',?,'\u6295\u8CC7\u30FB\u8CC7\u7523\u79FB\u52D5','SBI\u8A3C\u5238','\u8CB7\u4ED8\u53D6\u6D88\u30FB\u8FD4\u91D1','','transfer',?,1,?,?,?,?,?)").bind(
      p.bank_refund_date,
      p.amount_jpy,
      "bank:" + r.bank_account_id,
      p.bank_refund_date,
      clientId,
      "sbi:" + r.securities_account_id,
      r.securities_account_id,
      r.bank_account_id
    ),
    db.prepare("INSERT INTO family_sbi_cash_reversals (homeflow_request_id,proposal_id,original_request_id,household_id,requester_user_id,approver_user_id,actor_user_id,bank_account_id,bank_version,securities_account_id,securities_version,payload_sha256,evidence_id,reversal_entry_id,amount_jpy,reversed_units,reversed_cost_jpy,bank_refund_date,broker_cancel_date,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT id FROM entries WHERE client_request_id=?),?,?,?,?,?,?)").bind(
      b.request_id,
      b.resource_id,
      r.original_request_id,
      b.household_id,
      b.requester_user_id,
      authorized.approver_user_id,
      authorized.approver_user_id,
      r.bank_account_id,
      r.bank_version,
      r.securities_account_id,
      r.securities_version,
      b.payload_sha256,
      eid,
      clientId,
      p.amount_jpy,
      p.confirmed_units,
      p.acquisition_cost_jpy,
      p.bank_refund_date,
      p.broker_cancel_date,
      at
    ),
    db.prepare("INSERT INTO family_sbi_cash_reversal_audit (event_id,homeflow_request_id,original_request_id,requester_user_id,approver_user_id,actor_user_id,action,created_at) VALUES(?,?,?,?,?,?,'sbi_cash_full_refund_applied',?)").bind(
      newid2(),
      b.request_id,
      r.original_request_id,
      b.requester_user_id,
      authorized.approver_user_id,
      authorized.approver_user_id,
      at
    )
  ];
  try {
    const changed = await db.batch(statements);
    if (changed.length !== statements.length || changed.some((x) => x.meta?.changes !== 1))
      return fail5("SBI_REFUND_TRANSACTION_UNCONFIRMED", 503);
  } catch {
    const raced = await db.prepare("SELECT * FROM family_sbi_cash_reversals WHERE homeflow_request_id=?").bind(b.request_id).first().catch(() => null);
    return identity3(raced, b) ? receipt5(db, raced, b, true) : fail5("SBI_REFUND_TRANSACTION_RETRY", 503);
  }
  const saved = await db.prepare("SELECT * FROM family_sbi_cash_reversals WHERE homeflow_request_id=?").bind(b.request_id).first();
  return identity3(saved, b) ? receipt5(db, saved, b, false) : fail5("SBI_REFUND_RECEIPT_UNCONFIRMED", 503);
}
__name(approvedSbiCashReversalInternal, "approvedSbiCashReversalInternal");

// functions/api/internal/sbi-cash-actions/[[path]].js
var enc10 = new TextEncoder();
var hex6 = /^[a-f0-9]{64}$/i;
var id3 = /^[a-f0-9]{32}$/i;
var uuid7 = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
var json5 = /* @__PURE__ */ __name((data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } }), "json");
var fail6 = /* @__PURE__ */ __name((code, status = 409) => json5({ ok: false, code, applied: false }, status), "fail");
var exact8 = /* @__PURE__ */ __name((x, keys) => !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).sort().join(",") === keys.slice().sort().join(","), "exact");
var sha3 = /* @__PURE__ */ __name(async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc10.encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join(""), "sha");
var same4 = /* @__PURE__ */ __name((a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && hex6.test(a) && [...a].reduce((n, x, i) => n | x.charCodeAt(0) ^ b.charCodeAt(i), 0) === 0, "same");
var newid3 = /* @__PURE__ */ __name(() => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join(""), "newid");
var date4 = /* @__PURE__ */ __name((s) => typeof s === "string" && /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) && Number.isFinite(Date.parse(s + "T00:00:00Z")) && (/* @__PURE__ */ new Date(s + "T00:00:00Z")).toISOString().slice(0, 10) === s, "date");
var money2 = /* @__PURE__ */ __name((n) => Number.isSafeInteger(n) && n >= 1 && n <= 1e7, "money");
var ready4 = /* @__PURE__ */ __name((e) => e.APP_ENV === "production" && e.KAKEIBO_FAMILY_FINANCE_ENABLED === "true" && e.KAKEIBO_SBI_CASH_ENABLED === "true" && e.DB?.prepare && hex6.test(e.KAKEIBO_FAMILY_PENDING_KEY || "") && hex6.test(e.KAKEIBO_SBI_CASH_EXECUTION_SECRET || "") && hex6.test(e.KAKEIBO_SBI_CASH_PROOF_SECRET || "") && typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch === "function" && /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN || ""), "ready");
async function mac5(secret, domain, stamp, raw) {
  const key2 = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(secret.match(/.{2}/g), (x) => parseInt(x, 16)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key2, enc10.encode(domain + "\n" + stamp + "\n" + raw)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
__name(mac5, "mac");
var core3 = ["request_id", "resource_id", "household_id", "requester_user_id", "payload_sha256"];
async function signed5(req, e, mode) {
  if (req.method !== "POST" || req.headers.has("origin") || req.headers.has("cookie") || req.headers.has("authorization") || req.headers.get("x-approval-client") !== "homeflow" || req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return null;
  const stamp = req.headers.get("x-approval-timestamp") || "", signature = req.headers.get("x-approval-signature") || "";
  if (!/^\d{13}$/.test(stamp) || Math.abs(Date.now() - Number(stamp)) > 3e5 || !hex6.test(signature)) return null;
  let raw, b;
  try {
    raw = await req.text();
    if (raw.length > 1600) return null;
    b = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!exact8(b, mode === "execute" ? [...core3, "execution_nonce"] : core3) || !uuid7.test(b.request_id) || !id3.test(b.resource_id) || !hex6.test(b.payload_sha256) || mode === "execute" && !hex6.test(b.execution_nonce) || typeof b.household_id !== "string" || !b.household_id || b.household_id.length > 128 || typeof b.requester_user_id !== "string" || !b.requester_user_id || b.requester_user_id.length > 128) return null;
  return same4(signature, await mac5(
    e.KAKEIBO_SBI_CASH_EXECUTION_SECRET,
    "homeflow:sbi-cash-" + mode,
    stamp,
    raw
  )) ? b : null;
}
__name(signed5, "signed");
var identity4 = /* @__PURE__ */ __name((a, b) => !!a && a.homeflow_request_id === b.request_id && a.proposal_id === b.resource_id && a.household_id === b.household_id && a.requester_user_id === b.requester_user_id && a.payload_sha256 === b.payload_sha256, "identity");
async function confirmed(db, a, b, replay) {
  const [lot, evidence, audit] = await Promise.all([
    db.prepare("SELECT * FROM family_sbi_cash_lots WHERE homeflow_request_id=?").bind(a.homeflow_request_id).first(),
    db.prepare("SELECT * FROM family_sbi_cash_bank_evidence WHERE evidence_id=?").bind(a.evidence_id).first(),
    db.prepare("SELECT * FROM family_sbi_cash_audit WHERE homeflow_request_id=?").bind(a.homeflow_request_id).first()
  ]);
  if (!identity4(a, b) || !lot || !evidence || !audit || lot.homeflow_request_id !== a.homeflow_request_id || lot.household_id !== a.household_id || lot.owner_user_id !== a.requester_user_id || lot.securities_account_id !== a.securities_account_id || lot.acquisition_cost_jpy !== a.amount_jpy || lot.trade_date !== a.trade_date || lot.effective_date !== a.effective_date || lot.actor_user_id !== a.actor_user_id || evidence.bank_account_id !== a.bank_account_id || evidence.amount_jpy !== a.amount_jpy || evidence.debit_date !== a.debit_date || audit.approver_user_id !== a.approver_user_id || audit.requester_user_id !== a.requester_user_id || audit.actor_user_id !== a.actor_user_id)
    return fail6("SBI_CASH_COUNTERPART_UNCONFIRMED", 503);
  return json5({
    ok: true,
    applied: true,
    approval_id: a.homeflow_request_id,
    proposal_id: a.proposal_id,
    household_id: a.household_id,
    requester_user_id: a.requester_user_id,
    approver_user_id: a.approver_user_id,
    actor_user_id: a.actor_user_id,
    payload_sha256: a.payload_sha256,
    bank_account_id: a.bank_account_id,
    bank_version: a.bank_version,
    securities_account_id: a.securities_account_id,
    securities_version: a.securities_version,
    kind: a.kind,
    amount_jpy: a.amount_jpy,
    debit_date: a.debit_date,
    trade_date: a.trade_date,
    effective_date: a.effective_date,
    transfer_entry_id: a.transfer_entry_id,
    entry_id: a.transfer_entry_id,
    fund_code: lot.fund_code,
    account_type: lot.account_type,
    confirmed_units: lot.confirmed_units,
    acquisition_cost_jpy: lot.acquisition_cost_jpy,
    broker_reference_hash: lot.broker_reference_hash,
    broker_reconciled: false,
    included_in_tracked_assets_jpy: false,
    applied_at: a.applied_at,
    already_applied: replay
  });
}
__name(confirmed, "confirmed");
async function decode5(e, p) {
  try {
    const iv = Uint8Array.from(atob(p.payload_iv), (x2) => x2.charCodeAt(0));
    const cipher = Uint8Array.from(atob(p.payload_cipher), (x2) => x2.charCodeAt(0));
    if (iv.length !== 12 || cipher.length < 16 || cipher.length > 5e3) return null;
    const key2 = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g), (x2) => parseInt(x2, 16)),
      "AES-GCM",
      false,
      ["decrypt"]
    );
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: enc10.encode("kakeibo-sbi-cash:" + p.request_id)
    }, key2, cipher));
    if (!same4(await sha3(raw), p.payload_sha256)) return null;
    const x = JSON.parse(raw);
    if (!exact8(x, [
      "bank_account_id",
      "bank_version",
      "securities_account_id",
      "securities_version",
      "kind",
      "debit_date",
      "trade_date",
      "effective_date",
      "amount_jpy",
      "reference_hash",
      "broker_reference_hash",
      "fund_code",
      "account_type",
      "confirmed_units",
      "evidence_kind",
      "broker_execution_attested"
    ]) || x.bank_account_id !== p.bank_account_id || x.bank_version !== p.bank_version || x.securities_account_id !== p.securities_account_id || x.securities_version !== p.securities_version || x.kind !== p.kind || !date4(x.debit_date) || !date4(x.trade_date) || !date4(x.effective_date) || x.debit_date > x.trade_date || x.trade_date > x.effective_date || x.effective_date > new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10) || !money2(x.amount_jpy) || !hex6.test(x.reference_hash) || !hex6.test(x.broker_reference_hash) || !/^[A-Z0-9]{8}$/.test(x.fund_code) || !["growth", "tsumitate"].includes(x.account_type) || !Number.isSafeInteger(x.confirmed_units) || x.confirmed_units < 1 || x.confirmed_units > 1e12 || x.evidence_kind !== "owner_confirmed_statement" || x.broker_execution_attested !== true) return null;
    return x;
  } catch {
    return null;
  }
}
__name(decode5, "decode");
async function proof5(e, b, version, kind) {
  const wire = {
    ...Object.fromEntries(core3.map((k) => [k, b[k]])),
    idempotency_key: "kakeibo:sbi-cash:" + b.resource_id,
    expected_version: version,
    purpose: "execute",
    execution_nonce: b.execution_nonce
  };
  const raw = JSON.stringify(wire), stamp = String(Date.now());
  try {
    const res = await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
      new URL("/api/internal/approvals/verify", e.HOMEFLOW_OAUTH_ORIGIN),
      {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "x-approval-client": "kakeibo-sbi-cash",
          "x-approval-timestamp": stamp,
          "x-approval-signature": await mac5(
            e.KAKEIBO_SBI_CASH_PROOF_SECRET,
            "kakeibo-sbi-cash:execution-proof",
            stamp,
            raw
          )
        },
        body: raw
      }
    ));
    if (res.status !== 200 || res.headers.has("location")) return null;
    const text = await res.text();
    if (text.length > 1900) return null;
    const x = JSON.parse(text);
    return x?.ok === true && x.verified === true && x.execution_authorized === true && x.execution_status === "executing" && x.source_app === "kakebo" && x.target_app === "kakebo" && x.resource_type === "sbi_cash_action" && x.operation === "finance.sbi_cash." + kind && x.idempotency_key === wire.idempotency_key && x.expected_version === version && x.request_id === b.request_id && x.resource_id === b.resource_id && x.household_id === b.household_id && x.requester_user_id === b.requester_user_id && x.payload_sha256 === b.payload_sha256 && x.approver_user_id && x.approver_user_id !== b.requester_user_id && Number.isSafeInteger(x.approved_at) && Number.isSafeInteger(x.expires_at) && x.expires_at > Date.now() && x.applied === false ? x : null;
  } catch {
    return null;
  }
}
__name(proof5, "proof");
async function approvedSbiCashRoute(req, e, parts) {
  if (!ready4(e)) return fail6("SBI_CASH_EXECUTION_DISABLED", 503);
  if (parts.length !== 1 || !["execute", "receipt"].includes(parts[0])) return fail6("NOT_FOUND", 404);
  const mode = parts[0], b = await signed5(req, e, mode);
  if (!b) return fail6("SBI_CASH_UNAUTHORIZED", 403);
  const db = e.DB;
  const old = await db.prepare("SELECT * FROM family_sbi_cash_applied WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1").bind(b.request_id, b.resource_id).first();
  if (old) return identity4(old, b) ? confirmed(db, old, b, true) : fail6("SBI_CASH_RECEIPT_CONFLICT");
  if (mode === "receipt") return e.KAKEIBO_SBI_CASH_REVERSALS_ENABLED === "true" ? approvedSbiCashReversalInternal(db, e, b, mode, proof5) : fail6("SBI_CASH_RECEIPT_UNKNOWN", 404);
  const r = await db.prepare("SELECT p.*,bank.version AS live_bank,bank.is_archived AS bank_archived,bank.account_kind AS bank_kind,bank.origin AS bank_origin,bank.owner_user_id AS bank_owner,bank.household_id AS bank_household,securities.version AS live_securities,securities.is_archived AS securities_archived,securities.account_kind AS securities_kind,securities.origin AS securities_origin,securities.owner_user_id AS securities_owner,securities.household_id AS securities_household,member.role AS member_role,member.state AS member_state FROM family_sbi_cash_intents p JOIN family_financial_accounts bank ON bank.account_id=p.bank_account_id JOIN family_financial_accounts securities ON securities.account_id=p.securities_account_id JOIN homeflow_identity_links member ON member.user_id=p.requester_user_id WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1").bind(b.resource_id, b.request_id).first();
  if (!r) return approvedSbiCashReversalInternal(db, e, b, mode, proof5);
  if (r.status !== "submitted" || r.expires_at <= Date.now() || r.household_id !== b.household_id || r.requester_user_id !== b.requester_user_id || r.payload_sha256 !== b.payload_sha256 || r.bank_version !== r.live_bank || r.securities_version !== r.live_securities || r.bank_archived !== 0 || r.securities_archived !== 0 || r.bank_kind !== "bank" || r.securities_kind !== "securities" || r.bank_origin !== "member_created" || r.securities_origin !== "member_created" || r.bank_owner !== b.requester_user_id || r.securities_owner !== b.requester_user_id || r.bank_household !== b.household_id || r.securities_household !== b.household_id || r.member_role !== "member" || r.member_state !== "active")
    return fail6("SBI_CASH_ACCOUNT_OR_IDENTITY_CHANGED");
  const p = await decode5(e, r);
  const authorized = p && await proof5(e, b, r.bank_version, r.kind);
  if (!p || !authorized) return fail6("SBI_CASH_APPROVAL_INVALID");
  const at = Date.now(), evidenceId = newid3(), clientId = "hfsbicash:" + b.request_id;
  const statements = [
    db.prepare("INSERT INTO family_sbi_cash_bank_evidence (evidence_id,household_id,bank_account_id,bank_version,reference_hash,debit_date,amount_jpy,evidence_kind,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(
      evidenceId,
      b.household_id,
      r.bank_account_id,
      r.bank_version,
      p.reference_hash,
      p.debit_date,
      p.amount_jpy,
      p.evidence_kind,
      at
    ),
    db.prepare("INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) VALUES(?,'',?,'\u6295\u8CC7\u30FB\u8CC7\u7523\u79FB\u52D5','SBI\u8A3C\u5238',?,'','transfer',?,1,?,?,?,?,?)").bind(
      p.debit_date,
      p.amount_jpy,
      p.kind === "tsumitate" ? "\u7A4D\u7ACB" : "\u8FFD\u52A0\u8CB7\u4ED8",
      "sbi:" + r.securities_account_id,
      p.effective_date,
      clientId,
      "bank:" + r.bank_account_id,
      r.bank_account_id,
      r.securities_account_id
    ),
    db.prepare("INSERT INTO family_sbi_cash_applied (homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,actor_user_id,bank_account_id,bank_version,securities_account_id,securities_version,kind,payload_sha256,evidence_id,transfer_entry_id,amount_jpy,debit_date,trade_date,effective_date,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT id FROM entries WHERE client_request_id=? LIMIT 1),?,?,?,?,?)").bind(
      b.request_id,
      b.resource_id,
      b.household_id,
      b.requester_user_id,
      authorized.approver_user_id,
      authorized.approver_user_id,
      r.bank_account_id,
      r.bank_version,
      r.securities_account_id,
      r.securities_version,
      r.kind,
      b.payload_sha256,
      evidenceId,
      clientId,
      p.amount_jpy,
      p.debit_date,
      p.trade_date,
      p.effective_date,
      at
    ),
    db.prepare("INSERT INTO family_sbi_cash_lots (homeflow_request_id,household_id,owner_user_id,securities_account_id,kind,fund_code,account_type,confirmed_units,acquisition_cost_jpy,broker_reference_hash,trade_date,effective_date,actor_user_id,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
      b.request_id,
      b.household_id,
      b.requester_user_id,
      r.securities_account_id,
      r.kind,
      p.fund_code,
      p.account_type,
      p.confirmed_units,
      p.amount_jpy,
      p.broker_reference_hash,
      p.trade_date,
      p.effective_date,
      authorized.approver_user_id,
      at
    ),
    db.prepare("INSERT INTO family_sbi_cash_audit (event_id,homeflow_request_id,requester_user_id,approver_user_id,actor_user_id,action,created_at) VALUES(?,?,?,?,?,'sbi_cash_purchase_applied',?)").bind(newid3(), b.request_id, b.requester_user_id, authorized.approver_user_id, authorized.approver_user_id, at)
  ];
  try {
    const changed = await db.batch(statements);
    if (changed.length !== statements.length || changed.some((x) => x.meta?.changes !== 1))
      return fail6("SBI_CASH_TRANSACTION_UNCONFIRMED", 503);
  } catch {
    const raced = await db.prepare("SELECT * FROM family_sbi_cash_applied WHERE homeflow_request_id=?").bind(b.request_id).first().catch(() => null);
    return identity4(raced, b) ? confirmed(db, raced, b, true) : fail6("SBI_CASH_TRANSACTION_RETRY", 503);
  }
  const applied = await db.prepare("SELECT * FROM family_sbi_cash_applied WHERE homeflow_request_id=?").bind(b.request_id).first();
  return identity4(applied, b) ? confirmed(db, applied, b, false) : fail6("SBI_CASH_RECEIPT_UNCONFIRMED", 503);
}
__name(approvedSbiCashRoute, "approvedSbiCashRoute");
var onRequest5 = /* @__PURE__ */ __name(({ request, env, params }) => approvedSbiCashRoute(request, env, params.path || []), "onRequest");

// functions/api/family-finance/shared-mutation-sealed-reference.js
var marker = /^sealed-ref:([a-f0-9]{32})$/i;
async function resolveSharedMutationSealedReference(db, proposal) {
  if (!proposal || typeof proposal.payload_cipher !== "string") return null;
  const link = marker.exec(proposal.payload_cipher);
  if (!link) return proposal;
  if (proposal.payload_iv !== "sealed-ref" || proposal.operation !== "create" || proposal.resource_id !== null || proposal.expected_version !== 0 || proposal.status !== "submitted" || link[1] === proposal.proposal_id) return null;
  const source = await db.prepare("SELECT * FROM family_shared_mutation_intents WHERE proposal_id=?").bind(link[1]).first();
  if (!source || source.proposal_id === proposal.proposal_id || source.operation !== "create" || source.resource_id !== null || source.expected_version !== 0 || source.status !== "submitted" || !source.payload_cipher || source.payload_cipher.startsWith("sealed-ref:") || source.household_id !== proposal.household_id || source.requester_user_id !== proposal.requester_user_id || source.payload_sha256 !== proposal.payload_sha256 || source.created_at >= proposal.created_at) return null;
  const original = await db.prepare("SELECT resource_id,entry_id FROM family_shared_mutation_applied WHERE proposal_id=? AND action=? AND household_id=? AND requester_user_id=? AND payload_sha256=? LIMIT 1").bind(
    source.proposal_id,
    "create",
    source.household_id,
    source.requester_user_id,
    source.payload_sha256
  ).first();
  if (!original) return null;
  const ledger = await db.prepare("SELECT state FROM family_shared_entry_registry WHERE resource_id=? AND household_id=? AND entry_id=? LIMIT 1").bind(original.resource_id, source.household_id, original.entry_id).first();
  if (ledger?.state !== "deleted") return null;
  const physical = await db.prepare("SELECT 1 AS present FROM entries WHERE id=? LIMIT 1").bind(original.entry_id).first();
  if (physical) return null;
  return {
    ...proposal,
    proposal_id: source.proposal_id,
    payload_cipher: source.payload_cipher,
    payload_iv: source.payload_iv
  };
}
__name(resolveSharedMutationSealedReference, "resolveSharedMutationSealedReference");

// src/approved-account-correction-plan.js
var money3 = /* @__PURE__ */ __name((n) => Number.isSafeInteger(n) && n >= 1 && n <= 1e7, "money");
var date5 = /* @__PURE__ */ __name((s) => typeof s === "string" && /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00.000Z")) && (/* @__PURE__ */ new Date(s + "T00:00:00.000Z")).toISOString().slice(0, 10) === s, "date");
var fail7 = /* @__PURE__ */ __name((code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
}, "fail");
function closingMonth(d, closingDay) {
  if (!date5(d)) fail7("CORRECTION_INVALID_DATE");
  const [year, month2, day] = d.split("-").map(Number);
  const last = new Date(Date.UTC(year, month2, 0)).getUTCDate();
  const cutoff = closingDay === null || closingDay === 0 || closingDay === void 0 ? last : Math.min(Math.max(Number(closingDay) || 0, 1), last);
  const next = day > cutoff ? new Date(Date.UTC(year, month2, 1)) : new Date(Date.UTC(year, month2 - 1, 1));
  return next.toISOString().slice(0, 7);
}
__name(closingMonth, "closingMonth");
function account(id6, accounts, spender) {
  if (!id6) return null;
  const a = accounts.find((x) => x.account_id === id6);
  if (!a || a.owner_user_id !== spender || a.origin !== "member_created" || !["credit_card", "prepaid"].includes(a.account_kind) || Number(a.is_archived) !== 0)
    fail7("CORRECTION_ACCOUNT_NOT_OWNED_OR_ACTIVE");
  return a;
}
__name(account, "account");
function identity5(row, mayBeVoid = false) {
  if (!row || row.type !== "expense" || !(money3(Number(row.amount)) || mayBeVoid && Number(row.amount) === 0) || !date5(row.date) || !(typeof row.accountId === "string" || row.accountId === null)) fail7("CORRECTION_INVALID_ENTRY");
}
__name(identity5, "identity");
function effectKey(v) {
  return [v.accountId, v.kind, v.billMonth || ""].join("\0");
}
__name(effectKey, "effectKey");
function planAccountLinkedExpenseCorrection(input2) {
  const {
    before,
    after,
    accounts,
    spenderUserId,
    editorUserId,
    prepaidBalances = {},
    settledJpy = 0,
    offsetJpy = 0,
    operation = "update"
  } = input2 || {};
  if (!spenderUserId || !editorUserId || !Array.isArray(accounts))
    fail7("CORRECTION_IDENTITY_REQUIRED");
  if (!["update", "delete", "restore"].includes(operation)) fail7("CORRECTION_INVALID_OPERATION");
  identity5(before, operation === "restore");
  identity5(after, operation === "delete");
  if (operation === "delete" && after.amount !== 0 || operation === "restore" && before.amount !== 0)
    fail7("CORRECTION_INVALID_VOID_TRANSITION");
  const old = account(before.accountId, accounts, spenderUserId);
  const newer = account(after.accountId, accounts, spenderUserId);
  if (old?.account_id !== newer?.account_id && editorUserId !== spenderUserId)
    fail7("CORRECTION_OTHER_PERSON_ACCOUNT_READ_ONLY");
  const changed = before.amount !== after.amount || before.date !== after.date || before.accountId !== after.accountId;
  if (!Number.isSafeInteger(settledJpy) || settledJpy < 0 || !Number.isSafeInteger(offsetJpy) || offsetJpy < 0 || settledJpy > 1e8 || offsetJpy > 1e8)
    fail7("CORRECTION_ALLOCATION_INVALID");
  if ((settledJpy > 0 || offsetJpy > 0) && old?.account_kind !== "credit_card")
    fail7("CORRECTION_ALLOCATION_SOURCE_INVALID");
  const effects = /* @__PURE__ */ new Map();
  function post(a, amount, when, reverse) {
    if (!a) return;
    if (amount === 0) return;
    const row = {
      accountId: a.account_id,
      kind: a.account_kind,
      billMonth: a.account_kind === "credit_card" ? closingMonth(when, a.closing_day) : null,
      deltaJpy: reverse ? -amount : amount
    };
    if (a.account_kind === "prepaid") row.deltaJpy = -row.deltaJpy;
    const key2 = effectKey(row);
    effects.set(key2, { ...row, deltaJpy: (effects.get(key2)?.deltaJpy || 0) + row.deltaJpy });
  }
  __name(post, "post");
  if (changed) {
    post(old, Number(before.amount), before.date, true);
    post(newer, Number(after.amount), after.date, false);
  }
  const deltas = [...effects.values()].filter((x) => x.deltaJpy !== 0);
  for (const delta of deltas) if (delta.kind === "prepaid") {
    const current = Number(prepaidBalances[delta.accountId]);
    if (!Number.isSafeInteger(current) || current < 0)
      fail7("CORRECTION_PREPAID_BALANCE_UNKNOWN");
    if (current + delta.deltaJpy < 0 || current + delta.deltaJpy > 1e8)
      fail7("CORRECTION_PREPAID_INSUFFICIENT_BALANCE");
  }
  return {
    changed,
    effects: deltas,
    ledgerAfter: { ...after, amount: Number(after.amount) },
    // This plan is not itself a permission to post.
    allocationPolicy: "preserve-original-bank-and-point-credit",
    requiresHomeFlowApproval: true,
    immutableOriginal: true
  };
}
__name(planAccountLinkedExpenseCorrection, "planAccountLinkedExpenseCorrection");

// functions/api/family-finance/prepaid-balance-projection.js
async function memberPrepaidBalances(db, household) {
  if (typeof household !== "string" || !household) return null;
  const hasCorrections = !!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='family_approved_account_effects' LIMIT 1").bind().first();
  const hasOwnerCorrections = !!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='family_owner_account_effects' LIMIT 1").bind().first();
  const hasTopupCorrections = !!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='family_member_prepaid_topup_corrections' LIMIT 1").bind().first();
  const topupCorrectionAmount = hasTopupCorrections ? "+COALESCE((SELECT SUM((CASE WHEN k.after_account_id=a.account_id THEN k.after_amount_jpy ELSE 0 END) -(CASE WHEN k.before_account_id=a.account_id THEN k.before_amount_jpy ELSE 0 END)) FROM family_member_prepaid_topup_corrections k WHERE k.household_id=a.household_id AND (k.before_account_id=a.account_id OR k.after_account_id=a.account_id)),0) " : "";
  const correctionAmount = hasCorrections ? "+COALESCE((SELECT SUM(c.delta_jpy) FROM family_approved_account_effects c WHERE c.account_id=a.account_id AND c.household_id=a.household_id AND c.account_kind='prepaid'),0) " : "";
  const ownerCorrectionAmount = hasOwnerCorrections ? "+COALESCE((SELECT SUM(o.delta_jpy) FROM family_owner_account_effects o WHERE o.account_id=a.account_id AND o.household_id=a.household_id AND o.account_kind='prepaid'),0) " : "";
  const query = "SELECT a.account_id,a.owner_user_id,a.label,a.version,COALESCE((SELECT SUM(j.delta_jpy) FROM family_prepaid_balance_journal j WHERE j.prepaid_account_id=a.account_id AND j.household_id=a.household_id),0) +COALESCE((SELECT SUM(t.amount_jpy) FROM family_member_prepaid_topups t WHERE t.prepaid_account_id=a.account_id AND t.household_id=a.household_id),0) " + topupCorrectionAmount + "+COALESCE((SELECT SUM(c.amount_jpy) FROM family_points_prepaid_credits c WHERE c.prepaid_account_id=a.account_id AND c.household_id=a.household_id),0) -COALESCE((SELECT SUM(r.debited_prepaid_jpy) FROM family_points_prepaid_refunds r WHERE r.prepaid_account_id=a.account_id AND r.household_id=a.household_id),0) " + correctionAmount + ownerCorrectionAmount + " balance_jpy FROM family_financial_accounts a WHERE a.household_id=? AND a.account_kind='prepaid' AND a.origin='member_created' AND a.is_archived=0 ORDER BY a.created_at DESC,a.account_id LIMIT 200";
  const rows = (await db.prepare(query).bind(household).all()).results || [];
  let total = 0;
  const accounts = [];
  for (const row of rows) {
    if (typeof row.account_id !== "string" || !/^[0-9a-f]{32}$/i.test(row.account_id) || typeof row.owner_user_id !== "string" || !row.owner_user_id || typeof row.label !== "string" || !row.label || !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isSafeInteger(row.balance_jpy) || row.balance_jpy < 0) return null;
    total += row.balance_jpy;
    if (!Number.isSafeInteger(total)) return null;
    accounts.push({
      account_id: row.account_id,
      owner_user_id: row.owner_user_id,
      account_label: row.label,
      account_version: row.version,
      balance_jpy: row.balance_jpy,
      identity_basis: "member_created_stable_id"
    });
  }
  return { accounts, total_jpy: total, scope: "household", ledger_changed: false };
}
__name(memberPrepaidBalances, "memberPrepaidBalances");

// functions/api/internal/future-approved-paid-revision.js
var spendSource = /* @__PURE__ */ __name((s) => typeof s === "string" && /^(?:cc|prepaid):[a-f0-9]{32}$/.test(s), "spendSource");
var fail8 = /* @__PURE__ */ __name((code) => ({ error: code }), "fail");
async function futureApprovedPaidRevision(db, {
  env,
  registry,
  proposal,
  approval,
  requestId,
  entry,
  action,
  at
}) {
  if (!registry) return null;
  const original = await db.prepare(
    "SELECT 'credit_card' kind,homeflow_request_id receipt_id,requester_user_id spender FROM family_card_purchase_applied WHERE entry_id=? AND household_id=? UNION ALL SELECT 'prepaid' kind,homeflow_request_id receipt_id,requester_user_id spender FROM family_prepaid_actions_applied WHERE entry_id=? AND household_id=? AND action='spend' LIMIT 2"
  ).bind(
    registry.entry_id,
    proposal.household_id,
    registry.entry_id,
    proposal.household_id
  ).all();
  if (!original?.results?.length) return null;
  if (original.results.length !== 1) return fail8("CORRECTION_AMBIGUOUS_ORIGINAL");
  if (env.KAKEIBO_ACCOUNT_CORRECTIONS_ENABLED !== "true")
    return fail8("CORRECTION_EXECUTOR_DISABLED");
  if (!["update", "delete", "restore"].includes(action))
    return fail8("CORRECTION_UNKNOWN_ACTION");
  const source = original.results[0];
  const physical = await db.prepare(
    "SELECT id,date,amount,type,payment_source,family_account_id,client_request_id FROM entries WHERE id=? LIMIT 1"
  ).bind(registry.entry_id).first();
  const validCard = !!physical?.family_account_id && spendSource(physical.payment_source) && physical.payment_source.split(":")[1] === physical.family_account_id;
  const validCash2 = physical?.family_account_id === null && physical?.payment_source === "" && !!await db.prepare("SELECT 1 FROM family_approved_account_corrections WHERE entry_id=? AND version_after=? AND json_extract(after_json,'$.accountId') IS NULL AND CAST(json_extract(after_json,'$.amount') AS INTEGER)=? LIMIT 1").bind(registry.entry_id, registry.version, physical.amount).first();
  if (!physical || physical.type !== "expense" || !(validCard || validCash2) || physical.client_request_id !== "hf" + (source.kind === "credit_card" ? "card" : "prepaid") + ":" + source.receipt_id)
    return fail8("CORRECTION_ORIGINAL_ENTRY_CHANGED");
  let previous;
  try {
    previous = JSON.parse(registry.snapshot_json);
  } catch {
    return fail8("CORRECTION_SNAPSHOT_INVALID");
  }
  if (previous?.type !== "expense" || previous.date !== physical.date || (previous.payment_source || "") !== physical.payment_source || (action === "restore" ? physical.amount !== 0 : previous.amount !== physical.amount || physical.amount < 1))
    return fail8("CORRECTION_SNAPSHOT_CHANGED");
  const next = action === "delete" ? { ...previous, amount: 0 } : action === "restore" ? previous : entry;
  if (!next || next.type !== "expense" || action !== "delete" && next.amount < 1)
    return fail8("CORRECTION_INVALID_NEXT_ENTRY");
  const explicit = action === "update" && Object.hasOwn(next, "payment_source");
  const newSource = explicit ? next.payment_source : physical.payment_source;
  if (newSource !== "" && !spendSource(newSource)) return fail8("CORRECTION_TARGET_MUST_BE_PERSONAL_ACCOUNT");
  const newAccountId = newSource === "" ? null : newSource.split(":")[1];
  if (explicit && newAccountId !== physical.family_account_id && proposal.requester_user_id !== source.spender)
    return fail8("CORRECTION_OTHER_PERSON_ACCOUNT_READ_ONLY");
  const rows = await db.prepare(
    "SELECT account_id,owner_user_id,account_kind,origin,is_archived,closing_day FROM family_financial_accounts WHERE household_id=? AND owner_user_id=?"
  ).bind(proposal.household_id, source.spender).all();
  const accounts = rows.results || [];
  const target = newAccountId ? accounts.find((x) => x.account_id === newAccountId) : null;
  if (newAccountId && (!target || newSource !== (target.account_kind === "credit_card" ? "cc:" : "prepaid:") + newAccountId))
    return fail8("CORRECTION_ACCOUNT_KIND_MISMATCH");
  const prepaid = await memberPrepaidBalances(db, proposal.household_id);
  if (!prepaid) return fail8("CORRECTION_PREPAID_BALANCE_UNKNOWN");
  const balances = Object.fromEntries(prepaid.accounts.map((x) => [x.account_id, x.balance_jpy]));
  const settlement = await db.prepare(
    "SELECT COALESCE(SUM(amount_jpy),0) amount FROM family_card_settlement_allocations WHERE purchase_request_id=?"
  ).bind(source.receipt_id).first();
  const points = await db.prepare(
    "SELECT COALESCE(SUM(o.amount_jpy-COALESCE(r.restored_jpy,0)),0) amount FROM family_points_card_offsets o LEFT JOIN family_points_card_offset_refunds r ON r.original_request_id=o.homeflow_request_id WHERE o.purchase_request_id=?"
  ).bind(source.receipt_id).first();
  const before = {
    type: "expense",
    date: physical.date,
    amount: physical.amount,
    accountId: physical.family_account_id
  };
  const after = {
    type: "expense",
    date: next.date,
    amount: next.amount,
    accountId: newAccountId
  };
  let planned;
  try {
    planned = planAccountLinkedExpenseCorrection({
      before,
      after,
      accounts,
      spenderUserId: source.spender,
      editorUserId: proposal.requester_user_id,
      prepaidBalances: balances,
      settledJpy: Number(settlement?.amount || 0),
      offsetJpy: Number(points?.amount || 0),
      operation: action
    });
  } catch (err) {
    return fail8(err.code || "CORRECTION_PLAN_INVALID");
  }
  const commands = [db.prepare("INSERT INTO family_approved_account_corrections (homeflow_request_id,proposal_id,household_id,entry_id,spender_user_id,requester_user_id,approver_user_id,version_before,version_after,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(
    requestId,
    proposal.proposal_id,
    proposal.household_id,
    registry.entry_id,
    source.spender,
    proposal.requester_user_id,
    approval.approver_user_id,
    registry.version,
    registry.version + 1,
    JSON.stringify(before),
    JSON.stringify(after),
    at
  )];
  const originalAccount = accounts.find((x) => x.account_id === physical.family_account_id);
  const oldMonth = originalAccount?.account_kind === "credit_card" ? closingMonth(physical.date, originalAccount.closing_day) : null;
  const nextMonth = target?.account_kind === "credit_card" ? closingMonth(next.date, target.closing_day) : null;
  for (const x of planned.effects) {
    const beforeCount = Number(before.amount) > 0 && x.kind === "credit_card" && x.accountId === physical.family_account_id && x.billMonth === oldMonth ? 1 : 0;
    const afterCount = Number(after.amount) > 0 && x.kind === "credit_card" && x.accountId === newAccountId && x.billMonth === nextMonth ? 1 : 0;
    const count = afterCount - beforeCount;
    commands.push(db.prepare("INSERT INTO family_approved_account_effects (homeflow_request_id,household_id,account_id,account_kind,bill_month,delta_jpy,purchase_count_delta,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(
      requestId,
      proposal.household_id,
      x.accountId,
      x.kind,
      x.billMonth || "",
      x.deltaJpy,
      count,
      at
    ));
  }
  return {
    commands,
    originalClientId: physical.client_request_id,
    originalAccountId: physical.family_account_id,
    newAccountId,
    paymentSource: newSource,
    amount: physical.amount,
    date: physical.date,
    requiresApproval: true
  };
}
__name(futureApprovedPaidRevision, "futureApprovedPaidRevision");

// functions/api/internal/shared-entries/[[path]].js
var enc11 = new TextEncoder();
var h642 = /^[a-f0-9]{64}$/i;
var id324 = /^[a-f0-9]{32}$/i;
var uuid8 = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
var reply3 = /* @__PURE__ */ __name((x, s = 200) => Response.json(x, { status: s, headers: { "cache-control": "no-store" } }), "reply");
var fail9 = /* @__PURE__ */ __name((code, s = 409) => reply3({ ok: false, code, applied: false }, s), "fail");
var exact9 = /* @__PURE__ */ __name((x, keys) => !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).sort().join(",") === keys.slice().sort().join(","), "exact");
var digest = /* @__PURE__ */ __name(async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc11.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join(""), "digest");
var ready5 = /* @__PURE__ */ __name((e) => e.APP_ENV === "production" && e.KAKEIBO_FAMILY_FINANCE_ENABLED === "true" && e.KAKEIBO_SHARED_ENTRY_ENABLED === "true" && e.KAKEIBO_SHARED_MUTATION_APPROVAL_ENABLED === "true" && h642.test(e.KAKEIBO_FAMILY_PENDING_KEY || "") && h642.test(e.KAKEIBO_SHARED_MUTATION_EXECUTION_SECRET || "") && h642.test(e.KAKEIBO_SHARED_MUTATION_PROOF_SECRET || "") && e.DB?.prepare && typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch === "function" && /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN || ""), "ready");
async function mac6(secret, domain, stamp, raw) {
  const k = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(secret.match(/.{2}/g), (x) => parseInt(x, 16)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc11.encode(domain + "\n" + stamp + "\n" + raw)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
__name(mac6, "mac");
async function signed6(req, e, mode) {
  if (req.method !== "POST" || req.headers.has("origin") || req.headers.has("cookie") || req.headers.has("authorization") || req.headers.get("x-approval-client") !== "homeflow" || req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    return null;
  const stamp = req.headers.get("x-approval-timestamp") || "", sig = req.headers.get("x-approval-signature") || "";
  if (!/^\d{13}$/.test(stamp) || Math.abs(Date.now() - Number(stamp)) > 3e5 || !h642.test(sig)) return null;
  let raw, b;
  try {
    raw = await req.text();
    b = raw.length <= 1200 ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!exact9(b, mode === "execute" ? [
    "request_id",
    "resource_id",
    "household_id",
    "requester_user_id",
    "payload_sha256",
    "execution_nonce"
  ] : mode === "preview" ? [
    "request_id",
    "resource_id",
    "household_id",
    "requester_user_id",
    "payload_sha256",
    "approver_user_id"
  ] : ["request_id", "resource_id", "household_id", "requester_user_id", "payload_sha256"]) || !uuid8.test(b.request_id) || !id324.test(b.resource_id) || !h642.test(b.payload_sha256) || mode === "execute" && !h642.test(b.execution_nonce) || !b.household_id || !b.requester_user_id)
    return null;
  const expected = await mac6(
    e.KAKEIBO_SHARED_MUTATION_EXECUTION_SECRET,
    "homeflow:shared-entry-" + mode,
    stamp,
    raw
  );
  return sig.toLowerCase() === expected ? b : null;
}
__name(signed6, "signed");
async function readIntent(e, p) {
  try {
    p = await resolveSharedMutationSealedReference(e.DB, p);
    if (!p) return null;
    const iv = Uint8Array.from(atob(p.payload_iv), (x) => x.charCodeAt(0));
    const cipher = Uint8Array.from(atob(p.payload_cipher), (x) => x.charCodeAt(0));
    if (iv.length !== 12 || cipher.length < 16 || cipher.length > 2500) return null;
    const key2 = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(
        e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),
        (x) => parseInt(x, 16)
      ),
      "AES-GCM",
      false,
      ["decrypt"]
    );
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: enc11.encode("kakeibo-shared-mutation:" + p.proposal_id)
    }, key2, cipher));
    if (await digest(raw) !== p.payload_sha256) return null;
    const d = JSON.parse(raw);
    if (!exact9(d, ["operation", "resource_id", "expected_version", "entry"]) || d.operation !== p.operation || d.resource_id !== p.resource_id || d.expected_version !== p.expected_version || !["create", "update", "delete", "restore"].includes(d.operation) || (d.operation === "create" || d.operation === "update") !== !!d.entry) return null;
    if (d.entry) {
      const x = d.entry, keys = ["date", "time", "amount", "type", "category", "merchant", "note"];
      const paid = exact9(x, [...keys, "payment_source"]);
      const spouse = exact9(x, [...keys, "transfer_target", "transfer_date"]);
      if (!(exact9(x, keys) || paid || spouse) || !/^20\d{2}-\d\d-\d\d$/.test(x.date) || (/* @__PURE__ */ new Date(x.date + "T00:00:00Z")).toISOString().slice(0, 10) !== x.date || x.time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(x.time) || !Number.isSafeInteger(x.amount) || x.amount < 1 || x.amount > 1e7 || !["expense", "income", "transfer"].includes(x.type) || x.type === "transfer" && (!spouse || x.transfer_target !== "spouse" || x.transfer_date !== x.date || x.category !== "\u6295\u8CC7\u30FB\u8CC7\u7523\u79FB\u52D5" || x.merchant !== "\u914D\u5076\u3078\u306E\u632F\u66FF") || x.type !== "transfer" && spouse || !x.category || x.category.length > 100 || typeof x.merchant !== "string" || x.merchant.length > 120 || typeof x.note !== "string" || x.note.length > 500 || paid && (x.type !== "expense" || typeof x.payment_source !== "string" || d.operation !== "update" && !x.payment_source.trim() || x.payment_source.length > 80 || x.payment_source !== x.payment_source.trim())) return null;
    }
    return d;
  } catch {
    return null;
  }
}
__name(readIntent, "readIntent");
async function proof6(e, b, expectedVersion, operation) {
  const envelope = {
    ...b,
    idempotency_key: "kakeibo:shared-entry:" + b.resource_id,
    expected_version: expectedVersion,
    purpose: "execute"
  };
  const raw = JSON.stringify(envelope), stamp = String(Date.now());
  try {
    const response3 = await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
      new URL("/api/internal/approvals/verify", e.HOMEFLOW_OAUTH_ORIGIN),
      {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "x-approval-client": "kakeibo-shared-entry",
          "x-approval-timestamp": stamp,
          "x-approval-signature": await mac6(
            e.KAKEIBO_SHARED_MUTATION_PROOF_SECRET,
            "kakeibo-shared-entry:execution-proof",
            stamp,
            raw
          )
        },
        body: raw
      }
    ));
    if (response3.status !== 200 || response3.headers.has("location")) return null;
    const t = await response3.text(), r = t.length <= 2200 ? JSON.parse(t) : null;
    return r?.ok === true && r.verified === true && r.execution_authorized === true && r.execution_status === "executing" && r.source_app === "kakebo" && r.target_app === "kakebo" && r.resource_type === "shared_entry_mutation" && r.operation === "finance.entry." + operation && r.idempotency_key === envelope.idempotency_key && r.expected_version === expectedVersion && r.request_id === b.request_id && r.resource_id === b.resource_id && r.payload_sha256 === b.payload_sha256 && r.household_id === b.household_id && r.requester_user_id === b.requester_user_id && r.approver_user_id && r.approver_user_id !== b.requester_user_id && Number.isSafeInteger(r.approved_at) && Number.isSafeInteger(r.expires_at) && r.expires_at > Date.now() && r.applied === false ? r : null;
  } catch {
    return null;
  }
}
__name(proof6, "proof");
var same5 = /* @__PURE__ */ __name((j, b) => j && j.homeflow_request_id === b.request_id && j.proposal_id === b.resource_id && j.household_id === b.household_id && j.requester_user_id === b.requester_user_id && j.payload_sha256 === b.payload_sha256, "same");
async function receipt6(db, j, b, replayed) {
  const [audit, r, p] = await Promise.all([
    db.prepare("SELECT * FROM family_shared_entry_audit WHERE resource_id=? AND to_version=? LIMIT 1").bind(j.resource_id, j.version_after).first(),
    db.prepare("SELECT * FROM family_shared_entry_registry WHERE resource_id=? AND entry_id=? LIMIT 1").bind(j.resource_id, j.entry_id).first(),
    db.prepare("SELECT * FROM family_shared_mutation_intents WHERE proposal_id=?").bind(j.proposal_id).first()
  ]);
  if (!same5(j, b) || !audit || !r || !p || audit.action !== j.action || audit.actor_user_id !== j.approver_user_id || audit.from_version !== j.version_before || audit.to_version !== j.version_after || r.household_id !== j.household_id || p.homeflow_approval_id !== j.homeflow_request_id || p.operation !== j.action || p.payload_sha256 !== j.payload_sha256) return fail9("SHARED_MUTATION_RECEIPT_COUNTERPART_UNKNOWN", 503);
  return reply3({
    ok: true,
    applied: true,
    approval_id: j.homeflow_request_id,
    proposal_id: j.proposal_id,
    household_id: j.household_id,
    requester_user_id: j.requester_user_id,
    approver_user_id: j.approver_user_id,
    actor_user_id: j.actor_user_id,
    payload_sha256: j.payload_sha256,
    operation: "finance.entry." + j.action,
    resource_type: "shared_entry_mutation",
    action: j.action,
    resource_id: j.resource_id,
    entry_id: j.entry_id,
    version_before: j.version_before,
    version_after: j.version_after,
    applied_at: j.applied_at,
    already_applied: replayed,
    entry_type: "ordinary_income_expense",
    immutable_receipt: true,
    financial_journal_rewritten: false
  });
}
__name(receipt6, "receipt");
async function write(e, p, b, approval, payload2) {
  const db = e.DB, at = Date.now();
  const source = await db.prepare("SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=?").bind(p.requester_user_id, p.household_id).first();
  const owner = await db.prepare("SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=?").bind(approval.approver_user_id, p.household_id).first();
  if (source?.state !== "active" || source.role !== "member" || owner?.state !== "active" || owner.role !== "owner")
    return fail9("SHARED_MUTATION_CURRENT_ROLE_REVOKED", 403);
  const action = p.operation, newRecord = action === "create";
  const registry = newRecord ? null : await db.prepare("SELECT * FROM family_shared_entry_registry WHERE resource_id=? AND household_id=? LIMIT 1").bind(p.resource_id, p.household_id).first();
  if (!newRecord && (!registry || registry.version !== p.expected_version || registry.state !== (action === "restore" ? "deleted" : "active")))
    return fail9("SHARED_MUTATION_TARGET_CAS_CHANGED");
  const id6 = newRecord ? (await digest([
    p.household_id,
    approval.approver_user_id,
    "shared-entry",
    "approved:" + p.proposal_id
  ].join("\0"))).slice(0, 32) : registry.resource_id;
  if (newRecord && await db.prepare("SELECT 1 FROM family_shared_entry_registry WHERE resource_id=?").bind(id6).first()) return fail9("SHARED_MUTATION_RESOURCE_COLLISION");
  const adopted = !newRecord && e.KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED === "true" ? await db.prepare("SELECT * FROM family_legacy_shared_adoptions WHERE resource_id=? AND entry_id=? AND household_id=? AND original_owner_user_id=? LIMIT 1").bind(registry.resource_id, registry.entry_id, p.household_id, approval.approver_user_id).first() : null;
  let original = null;
  if (adopted) {
    const acct = await db.prepare("SELECT owner_user_id,household_id,is_archived FROM family_financial_accounts WHERE account_id=? LIMIT 1").bind(adopted.account_id).first();
    try {
      original = JSON.parse(adopted.original_row_json);
    } catch {
      return fail9("SHARED_MUTATION_LEGACY_ROW_INVALID");
    }
    if (!original || typeof original !== "object" || Array.isArray(original) || Object.keys(original).length > 40 || Object.keys(original).some((k) => !/^[a-z][a-z0-9_]*$/i.test(k)) || Object.values(original).some((v) => v !== null && typeof v !== "string" && !(typeof v === "number" && Number.isSafeInteger(v))) || original.id !== registry.entry_id || original.family_account_id !== adopted.account_id || original.client_request_id !== adopted.original_client_request_id || original.family_transfer_target_account_id !== null || acct?.owner_user_id !== approval.approver_user_id || acct.household_id !== p.household_id || acct.is_archived !== 0)
      return fail9("SHARED_MUTATION_LEGACY_OWNER_OR_PROVENANCE_CHANGED", 409);
  }
  const previous = registry ? JSON.parse(registry.snapshot_json) : null;
  if (!newRecord && previous?.type === "transfer" && (previous.transfer_target !== "spouse" || action === "update" && (payload2.entry.type !== "transfer" || payload2.entry.transfer_target !== "spouse")))
    return fail9("SHARED_MUTATION_TRANSFER_TYPE_LOCKED", 409);
  const explicitPayment = action === "update" && Object.hasOwn(payload2.entry, "payment_source");
  const paidRevision = !newRecord && !adopted && e.KAKEIBO_ACCOUNT_CORRECTIONS_ENABLED === "true" ? await futureApprovedPaidRevision(db, {
    env: e,
    registry,
    proposal: p,
    approval,
    requestId: b.request_id,
    entry: payload2.entry,
    action,
    at
  }) : null;
  if (paidRevision?.error) return fail9(paidRevision.error, 409);
  if (!newRecord && !adopted && !paidRevision) {
    const originalAccount = await db.prepare("SELECT family_account_id,client_request_id FROM entries WHERE id=?").bind(registry.entry_id).first();
    if (originalAccount?.family_account_id && /^hf(?:card|prepaid):/.test(originalAccount.client_request_id || ""))
      return fail9("CORRECTION_EXECUTOR_DISABLED", 503);
  }
  if (explicitPayment && !paidRevision && e.KAKEIBO_MEMBER_PAYMENT_REASSIGNMENT_ENABLED !== "true")
    return fail9("SHARED_PAYMENT_EXECUTOR_NOT_READY", 503);
  let originalPayment = "";
  if (action === "update") {
    const physical = await db.prepare("SELECT type,payment_source,family_account_id FROM entries WHERE id=? LIMIT 1").bind(registry.entry_id).first();
    if (!physical) return fail9("SHARED_MUTATION_ENTRY_MISSING", 409);
    originalPayment = String(physical.payment_source || "");
    if (physical.type === "expense" && originalPayment && payload2.entry.type !== "expense")
      return fail9("SHARED_MUTATION_CARD_TYPE_LOCKED", 409);
    if (explicitPayment && !paidRevision) {
      const author = await db.prepare("SELECT requester_user_id FROM family_shared_mutation_applied WHERE entry_id=? AND action='create' LIMIT 1").bind(registry.entry_id).first();
      if (author?.requester_user_id !== p.requester_user_id || physical.family_account_id !== null || physical.type !== "expense" || payload2.entry.type !== "expense" || adopted)
        return fail9("SHARED_MUTATION_PAYMENT_OWNER_MISMATCH", 403);
      if (payload2.entry.payment_source) {
        const granted = await db.prepare("SELECT 1 FROM family_legacy_card_shares s JOIN payment_sources card ON card.name=s.card_name WHERE s.card_name=? AND s.household_id=? AND s.grantee_user_id=? AND s.owner_user_id=? AND s.is_active=1 AND card.is_archived=0 AND card.stat_group='card' AND card.source_type IN ('standard','prepaid') LIMIT 1").bind(
          payload2.entry.payment_source,
          p.household_id,
          p.requester_user_id,
          approval.approver_user_id
        ).first();
        if (!granted) return fail9("SHARED_CARD_GRANT_REVOKED", 403);
      }
    }
  }
  const entry = action === "restore" ? previous : action === "update" && !explicitPayment && previous?.payment_source ? { ...payload2.entry, payment_source: previous.payment_source } : payload2.entry;
  if (action === "restore" && entry?.payment_source && !paidRevision) {
    const active = await db.prepare("SELECT 1 FROM family_legacy_card_shares s JOIN payment_sources card ON card.name=s.card_name WHERE s.card_name=? AND s.household_id=? AND s.grantee_user_id=? AND s.owner_user_id=? AND s.is_active=1 AND card.is_archived=0 AND card.stat_group='card' AND card.source_type IN ('standard','prepaid') LIMIT 1").bind(entry.payment_source, p.household_id, p.requester_user_id, approval.approver_user_id).first();
    if (!active) return fail9("SHARED_CARD_GRANT_REVOKED", 403);
  }
  const snapshot = action === "delete" ? registry.snapshot_json : JSON.stringify(entry);
  const sha4 = await digest(snapshot);
  const reference = "hfshare:" + id6;
  const stmts = [];
  if (newRecord) {
    if (entry.payment_source) {
      stmts.push(db.prepare("INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source) SELECT ?,?,?,?,?,?,'',?,?,card.name FROM family_legacy_card_shares s JOIN payment_sources card ON card.name=s.card_name JOIN homeflow_identity_links o ON o.user_id=s.owner_user_id WHERE s.card_name=? AND s.household_id=? AND s.owner_user_id=? AND s.grantee_user_id=? AND s.is_active=1 AND card.is_archived=0 AND card.stat_group='card' AND card.source_type IN ('standard','prepaid') AND o.household_id=s.household_id AND o.role='owner' AND o.state='active'").bind(
        entry.date,
        entry.time,
        entry.amount,
        entry.category,
        entry.merchant,
        entry.note,
        entry.type,
        reference,
        entry.payment_source,
        p.household_id,
        approval.approver_user_id,
        p.requester_user_id
      ));
    } else if (entry.type === "transfer") {
      stmts.push(db.prepare("INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source,transfer_target,transfer_date,transfer_applied) VALUES(?,?,?,?,?,?,'',?,?,'','spouse',?,0)").bind(entry.date, entry.time, entry.amount, entry.category, entry.merchant, entry.note, "transfer", reference, entry.date));
    } else {
      stmts.push(db.prepare("INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source) VALUES(?,?,?,?,?,?,'',?,?,'')").bind(entry.date, entry.time, entry.amount, entry.category, entry.merchant, entry.note, entry.type, reference));
    }
    stmts.push(db.prepare("INSERT INTO family_shared_entry_write_context (resource_id,entry_id,actor_user_id,action,expected_version,stamp) SELECT ?,id,?,'create',0,? FROM entries WHERE client_request_id=? AND changes()=1").bind(id6, approval.approver_user_id, at, reference));
    stmts.push(db.prepare("INSERT INTO family_shared_entry_registry (resource_id,household_id,entry_id,creator_user_id,last_actor_user_id,state,version,snapshot_json,payload_sha256,created_at,updated_at) SELECT ?,?,id,?,?,'active',1,?,?,?,? FROM entries WHERE client_request_id=? AND changes()=1").bind(id6, p.household_id, approval.approver_user_id, approval.approver_user_id, snapshot, sha4, at, at, reference));
  } else {
    stmts.push(db.prepare("INSERT INTO family_shared_entry_write_context (resource_id,entry_id,actor_user_id,action,expected_version,stamp) VALUES(?,?,?,?,?,?)").bind(id6, registry.entry_id, approval.approver_user_id, action, p.expected_version, at));
    const where = adopted ? "client_request_id IS ? AND family_account_id=?" : "client_request_id=? AND family_account_id IS NULL";
    const sourceArgs = adopted ? [adopted.original_client_request_id, adopted.account_id] : [reference];
    const spouseRevision = entry?.type === "transfer" || previous?.type === "transfer";
    if (paidRevision) {
      const revised = action === "delete" ? { ...previous, amount: 0 } : entry;
      stmts.push(...paidRevision.commands);
      stmts.push(db.prepare("UPDATE entries SET date=?,time=?,amount=?,category=?,merchant=?,note=?,type=?,payment_source=?,family_account_id=? WHERE id=? AND client_request_id=? AND family_account_id IS ? AND type='expense' AND date=? AND amount=?").bind(
        revised.date,
        revised.time,
        revised.amount,
        revised.category,
        revised.merchant,
        revised.note,
        "expense",
        paidRevision.paymentSource,
        paidRevision.newAccountId,
        registry.entry_id,
        paidRevision.originalClientId,
        paidRevision.originalAccountId,
        paidRevision.date,
        paidRevision.amount
      ));
    } else if (action === "update") stmts.push(spouseRevision ? db.prepare("UPDATE entries SET date=?,time=?,amount=?,category=?,merchant=?,note=?,type=?,transfer_target=?,transfer_date=?,transfer_applied=0" + (explicitPayment ? ",payment_source=?" : "") + " WHERE id=? AND " + where + " AND family_transfer_target_account_id IS NULL AND (type IN('income','expense') OR (type='transfer' AND transfer_target='spouse'))").bind(
      entry.date,
      entry.time,
      entry.amount,
      entry.category,
      entry.merchant,
      entry.note,
      entry.type,
      entry.type === "transfer" ? "spouse" : null,
      entry.type === "transfer" ? entry.date : null,
      ...explicitPayment ? [entry.payment_source] : [],
      registry.entry_id,
      ...sourceArgs
    ) : db.prepare("UPDATE entries SET date=?,time=?,amount=?,category=?,merchant=?,note=?,type=?" + (explicitPayment ? ",payment_source=?" : "") + " WHERE id=? AND " + where + " AND family_transfer_target_account_id IS NULL AND type IN('income','expense')").bind(
      entry.date,
      entry.time,
      entry.amount,
      entry.category,
      entry.merchant,
      entry.note,
      entry.type,
      ...explicitPayment ? [entry.payment_source] : [],
      registry.entry_id,
      ...sourceArgs
    ));
    else if (action === "delete") stmts.push(db.prepare("DELETE FROM entries WHERE id=? AND " + where + (spouseRevision ? " AND (type IN('income','expense') OR (type='transfer' AND transfer_target='spouse')) AND family_transfer_target_account_id IS NULL" : " AND type IN('income','expense') AND family_transfer_target_account_id IS NULL")).bind(registry.entry_id, ...sourceArgs));
    else if (adopted) {
      const old = { ...original, ...entry }, columns = Object.keys(old);
      stmts.push(db.prepare("INSERT INTO entries(" + columns.map((k) => '"' + k + '"').join(",") + ") VALUES(" + columns.map(() => "?").join(",") + ")").bind(...columns.map((k) => old[k])));
    } else stmts.push(entry.type === "transfer" ? db.prepare("INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source,transfer_target,transfer_date,transfer_applied) VALUES(?,?,?,?,?,?,?,'',?,?,?,?,?,0)").bind(registry.entry_id, entry.date, entry.time, entry.amount, entry.category, entry.merchant, entry.note, entry.type, reference, entry.payment_source || "", "spouse", entry.date) : db.prepare("INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source) VALUES(?,?,?,?,?,?,?,'',?,?,?)").bind(registry.entry_id, entry.date, entry.time, entry.amount, entry.category, entry.merchant, entry.note, entry.type, reference, entry.payment_source || ""));
    stmts.push(db.prepare("UPDATE family_shared_entry_registry SET version=version+1,state=?,snapshot_json=?,payload_sha256=?,last_actor_user_id=?,updated_at=?,deleted_at=CASE WHEN ?='delete' THEN ? WHEN ?='restore' THEN NULL ELSE deleted_at END WHERE resource_id=? AND household_id=? AND state=? AND version=?").bind(
      action === "delete" ? "deleted" : "active",
      snapshot,
      sha4,
      approval.approver_user_id,
      at,
      action,
      at,
      action,
      id6,
      p.household_id,
      action === "restore" ? "deleted" : "active",
      registry.version
    ));
  }
  stmts.push(db.prepare("INSERT INTO family_shared_mutation_applied (homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,actor_user_id,resource_id,entry_id,action,version_before,version_after,payload_sha256,applied_at) SELECT ?,?,?,?,?,?,?,entry_id,?,?,?,?,? FROM family_shared_entry_registry WHERE resource_id=?").bind(
    b.request_id,
    p.proposal_id,
    p.household_id,
    p.requester_user_id,
    approval.approver_user_id,
    approval.approver_user_id,
    id6,
    action,
    p.expected_version,
    p.expected_version + 1,
    p.payload_sha256,
    at,
    id6
  ));
  stmts.push(db.prepare("DELETE FROM family_shared_entry_write_context WHERE resource_id=?").bind(id6));
  let metadataConfirmed = false, batchThrew = false;
  try {
    const result2 = await db.batch(stmts);
    metadataConfirmed = result2.length === stmts.length && result2.every((x) => x.meta?.changes === 1);
  } catch {
    batchThrew = true;
  }
  const saved = await db.prepare("SELECT * FROM family_shared_mutation_applied WHERE homeflow_request_id=?").bind(b.request_id).first().catch(() => null);
  if (same5(saved, b)) return receipt6(db, saved, b, batchThrew || !metadataConfirmed);
  if (batchThrew) return fail9("SHARED_MUTATION_BATCH_ROLLED_BACK", 503);
  return fail9(metadataConfirmed ? "SHARED_MUTATION_RECEIPT_UNKNOWN" : "SHARED_MUTATION_ATOMIC_CONFIRMATION_REQUIRED", 503);
}
__name(write, "write");
async function preview(e, b) {
  const db = e.DB;
  const owner = await db.prepare("SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=? LIMIT 1").bind(b.approver_user_id, b.household_id).first();
  const member = await db.prepare("SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=? LIMIT 1").bind(b.requester_user_id, b.household_id).first();
  if (owner?.role !== "owner" || owner.state !== "active" || member?.role !== "member" || member.state !== "active" || b.approver_user_id === b.requester_user_id) return fail9("SHARED_MUTATION_PREVIEW_FORBIDDEN", 403);
  const p = await db.prepare("SELECT * FROM family_shared_mutation_intents WHERE proposal_id=? AND homeflow_approval_id=? AND household_id=? AND requester_user_id=? AND payload_sha256=? LIMIT 1").bind(b.resource_id, b.request_id, b.household_id, b.requester_user_id, b.payload_sha256).first();
  if (!p || p.status !== "submitted") return fail9("SHARED_MUTATION_PREVIEW_NOT_FOUND", 404);
  const intent = await readIntent(e, p);
  if (!intent) return fail9("SHARED_MUTATION_PREVIEW_UNAVAILABLE", 503);
  let before = null;
  if (p.operation !== "create") {
    const r = await db.prepare("SELECT snapshot_json,state,version FROM family_shared_entry_registry WHERE resource_id=? AND household_id=? LIMIT 1").bind(p.resource_id, p.household_id).first();
    if (r?.snapshot_json) {
      try {
        before = JSON.parse(r.snapshot_json);
      } catch {
        return fail9("SHARED_MUTATION_PREVIEW_UNAVAILABLE", 503);
      }
    }
  }
  return reply3({
    ok: true,
    approval_id: b.request_id,
    proposal_id: p.proposal_id,
    operation: "finance.entry." + p.operation,
    ledger_changed: false,
    entry: intent.entry || null,
    before,
    expected_version: p.expected_version
  });
}
__name(preview, "preview");
async function approvedSharedMutationRoute(req, e, parts) {
  if (!ready5(e)) return fail9("SHARED_MUTATION_EXECUTION_DISABLED", 503);
  if (parts.length !== 1 || !["execute", "receipt", "preview"].includes(parts[0])) return fail9("NOT_FOUND", 404);
  const mode = parts[0], b = await signed6(req, e, mode);
  if (!b || mode === "preview" && (!b.approver_user_id || typeof b.approver_user_id !== "string" || b.approver_user_id.length > 128))
    return fail9("SHARED_MUTATION_SIGNATURE_REQUIRED", 403);
  if (mode === "preview") return preview(e, b);
  const db = e.DB;
  const prev = await db.prepare("SELECT * FROM family_shared_mutation_applied WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1").bind(b.request_id, b.resource_id).first();
  if (prev) return same5(prev, b) ? receipt6(db, prev, b, true) : fail9("SHARED_MUTATION_APPROVAL_CONFLICT");
  if (mode === "receipt") return fail9("SHARED_MUTATION_RECEIPT_UNKNOWN", 404);
  const p = await db.prepare("SELECT * FROM family_shared_mutation_intents WHERE proposal_id=? AND homeflow_approval_id=? LIMIT 1").bind(b.resource_id, b.request_id).first();
  if (!p || p.status !== "submitted" || p.household_id !== b.household_id || p.requester_user_id !== b.requester_user_id || p.payload_sha256 !== b.payload_sha256 || p.expires_at <= Date.now()) return fail9("SHARED_MUTATION_INTENT_NOT_CURRENT");
  const payload2 = await readIntent(e, p);
  if (!payload2) return fail9("SHARED_MUTATION_SEALED_INTENT_INVALID");
  const approved = await proof6(e, b, p.expected_version, p.operation);
  if (!approved) return fail9("SHARED_MUTATION_OWNER_PROOF_INVALID", 409);
  return write(e, p, b, approved, payload2);
}
__name(approvedSharedMutationRoute, "approvedSharedMutationRoute");
async function onRequest6({ request, env, params }) {
  return approvedSharedMutationRoute(request, env, params.path || []);
}
__name(onRequest6, "onRequest");

// functions/api/family-finance/recurring-ledger.js
var enc12 = new TextEncoder();
var reply4 = /* @__PURE__ */ __name((x, s = 200) => Response.json(x, { status: s, headers: { "cache-control": "no-store" } }), "reply");
var fail10 = /* @__PURE__ */ __name((code, s = 409) => reply4({ ok: false, code, applied: false }, s), "fail");
var wireFields = [
  "occurrence_id",
  "policy_id",
  "household_id",
  "member_user_id",
  "plan_resource_id",
  "plan_payload_sha256",
  "source_account_version",
  "period_key",
  "due_date",
  "amount_jpy",
  "entry_intent_sha256"
];
var isSame = /* @__PURE__ */ __name((j, x) => !!j && wireFields.every((k) => j[k] === x[k]), "isSame");
async function recurringFinanceReceipt(db, intent, replayed) {
  const j = await db.prepare("SELECT * FROM family_recurring_execution_applied WHERE occurrence_id=? LIMIT 1").bind(intent.occurrence_id).first();
  if (!isSame(j, intent)) return fail10("RECURRING_EXECUTION_RECEIPT_UNKNOWN", 404);
  const [entry, audit, lot] = await Promise.all([
    db.prepare("SELECT * FROM entries WHERE id=?").bind(j.target_entry_id).first(),
    db.prepare("SELECT * FROM family_recurring_execution_audit WHERE occurrence_id=?").bind(j.occurrence_id).first(),
    j.plan_type === "sbi_tsumitate" ? db.prepare("SELECT * FROM family_recurring_sbi_lots WHERE occurrence_id=?").bind(j.occurrence_id).first() : Promise.resolve(null)
  ]);
  if (!entry || !audit || audit.member_user_id !== j.member_user_id || audit.owner_authorizer_user_id !== j.owner_authorizer_user_id || audit.occurred_at !== j.target_applied_at || audit.action !== (j.plan_type === "fixed_cost" ? "fixed_cost_posted" : "sbi_tsumitate_posted") || entry.client_request_id !== "hfrecurring:" + j.occurrence_id || entry.date !== j.debit_date || entry.amount !== j.amount_jpy || entry.payment_source !== "bank:" + j.bank_account_id || entry.family_account_id !== j.bank_account_id || (j.plan_type === "fixed_cost" ? entry.type !== "expense" || entry.family_transfer_target_account_id !== null : !lot || entry.type !== "transfer" || entry.transfer_applied !== 1 || entry.family_transfer_target_account_id !== j.securities_account_id || entry.transfer_target !== "sbi:" + j.securities_account_id || entry.transfer_date !== j.effective_date || lot.broker_reference_hash !== j.broker_reference_hash || lot.confirmed_units !== j.confirmed_units || lot.acquisition_cost_jpy !== j.amount_jpy || lot.institution_broker_reconciled !== 0 || lot.included_in_tracked_assets !== 0))
    return fail10("RECURRING_EXECUTION_JOURNAL_COUNTERPART_UNKNOWN", 503);
  return reply4({
    ok: true,
    applied: true,
    ledger_applied: true,
    ...Object.fromEntries(wireFields.map((k) => [k, j[k]])),
    owner_authorizer_user_id: j.owner_authorizer_user_id,
    target_plan_type: j.plan_type,
    target_entry_id: j.target_entry_id,
    target_journal_sha256: j.target_journal_sha256,
    target_applied_at: j.target_applied_at,
    external_bank_verified: false,
    external_broker_verified: false,
    bank_reference_hash: j.bank_reference_hash,
    source_account_id: j.bank_account_id,
    target_securities_account_id: j.securities_account_id,
    fund_code: j.fund_code,
    confirmed_units: j.confirmed_units,
    acquisition_cost_jpy: j.plan_type === "sbi_tsumitate" ? j.amount_jpy : null,
    broker_reference_hash: j.broker_reference_hash,
    market_value_jpy: null,
    broker_reconciled: false,
    included_in_tracked_assets_jpy: false,
    already_applied: replayed
  });
}
__name(recurringFinanceReceipt, "recurringFinanceReceipt");

// functions/api/internal/recurring-finance/receipt.js
var enc13 = new TextEncoder();
var hex7 = /^[a-f0-9]{64}$/i;
var id4 = /^[a-f0-9]{32}$/i;
var uuid9 = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
var deny2 = /* @__PURE__ */ __name((code, s = 403) => Response.json(
  { ok: false, code, ledger_applied: false },
  { status: s, headers: { "cache-control": "no-store" } }
), "deny");
var fields2 = [
  "occurrence_id",
  "policy_id",
  "household_id",
  "member_user_id",
  "plan_resource_id",
  "plan_payload_sha256",
  "source_account_version",
  "period_key",
  "due_date",
  "amount_jpy",
  "entry_intent_sha256"
];
var exact10 = /* @__PURE__ */ __name((x, keys) => !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).sort().join(",") === keys.slice().sort().join(","), "exact");
async function sign(secret, stamp, raw) {
  const key2 = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(secret.match(/.{2}/g), (x) => parseInt(x, 16)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key2, enc13.encode(
    "homeflow:recurring-finance-receipt\n" + stamp + "\n" + raw
  ));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sign, "sign");
async function recurringFinanceIndependentReceipt(req, env) {
  if (env.APP_ENV !== "production" || env.KAKEIBO_FAMILY_FINANCE_ENABLED !== "true" || env.KAKEIBO_RECURRING_EXECUTION_ENABLED !== "true" || !env.DB?.prepare || !hex7.test(env.KAKEIBO_RECURRING_RECEIPT_SECRET || ""))
    return deny2("RECURRING_RECEIPT_DISABLED", 503);
  if (req.method !== "POST" || req.headers.has("origin") || req.headers.has("cookie") || req.headers.has("authorization") || req.headers.get("x-approval-client") !== "homeflow-recurring-finance" || req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    return deny2("RECURRING_RECEIPT_BACKEND_ONLY");
  const stamp = req.headers.get("x-approval-timestamp") || "", sig = req.headers.get("x-approval-signature") || "";
  if (!/^\d{13}$/.test(stamp) || Math.abs(Date.now() - Number(stamp)) > 3e5 || !hex7.test(sig))
    return deny2("RECURRING_RECEIPT_EXPIRED_SIGNATURE");
  let data, raw;
  try {
    raw = await req.text();
    data = raw.length <= 1400 ? JSON.parse(raw) : null;
  } catch {
    return deny2("RECURRING_RECEIPT_BODY", 400);
  }
  if (!exact10(data, fields2) || !id4.test(data.occurrence_id) || !uuid9.test(data.policy_id) || !id4.test(data.plan_resource_id) || !hex7.test(data.plan_payload_sha256) || !hex7.test(data.entry_intent_sha256) || typeof data.household_id !== "string" || typeof data.member_user_id !== "string" || !Number.isSafeInteger(data.source_account_version) || data.source_account_version < 1 || !Number.isSafeInteger(data.amount_jpy) || data.amount_jpy < 1 || data.amount_jpy > 1e7)
    return deny2("RECURRING_RECEIPT_BODY", 400);
  const expected = await sign(env.KAKEIBO_RECURRING_RECEIPT_SECRET, stamp, raw);
  let equal5 = 0;
  for (let i = 0; i < 64; i++) equal5 |= expected.charCodeAt(i) ^ sig.toLowerCase().charCodeAt(i);
  if (equal5) return deny2("RECURRING_RECEIPT_INVALID_SIGNATURE");
  return recurringFinanceReceipt(env.DB, data, true);
}
__name(recurringFinanceIndependentReceipt, "recurringFinanceIndependentReceipt");
async function onRequest7({ request, env }) {
  return recurringFinanceIndependentReceipt(request, env);
}
__name(onRequest7, "onRequest");

// functions/api/internal/document-finance/[[path]].js
var hex8 = /^[a-f0-9]{64}$/i;
var id325 = /^[a-f0-9]{32}$/i;
var uuid10 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var encoder = new TextEncoder();
var reply5 = /* @__PURE__ */ __name((value, status = 200) => Response.json(value, { status, headers: {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} }), "reply");
var refuse2 = /* @__PURE__ */ __name((code, status = 409) => reply5({ ok: false, code, applied: false }, status), "refuse");
var exactKeys = /* @__PURE__ */ __name((x, ks) => x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).sort().join(",") === ks.slice().sort().join(","), "exactKeys");
var equal2 = /* @__PURE__ */ __name((a, b) => {
  if (!hex8.test(a || "") || !hex8.test(b || "")) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}, "equal");
var hash7 = /* @__PURE__ */ __name(async (value) => Array.from(
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value))
  ),
  (x) => x.toString(16).padStart(2, "0")
).join(""), "hash");
async function mac7(secret, purpose, stamp, raw) {
  const bytes = Uint8Array.from(secret.match(/.{2}/g), (x) => parseInt(x, 16));
  const key2 = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key2,
    encoder.encode(purpose + "\n" + stamp + "\n" + raw)
  );
  return Array.from(new Uint8Array(signature), (x) => x.toString(16).padStart(2, "0")).join("");
}
__name(mac7, "mac");
function enabled4(env) {
  return env.APP_ENV === "production" && env.KAKEIBO_FAMILY_FINANCE_ENABLED === "true" && env.KAKEIBO_DOCUMENT_FINANCE_EXECUTION_ENABLED === "true" && env.KAKEIBO_APPROVAL_PROOF_ENABLED === "true" && hex8.test(env.KAKEIBO_DOCUMENT_FINANCE_SECRET || "") && hex8.test(env.KAKEIBO_APPROVAL_VERIFICATION_SECRET || "") && typeof env.HOMEFLOW_IDENTITY_SERVICE?.fetch === "function" && typeof env.DOCUMENT_FINANCE_SOURCE_SERVICE?.fetch === "function" && typeof env.DB?.prepare === "function" && typeof env.HOMEFLOW_OAUTH_ORIGIN === "string" && /^https:\/\/[A-Za-z0-9.-]+$/.test(env.HOMEFLOW_OAUTH_ORIGIN);
}
__name(enabled4, "enabled");
var core4 = ["request_id", "resource_id", "household_id", "requester_user_id", "payload_sha256"];
var opKeys = [
  "account_id",
  "account_version",
  "type",
  "amount_jpy",
  "date",
  "merchant",
  "category",
  "note",
  "payment_source",
  "operation_sha256",
  "execution_nonce"
];
async function input(req, env, receiptOnly) {
  if (req.method !== "POST" || req.headers.has("cookie") || req.headers.has("origin") || req.headers.has("authorization") || req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    return null;
  const stamp = req.headers.get("x-approval-timestamp");
  const sig = req.headers.get("x-approval-signature");
  if (req.headers.get("x-approval-client") !== "jp-document-assistant" || !/^\d{13}$/.test(stamp || "") || Math.abs(Date.now() - Number(stamp)) > 3e5 || !hex8.test(sig || "")) return null;
  let raw, b;
  try {
    raw = await req.text();
    if (raw.length > 2e3) return null;
    b = JSON.parse(raw);
  } catch {
    return null;
  }
  const purpose = receiptOnly ? "jpda:finance-receipt" : "jpda:finance-execute";
  if (!exactKeys(b, receiptOnly ? core4 : [...core4, ...opKeys]) || !equal2(await mac7(env.KAKEIBO_DOCUMENT_FINANCE_SECRET, purpose, stamp, raw), sig) || !uuid10.test(b.request_id) || !id325.test(b.resource_id) || !hex8.test(b.payload_sha256) || typeof b.household_id !== "string" || !b.household_id || b.household_id.length > 128 || typeof b.requester_user_id !== "string" || !b.requester_user_id || b.requester_user_id.length > 128) return null;
  if (!receiptOnly) {
    if (!id325.test(b.account_id) || !hex8.test(b.operation_sha256) || !hex8.test(b.execution_nonce) || !Number.isSafeInteger(b.account_version) || b.account_version < 1 || !["income", "expense"].includes(b.type) || !Number.isSafeInteger(b.amount_jpy) || b.amount_jpy < 1 || b.amount_jpy > 1e7 || typeof b.date !== "string" || !/^20\d\d-\d\d-\d\d$/.test(b.date) || !Number.isFinite(Date.parse(b.date + "T00:00:00Z")) || (/* @__PURE__ */ new Date(b.date + "T00:00:00Z")).toISOString().slice(0, 10) !== b.date || typeof b.merchant !== "string" || !b.merchant || b.merchant.length > 100 || typeof b.category !== "string" || !b.category || b.category.length > 80 || typeof b.note !== "string" || b.note.length > 180 || typeof b.payment_source !== "string" || !b.payment_source || b.payment_source.length > 100) return null;
    const op = {
      account_id: b.account_id,
      account_version: b.account_version,
      type: b.type,
      amount_jpy: b.amount_jpy,
      date: b.date,
      merchant: b.merchant,
      category: b.category,
      note: b.note,
      payment_source: b.payment_source
    };
    if (!equal2(await hash7(JSON.stringify(op)), b.operation_sha256)) return null;
  }
  return b;
}
__name(input, "input");
var receipt7 = /* @__PURE__ */ __name((r, already) => ({
  ok: true,
  applied: true,
  status: already ? "already_applied" : "applied",
  approval_id: r.homeflow_request_id,
  candidate_id: r.candidate_id,
  household_id: r.household_id,
  requester_user_id: r.requester_user_id,
  payload_sha256: r.payload_sha256,
  entry_id: Number(r.entry_id),
  applied_at: Number(r.applied_at),
  approver_user_id: r.approver_user_id,
  operation_sha256: r.operation_sha256,
  already_applied: already
}), "receipt");
var exact11 = /* @__PURE__ */ __name((r, b) => r && r.homeflow_request_id === b.request_id && r.candidate_id === b.resource_id && r.household_id === b.household_id && r.requester_user_id === b.requester_user_id && r.payload_sha256 === b.payload_sha256 && (b.operation_sha256 === void 0 || b.operation_sha256 === r.operation_sha256), "exact");
async function homeflowProof(env, b) {
  const q = {
    request_id: b.request_id,
    resource_id: b.resource_id,
    household_id: b.household_id,
    requester_user_id: b.requester_user_id,
    payload_sha256: b.payload_sha256,
    idempotency_key: "jpda:sync:" + b.resource_id,
    expected_version: null,
    purpose: "execute",
    execution_nonce: b.execution_nonce
  };
  const raw = JSON.stringify(q), stamp = String(Date.now());
  try {
    const res = await env.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
      new URL("/api/internal/approvals/verify", env.HOMEFLOW_OAUTH_ORIGIN),
      {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "x-approval-client": "kakeibo",
          "x-approval-timestamp": stamp,
          "x-approval-signature": await mac7(
            env.KAKEIBO_APPROVAL_VERIFICATION_SECRET,
            "kakeibo",
            stamp,
            raw
          )
        },
        body: raw
      }
    ));
    if (res.status !== 200 || res.headers.has("location")) return null;
    const rawResult = await res.text();
    if (rawResult.length > 1900) return null;
    const p = JSON.parse(rawResult);
    return p?.ok === true && p.verified === true && p.execution_authorized === true && p.execution_status === "executing" && p.source_app === "jp-document-assistant" && p.target_app === "kakebo" && p.operation === "document.sync.finance" && p.resource_type === "document_sync_candidate" && p.request_id === b.request_id && p.resource_id === b.resource_id && p.household_id === b.household_id && p.requester_user_id === b.requester_user_id && p.payload_sha256 === b.payload_sha256 && p.idempotency_key === "jpda:sync:" + b.resource_id && p.expected_version === null && p.approver_user_id && p.approver_user_id !== b.requester_user_id && Number.isSafeInteger(p.approved_at) && Number.isSafeInteger(p.expires_at) && p.expires_at > Date.now() && p.applied === false ? p : null;
  } catch {
    return null;
  }
}
__name(homeflowProof, "homeflowProof");
async function sourceCheck(env, b) {
  const q = {
    request_id: b.request_id,
    resource_id: b.resource_id,
    household_id: b.household_id,
    requester_user_id: b.requester_user_id,
    payload_sha256: b.payload_sha256,
    operation_sha256: b.operation_sha256
  };
  const raw = JSON.stringify(q), stamp = String(Date.now());
  try {
    const res = await env.DOCUMENT_FINANCE_SOURCE_SERVICE.fetch(new Request(
      "https://jp-document-assistant.internal/api/internal/document-actions/source-check",
      {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "x-approval-client": "kakeibo",
          "x-approval-timestamp": stamp,
          "x-approval-signature": await mac7(
            env.KAKEIBO_DOCUMENT_FINANCE_SECRET,
            "kakeibo:document-source-check",
            stamp,
            raw
          )
        },
        body: raw
      }
    ));
    if (res.status !== 200 || res.headers.has("location")) return false;
    const data = await res.text();
    if (data.length > 1e3) return false;
    const p = JSON.parse(data);
    return p?.ok === true && p.verified === true && p.applied === false && p.approval_id === b.request_id && p.candidate_id === b.resource_id && p.household_id === b.household_id && p.requester_user_id === b.requester_user_id && p.payload_sha256 === b.payload_sha256 && p.operation_sha256 === b.operation_sha256;
  } catch {
    return false;
  }
}
__name(sourceCheck, "sourceCheck");
async function currentAccount(db, b) {
  return db.prepare("SELECT a.account_id,a.label,a.account_kind,a.version,a.owner_user_id,a.household_id,a.origin,a.is_archived,l.role AS member_role,l.state AS member_state FROM family_financial_accounts a JOIN homeflow_identity_links l ON l.user_id=a.owner_user_id AND l.household_id=a.household_id WHERE a.account_id=? LIMIT 1").bind(b.account_id).first();
}
__name(currentAccount, "currentAccount");
function accountMatches(a, b) {
  return a && a.account_id === b.account_id && a.owner_user_id === b.requester_user_id && a.household_id === b.household_id && a.label === b.payment_source && a.account_kind === "cash" && a.version === b.account_version && a.origin === "member_created" && a.is_archived === 0 && a.member_role === "member" && a.member_state === "active";
}
__name(accountMatches, "accountMatches");
async function documentFinanceRoute(request, env, parts) {
  if (!enabled4(env)) return refuse2("DOCUMENT_FINANCE_EXECUTION_DISABLED", 503);
  const receiptOnly = parts.length === 1 && parts[0] === "receipt";
  if (parts.length !== 1 || !["receipt", "execute"].includes(parts[0]))
    return refuse2("NOT_FOUND", 404);
  const b = await input(request, env, receiptOnly);
  if (!b) return refuse2("UNAUTHORIZED_OR_INVALID_BODY", 403);
  const db = env.DB;
  const stored = await db.prepare("SELECT * FROM document_finance_applied_actions WHERE homeflow_request_id=? OR candidate_id=? LIMIT 1").bind(b.request_id, b.resource_id).first();
  if (stored) return exact11(stored, b) ? reply5(receipt7(stored, true)) : refuse2("JOURNAL_IDENTITY_CONFLICT", 409);
  if (receiptOnly) return refuse2("RECEIPT_NOT_FOUND", 404);
  const account2 = await currentAccount(db, b);
  if (!accountMatches(account2, b)) return refuse2("ACCOUNT_CHANGED", 409);
  const homeProof = await homeflowProof(env, b);
  if (!homeProof) return refuse2("APPROVAL_NOT_EXECUTING", 409);
  if (!await sourceCheck(env, b)) return refuse2("SOURCE_REVOKED_OR_CHANGED", 409);
  const clientId = "document:" + b.request_id;
  const appliedAt = Date.now();
  const eventId = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (x) => x.toString(16).padStart(2, "0")
  ).join("");
  try {
    const changes = await db.batch([
      db.prepare("INSERT INTO entries (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id) SELECT ?,'',?,?,?,?,'',?,NULL,0,NULL,?,?,? WHERE EXISTS(SELECT 1 FROM family_financial_accounts a JOIN homeflow_identity_links l ON l.user_id=a.owner_user_id AND l.household_id=a.household_id WHERE a.account_id=? AND a.version=? AND a.account_kind='cash' AND a.owner_user_id=? AND a.household_id=? AND a.origin='member_created' AND a.is_archived=0 AND a.label=? AND l.role='member' AND l.state='active') ON CONFLICT(client_request_id) DO NOTHING").bind(
        b.date,
        b.amount_jpy,
        b.category,
        b.merchant,
        b.note,
        b.type,
        clientId,
        b.payment_source,
        b.account_id,
        b.account_id,
        b.account_version,
        b.requester_user_id,
        b.household_id,
        b.payment_source
      ),
      db.prepare("INSERT INTO document_finance_applied_actions (homeflow_request_id,candidate_id,household_id,requester_user_id,approver_user_id,account_id,account_version,payload_sha256,operation_sha256,client_request_id,entry_id,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,(SELECT id FROM entries WHERE client_request_id=? AND family_account_id=? AND date=? AND amount=? AND category=? AND merchant=? AND note=? AND type=? AND payment_source=? LIMIT 1),?)").bind(
        b.request_id,
        b.resource_id,
        b.household_id,
        b.requester_user_id,
        homeProof.approver_user_id,
        b.account_id,
        b.account_version,
        b.payload_sha256,
        b.operation_sha256,
        clientId,
        clientId,
        b.account_id,
        b.date,
        b.amount_jpy,
        b.category,
        b.merchant,
        b.note,
        b.type,
        b.payment_source,
        appliedAt
      ),
      db.prepare("INSERT INTO family_finance_events (event_id,household_id,actor_user_id,resource_id,action,created_at) VALUES(?,?,?,?,'finance_entry_applied',?)").bind(
        eventId,
        b.household_id,
        homeProof.approver_user_id,
        b.resource_id,
        new Date(appliedAt).toISOString()
      )
    ]);
    if (changes.length !== 3 || changes.some((x) => x.meta?.changes !== 1))
      return refuse2("TRANSACTION_RECONCILE_REQUIRED", 503);
  } catch {
    const raced = await db.prepare("SELECT * FROM document_finance_applied_actions WHERE homeflow_request_id=? OR candidate_id=? LIMIT 1").bind(b.request_id, b.resource_id).first().catch(() => null);
    return exact11(raced, b) ? reply5(receipt7(raced, true)) : refuse2("TRANSACTION_RETRY_OR_CONFLICT", 503);
  }
  const applied = await db.prepare("SELECT * FROM document_finance_applied_actions WHERE homeflow_request_id=?").bind(b.request_id).first();
  return exact11(applied, b) ? reply5(receipt7(applied, false)) : refuse2("TARGET_RECEIPT_PENDING_RECONCILIATION", 503);
}
__name(documentFinanceRoute, "documentFinanceRoute");
async function onRequest8({ request, env, params }) {
  return documentFinanceRoute(request, env, params.path || []);
}
__name(onRequest8, "onRequest");

// functions/api/internal/document-accounts/[[path]].js
var enc14 = new TextEncoder();
var hex64 = /^[a-f0-9]{64}$/i;
var hex32 = /^[a-f0-9]{32}$/i;
async function canonicalMemberCashId(householdId2, userId2) {
  const input2 = new TextEncoder().encode("jpda:member-cash:v1\n" + householdId2 + "\n" + userId2);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", input2));
  return Array.from(bytes.slice(0, 16), (x) => x.toString(16).padStart(2, "0")).join("");
}
__name(canonicalMemberCashId, "canonicalMemberCashId");
var canonicalCash = /* @__PURE__ */ __name(async (db) => {
  try {
    return await db.prepare("SELECT name FROM payment_sources WHERE name='\u73FE\u91D1' AND is_archived=0 LIMIT 1").bind().first();
  } catch (error) {
    if (/no such table: payment_sources/i.test(String(error))) return null;
    throw error;
  }
}, "canonicalCash");
var accountProofSecret = /* @__PURE__ */ __name((env) => hex64.test(env.KAKEIBO_DOCUMENT_ACCOUNT_VERIFICATION_SECRET || "") ? env.KAKEIBO_DOCUMENT_ACCOUNT_VERIFICATION_SECRET : env.KAKEIBO_DOCUMENT_FINANCE_SECRET, "accountProofSecret");
var reply6 = /* @__PURE__ */ __name((data, status = 200) => Response.json(data, { status, headers: {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
} }), "reply");
var deny3 = /* @__PURE__ */ __name((code, status = 403) => reply6({ ok: false, code, verified: false, applied: false }, status), "deny");
async function mac8(secret, stamp, raw) {
  const bytes = Uint8Array.from(secret.match(/.{2}/g), (x) => parseInt(x, 16));
  const key2 = await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key2, enc14.encode("jpda:finance-account\n" + stamp + "\n" + raw));
  return Array.from(new Uint8Array(sig), (x) => x.toString(16).padStart(2, "0")).join("");
}
__name(mac8, "mac");
function same6(a, b) {
  if (!hex64.test(a || "") || !hex64.test(b || "")) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(same6, "same");
async function verifyDocumentFinanceAccount(request, env, parts = ["verify"]) {
  if (env.APP_ENV !== "production" || env.KAKEIBO_FAMILY_FINANCE_ENABLED !== "true" || env.KAKEIBO_DOCUMENT_ACCOUNT_VERIFY_ENABLED !== "true" || !hex64.test(accountProofSecret(env) || "") || typeof env.DB?.prepare !== "function")
    return deny3("ACCOUNT_PROOF_DISABLED", 503);
  const listOnly = parts.length === 1 && parts[0] === "list";
  if (request.method !== "POST" || parts.length !== 1 || !["verify", "list"].includes(parts[0]))
    return deny3("NOT_FOUND", 404);
  if (request.headers.has("cookie") || request.headers.has("origin") || request.headers.has("authorization") || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    return deny3("BACKEND_ONLY");
  const stamp = request.headers.get("x-approval-timestamp");
  const signature = request.headers.get("x-approval-signature");
  if (request.headers.get("x-approval-client") !== "jp-document-assistant" || !/^\d{13}$/.test(stamp || "") || Math.abs(Date.now() - Number(stamp)) > 3e5 || !hex64.test(signature || ""))
    return deny3("INVALID_SIGNATURE");
  let body, raw;
  try {
    raw = await request.text();
    if (raw.length > 600) throw Error("too large");
    body = JSON.parse(raw);
  } catch {
    return deny3("INVALID_INPUT", 400);
  }
  if (!same6(await mac8(accountProofSecret(env), stamp, raw), signature))
    return deny3("INVALID_SIGNATURE");
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== (listOnly ? ["household_id", "requester_user_id"] : ["account_id", "household_id", "requester_user_id", "entry_type"]).sort().join(",") || !listOnly && !hex32.test(body.account_id) || typeof body.household_id !== "string" || !body.household_id || body.household_id.length > 128 || typeof body.requester_user_id !== "string" || !body.requester_user_id || body.requester_user_id.length > 128 || !listOnly && !["expense", "income"].includes(body.entry_type))
    return deny3("INVALID_INPUT", 400);
  if (listOnly) {
    const active = await env.DB.prepare(
      "SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=? LIMIT 1"
    ).bind(body.requester_user_id, body.household_id).first();
    if (active?.role !== "member" || active?.state !== "active")
      return deny3("ACCOUNT_OWNER_NOT_VERIFIED", 409);
    const selected = await env.DB.prepare(
      "SELECT account_id,label,account_kind,version AS account_version FROM family_financial_accounts WHERE household_id=? AND owner_user_id=? AND origin='member_created' AND account_kind='cash' AND is_archived=0 ORDER BY sort_order,account_id LIMIT 101"
    ).bind(body.household_id, body.requester_user_id).all();
    const rows = selected.results || [];
    if (rows.length > 100) return deny3("ACCOUNT_LIST_LIMIT", 409);
    const cash = await canonicalCash(env.DB);
    if (cash?.name) {
      const accountId = await canonicalMemberCashId(body.household_id, body.requester_user_id);
      if (!rows.some((x) => x.account_id === accountId)) {
        if (rows.length === 100) return deny3("ACCOUNT_LIST_LIMIT", 409);
        rows.unshift({ account_id: accountId, label: cash.name, account_kind: "cash", account_version: 1 });
      }
    }
    let categories = [];
    try {
      const found = await env.DB.prepare(
        "SELECT category,display_name,entry_type FROM category_source WHERE entry_type IN ('income','expense') ORDER BY entry_type,sort_order LIMIT 100"
      ).bind().all();
      categories = (found.results || []).filter((x) => ["income", "expense"].includes(x.entry_type) && typeof x.category === "string" && x.category.length > 0 && x.category.length <= 80).map((x) => ({ value: x.category, label: x.display_name || x.category, entry_type: x.entry_type }));
    } catch (error) {
      if (!/no such table: category_source/i.test(String(error))) throw error;
    }
    return reply6({ ok: true, verified: true, applied: false, accounts: rows, categories });
  }
  let account2 = await env.DB.prepare(
    "SELECT a.account_id,a.household_id,a.owner_user_id,a.label,a.account_kind,a.origin,a.is_archived,a.version,l.role,l.state FROM family_financial_accounts a JOIN homeflow_identity_links l ON l.user_id=a.owner_user_id AND l.household_id=a.household_id WHERE a.account_id=? AND a.household_id=? AND a.owner_user_id=? LIMIT 1"
  ).bind(body.account_id, body.household_id, body.requester_user_id).first();
  const canonicalId = await canonicalMemberCashId(body.household_id, body.requester_user_id);
  if (body.account_id === canonicalId) {
    const cash = await canonicalCash(env.DB);
    if (!cash?.name) return deny3("CANONICAL_CASH_NOT_AVAILABLE", 409);
    if (!account2) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO family_financial_accounts (account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) SELECT ?,?,?,ps.name,'cash','member_created',?,? FROM payment_sources ps JOIN homeflow_identity_links l ON l.user_id=? AND l.household_id=? AND l.role='member' AND l.state='active' WHERE ps.name='\u73FE\u91D1' AND ps.is_archived=0 LIMIT 1"
      ).bind(
        canonicalId,
        body.household_id,
        body.requester_user_id,
        body.requester_user_id,
        body.requester_user_id,
        body.requester_user_id,
        body.household_id
      ).run();
      account2 = await env.DB.prepare(
        "SELECT a.account_id,a.household_id,a.owner_user_id,a.label,a.account_kind,a.origin,a.is_archived,a.version,l.role,l.state FROM family_financial_accounts a JOIN homeflow_identity_links l ON l.user_id=a.owner_user_id AND l.household_id=a.household_id WHERE a.account_id=? AND a.household_id=? AND a.owner_user_id=? LIMIT 1"
      ).bind(body.account_id, body.household_id, body.requester_user_id).first();
    }
    if (account2?.label !== cash.name) return deny3("CANONICAL_CASH_CHANGED", 409);
  }
  if (!account2 || account2.role !== "member" || account2.state !== "active" || account2.is_archived !== 0 || account2.origin !== "member_created")
    return deny3("ACCOUNT_OWNER_NOT_VERIFIED", 409);
  if (account2.account_kind !== "cash") return deny3("ACCOUNT_KIND_NOT_EXECUTABLE", 409);
  return reply6({
    ok: true,
    verified: true,
    applied: false,
    account_id: account2.account_id,
    household_id: account2.household_id,
    owner_user_id: account2.owner_user_id,
    account_kind: account2.account_kind,
    account_version: account2.version,
    label: account2.label,
    origin: account2.origin
  });
}
__name(verifyDocumentFinanceAccount, "verifyDocumentFinanceAccount");

// functions/api/internal/document-personal-sbi/[[path]].js
var enc15 = new TextEncoder();
var hex9 = /^[0-9a-f]{64}$/i;
var id5 = /^[0-9a-f]{32}$/i;
var reply7 = /* @__PURE__ */ __name((b, status = 200) => Response.json(b, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }), "reply");
var deny4 = /* @__PURE__ */ __name((code, status = 403) => reply7({ ok: false, code, applied: false }, status), "deny");
var hash8 = /* @__PURE__ */ __name(async (raw) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", enc15.encode(raw))),
  (x) => x.toString(16).padStart(2, "0")
).join(""), "hash");
var exact12 = /* @__PURE__ */ __name((b, keys) => !!b && typeof b === "object" && !Array.isArray(b) && Object.keys(b).sort().join(",") === keys.slice().sort().join(","), "exact");
var date6 = /* @__PURE__ */ __name((s) => typeof s === "string" && /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && (/* @__PURE__ */ new Date(s + "T00:00:00Z")).toISOString().slice(0, 10) === s, "date");
async function mac9(secret, domain, stamp, raw) {
  const key2 = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(secret.match(/.{2}/g), (x) => parseInt(x, 16)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key2, enc15.encode(domain + "\n" + stamp + "\n" + raw));
  return Array.from(new Uint8Array(signature), (x) => x.toString(16).padStart(2, "0")).join("");
}
__name(mac9, "mac");
function equal3(a, b) {
  if (!hex9.test(a || "") || !hex9.test(b || "")) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(equal3, "equal");
var receipt8 = /* @__PURE__ */ __name((r) => ({
  ok: true,
  applied: true,
  transfer_id: r.transfer_id,
  remote_id: "personal-sbi:" + r.transfer_id,
  owner_user_id: r.owner_user_id,
  household_id: r.household_id,
  source_candidate_id: r.source_candidate_id,
  state: r.state,
  version: r.version,
  source_sha256: r.source_sha256,
  recorded_type: "transfer",
  asset_target: "sbi",
  fund_units_created: 0
}), "receipt");
async function documentPersonalSbiRoute(request, env, mode) {
  if (!["execute", "receipt"].includes(mode) || request.method !== "POST") return deny4("NOT_FOUND", 404);
  if (env.APP_ENV !== "production" || env.KAKEIBO_FAMILY_FINANCE_ENABLED !== "true" || !hex9.test(env.KAKEIBO_DOCUMENT_FINANCE_SECRET || "") || !env.DB?.prepare)
    return deny4("PERSONAL_SBI_EXECUTOR_DISABLED", 503);
  if (request.headers.has("cookie") || request.headers.has("origin") || request.headers.has("authorization") || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    return deny4("BACKEND_ONLY");
  const stamp = request.headers.get("x-approval-timestamp");
  const signature = request.headers.get("x-approval-signature");
  if (request.headers.get("x-approval-client") !== "jp-document-assistant" || !/^\d{13}$/.test(stamp || "") || Math.abs(Date.now() - Number(stamp)) > 3e5 || !hex9.test(signature || "")) return deny4("INVALID_SIGNATURE");
  let body, raw;
  try {
    raw = await request.text();
    if (raw.length > 1500) throw Error("oversized");
    body = JSON.parse(raw);
  } catch {
    return deny4("INVALID_BODY", 400);
  }
  const domain = mode === "execute" ? "jpda:personal-sbi-execute" : "jpda:personal-sbi-receipt";
  if (!equal3(signature, await mac9(env.KAKEIBO_DOCUMENT_FINANCE_SECRET, domain, stamp, raw)))
    return deny4("INVALID_SIGNATURE");
  const common = ["source", "source_candidate_id", "household_id", "owner_user_id", "idempotency_key"];
  const extra = ["source_document_id", "date", "effective_date", "amount_jpy", "purpose", "merchant", "note", "confirmed"];
  if (!exact12(body, mode === "execute" ? [...common, ...extra] : common) || body.source !== "jp-document-assistant" || !id5.test(body.source_candidate_id) || !id5.test(body.source_document_id || "") && mode === "execute" || typeof body.household_id !== "string" || !body.household_id || body.household_id.length > 128 || typeof body.owner_user_id !== "string" || !body.owner_user_id || body.owner_user_id.length > 128 || body.idempotency_key !== "jda:personal-sbi:" + body.source_candidate_id)
    return deny4("INVALID_IDENTITY", 400);
  const db = env.DB;
  const prior = await db.prepare("SELECT * FROM family_document_personal_sbi_transfers WHERE source_candidate_id=?").bind(body.source_candidate_id).first();
  if (mode === "receipt") {
    return prior && prior.owner_user_id === body.owner_user_id && prior.household_id === body.household_id ? reply7(receipt8(prior)) : deny4("RECEIPT_NOT_FOUND", 404);
  }
  if (!date6(body.date) || !date6(body.effective_date) || !Number.isSafeInteger(body.amount_jpy) || body.amount_jpy < 1 || body.amount_jpy > 1e7 || !["monthly", "purchase"].includes(body.purpose) || typeof body.merchant !== "string" || !body.merchant.trim() || body.merchant.length > 100 || typeof body.note !== "string" || body.note.length > 180 || body.confirmed !== true)
    return deny4("INVALID_TRANSFER", 400);
  const member = await db.prepare("SELECT 1 AS yes FROM homeflow_identity_links WHERE user_id=? AND household_id=? AND role='member' AND state='active'").bind(body.owner_user_id, body.household_id).first();
  if (!member) return deny4("MEMBER_IDENTITY_REVOKED", 403);
  const source_sha256 = await hash8(raw);
  const same7 = /* @__PURE__ */ __name((r) => r?.source_sha256 === source_sha256 && r.owner_user_id === body.owner_user_id && r.household_id === body.household_id && r.source_document_id === body.source_document_id, "same");
  if (prior) return same7(prior) ? reply7({ ...receipt8(prior), already_applied: true }) : deny4("PERSONAL_SBI_SOURCE_CONFLICT", 409);
  const transferId = body.source_candidate_id, at = Date.now();
  try {
    await db.batch([
      db.prepare("INSERT INTO family_document_personal_sbi_transfers (transfer_id,household_id,owner_user_id,source_document_id,source_candidate_id,source_sha256,date,effective_date,amount_jpy,purpose,merchant,note,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM homeflow_identity_links WHERE user_id=? AND household_id=? AND role='member' AND state='active') ON CONFLICT(source_candidate_id) DO NOTHING").bind(
        transferId,
        body.household_id,
        body.owner_user_id,
        body.source_document_id,
        body.source_candidate_id,
        source_sha256,
        body.date,
        body.effective_date,
        body.amount_jpy,
        body.purpose,
        body.merchant.trim(),
        body.note,
        at,
        at,
        body.owner_user_id,
        body.household_id
      ),
      db.prepare("INSERT OR IGNORE INTO family_document_personal_sbi_audit (audit_id,transfer_id,actor_user_id,action,before_version,after_version,created_at) SELECT ?,transfer_id,owner_user_id,'create',0,1,? FROM family_document_personal_sbi_transfers WHERE transfer_id=? AND source_sha256=?").bind(transferId, at, transferId, source_sha256)
    ]);
  } catch {
    const after = await db.prepare("SELECT * FROM family_document_personal_sbi_transfers WHERE source_candidate_id=?").bind(body.source_candidate_id).first().catch(() => null);
    return same7(after) ? reply7({ ...receipt8(after), already_applied: true }) : deny4("PERSONAL_SBI_TRANSACTION_UNCONFIRMED", 503);
  }
  const saved = await db.prepare("SELECT * FROM family_document_personal_sbi_transfers WHERE source_candidate_id=?").bind(body.source_candidate_id).first();
  return same7(saved) ? reply7(receipt8(saved)) : deny4("PERSONAL_SBI_RECEIPT_UNCONFIRMED", 503);
}
__name(documentPersonalSbiRoute, "documentPersonalSbiRoute");

// workers/family-finance-service-router.js
var actionRoutes = Object.freeze({
  "approved-actions": /* @__PURE__ */ __name((request, env, action) => onRequest({ request, env, params: { path: [action] } }), "approved-actions"),
  "bank-transfers": /* @__PURE__ */ __name((request, env, action) => approvedBankTransferRoute(request, env, [action]), "bank-transfers"),
  "card-purchases": /* @__PURE__ */ __name((request, env, action) => onRequest2({ request, env, params: { path: [action] } }), "card-purchases"),
  "points-actions": /* @__PURE__ */ __name((request, env, action) => onRequest3({ request, env, params: { path: [action] } }), "points-actions"),
  "prepaid-actions": /* @__PURE__ */ __name((request, env, action) => onRequest4({ request, env, params: { path: [action] } }), "prepaid-actions"),
  "sbi-cash-actions": /* @__PURE__ */ __name((request, env, action) => onRequest5({ request, env, params: { path: [action] } }), "sbi-cash-actions"),
  "shared-entries": /* @__PURE__ */ __name((request, env, action) => onRequest6({ request, env, params: { path: [action] } }), "shared-entries"),
  "document-finance": /* @__PURE__ */ __name((request, env, action) => onRequest8({ request, env, params: { path: [action] } }), "document-finance")
});
var denied = /* @__PURE__ */ __name((code, status = 403) => Response.json(
  { ok: false, code, applied: false },
  { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }
), "denied");
async function routeInternalFinance(request, env) {
  const url = new URL(request.url);
  const path = /^\/api\/internal\/([a-z-]+)\/(execute|receipt|preview)$/.exec(url.pathname);
  const recurring = url.pathname === "/api/internal/recurring-finance/receipt";
  const accountPath = /^\/api\/internal\/document-accounts\/(list|verify)$/.exec(url.pathname);
  const personalSbi = /^\/api\/internal\/document-personal-sbi\/(execute|receipt)$/.exec(url.pathname);
  if (!path && !recurring && !accountPath && !personalSbi) return null;
  if (request.method !== "POST" || url.search || url.hash || request.headers.has("cookie") || request.headers.has("authorization") || request.headers.has("origin") || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    return denied("INTERNAL_EXECUTION_BACKCHANNEL_ONLY");
  if (!env?.DB?.prepare) return denied("INTERNAL_EXECUTION_DB_UNAVAILABLE", 503);
  if (recurring) return onRequest7({ request, env });
  if (accountPath) return verifyDocumentFinanceAccount(request, env, [accountPath[1]]);
  if (personalSbi) return documentPersonalSbiRoute(request, env, personalSbi[1]);
  const router = Object.hasOwn(actionRoutes, path[1]) ? actionRoutes[path[1]] : null;
  if (!router || path[2] === "preview" && path[1] !== "shared-entries") return denied("INTERNAL_EXECUTION_ROUTE_UNKNOWN", 404);
  return router(request, env, path[2]);
}
__name(routeInternalFinance, "routeInternalFinance");

// workers/approval-preview.js
var hex10 = /^[a-f0-9]{64}$/i;
var uuid11 = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
var id326 = /^[a-f0-9]{32}$/i;
var fields3 = [
  "request_id",
  "resource_id",
  "household_id",
  "requester_user_id",
  "payload_sha256",
  "approver_user_id",
  "operation",
  "resource_type"
];
var allowed = Object.freeze({
  finance_entry: "finance.entry.create",
  credit_card_purchase: "finance.credit_card.purchase",
  prepaid_action: "finance.prepaid.spend"
});
var reply8 = /* @__PURE__ */ __name((v, status = 200) => Response.json(v, { status, headers: {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
} }), "reply");
var deny5 = /* @__PURE__ */ __name((code, status = 403) => reply8({ ok: false, code }, status), "deny");
var exact13 = /* @__PURE__ */ __name((x, k) => !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).sort().join(",") === k.slice().sort().join(","), "exact");
var equal4 = /* @__PURE__ */ __name((a, b) => typeof a === "string" && typeof b === "string" && hex10.test(a) && hex10.test(b) && a.length === b.length && [...a].reduce((n, c, i) => n | c.charCodeAt(0) ^ b.charCodeAt(i), 0) === 0, "equal");
async function hmac3(secret, stamp, raw) {
  const bytes = Uint8Array.from(secret.match(/.{2}/g), (x) => parseInt(x, 16));
  const key2 = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key2, new TextEncoder().encode(
    "homeflow:ledger-preview\n" + stamp + "\n" + raw
  ));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
__name(hmac3, "hmac");
function sameSource(row, b, statusColumn = "status") {
  return row && row[statusColumn] === "submitted" && row.homeflow_approval_id === b.request_id && row.requester_user_id === b.requester_user_id && row.household_id === b.household_id && row.payload_sha256 === b.payload_sha256 && Number(row.expires_at) > Date.now() && row.requester_role === "member" && row.requester_state === "active";
}
__name(sameSource, "sameSource");
var present = /* @__PURE__ */ __name((p, method) => ({
  date: p.date,
  type: p.type || "expense",
  amount: p.amount_jpy,
  category: p.category,
  merchant: p.merchant,
  note: p.note,
  payment_source: method
}), "present");
async function approvalPreviewRoute(request, env) {
  if (env.APP_ENV !== "production" || env.KAKEIBO_HOUSEHOLD_LEDGER_ONLY !== "true" || !env.DB?.prepare || !hex10.test(env.KAKEIBO_SHARED_MUTATION_EXECUTION_SECRET || "") || !hex10.test(env.KAKEIBO_FAMILY_PENDING_KEY || ""))
    return deny5("LEDGER_PREVIEW_DISABLED", 503);
  const url = new URL(request.url);
  if (url.pathname !== "/api/internal/approval-preview" || url.search || url.hash || request.method !== "POST" || request.headers.has("cookie") || request.headers.has("authorization") || request.headers.has("origin") || request.headers.get("x-approval-client") !== "homeflow" || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    return deny5("BACKEND_ONLY");
  const stamp = request.headers.get("x-approval-timestamp") || "";
  const signature = request.headers.get("x-approval-signature") || "";
  if (!/^\d{13}$/.test(stamp) || Math.abs(Date.now() - Number(stamp)) > 3e5 || !hex10.test(signature)) return deny5("INVALID_SIGNATURE");
  let b, raw;
  try {
    raw = await request.text();
    b = raw.length <= 1250 ? JSON.parse(raw) : null;
  } catch {
    return deny5("INVALID_BODY", 400);
  }
  if (!exact13(b, fields3) || !uuid11.test(b.request_id) || !id326.test(b.resource_id) || !hex10.test(b.payload_sha256) || !b.household_id || !b.requester_user_id || !b.approver_user_id || b.approver_user_id === b.requester_user_id || typeof b.household_id !== "string" || b.household_id.length > 128 || typeof b.requester_user_id !== "string" || b.requester_user_id.length > 128 || typeof b.approver_user_id !== "string" || b.approver_user_id.length > 128 || !Object.hasOwn(allowed, b.resource_type) || allowed[b.resource_type] !== b.operation)
    return deny5("INVALID_BODY", 400);
  if (!equal4(signature, await hmac3(env.KAKEIBO_SHARED_MUTATION_EXECUTION_SECRET, stamp, raw)))
    return deny5("INVALID_SIGNATURE");
  const db = env.DB;
  try {
    const links = (await db.prepare("SELECT user_id,role,state FROM homeflow_identity_links WHERE household_id=? AND user_id IN (?,?)").bind(b.household_id, b.approver_user_id, b.requester_user_id).all()).results || [];
    if (!links.some((x) => x.user_id === b.approver_user_id && x.role === "owner" && x.state === "active") || !links.some((x) => x.user_id === b.requester_user_id && x.role === "member" && x.state === "active"))
      return deny5("CURRENT_MEMBERSHIP_INVALID");
    let item, entry;
    if (b.resource_type === "finance_entry") {
      item = await db.prepare("SELECT p.*,a.account_kind,a.origin,a.owner_user_id,a.is_archived,a.household_id AS account_household,l.role AS requester_role,l.state AS requester_state FROM family_finance_pending_actions p JOIN family_financial_accounts a ON a.account_id=p.account_id JOIN homeflow_identity_links l ON l.user_id=p.requester_user_id AND l.household_id=p.household_id WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1").bind(b.resource_id, b.request_id).first();
      if (!item || item.state !== "submitted" || item.operation !== b.operation || item.requester_user_id !== b.requester_user_id || item.household_id !== b.household_id || item.payload_sha256 !== b.payload_sha256 || item.account_kind !== "cash" || item.owner_user_id !== b.requester_user_id || item.account_household !== b.household_id || item.is_archived !== 0 || item.origin !== "member_created" || item.requester_role !== "member" || item.requester_state !== "active" || Number(item.expires_at) <= Date.now())
        return deny5("SOURCE_OR_ACCOUNT_CHANGED", 409);
      const opened = await decodePayload(env, item);
      if (!opened || !validCash(opened.payload, item)) return deny5("SEALED_INTENT_INVALID", 409);
      entry = present(opened.payload, "\u73FE\u91D1");
    } else if (b.resource_type === "credit_card_purchase") {
      item = await db.prepare("SELECT p.*,a.account_kind,a.version AS live_version,a.owner_user_id,a.household_id AS account_household,a.is_archived,a.origin,a.closing_day,m.role AS requester_role,m.state AS requester_state FROM family_card_purchase_intents p JOIN family_financial_accounts a ON a.account_id=p.account_id JOIN homeflow_identity_links m ON m.user_id=p.requester_user_id AND m.household_id=p.household_id WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1").bind(b.resource_id, b.request_id).first();
      if (!sameSource(item, b) || item.account_kind !== "credit_card" || item.origin !== "member_created" || item.owner_user_id !== b.requester_user_id || item.account_household !== b.household_id || item.is_archived !== 0 || item.account_version !== item.live_version)
        return deny5("SOURCE_OR_ACCOUNT_CHANGED", 409);
      const opened = await sealed(env, item);
      if (!opened) return deny5("SEALED_INTENT_INVALID", 409);
      entry = present(opened, "\u4E2A\u4EBA\u4FE1\u7528\u5361");
    } else {
      item = await db.prepare("SELECT p.*,a.account_kind AS prepaid_kind,a.origin AS prepaid_origin,a.version AS prepaid_live,a.is_archived AS prepaid_archived,a.owner_user_id AS prepaid_owner,a.household_id AS prepaid_household,m.role AS requester_role,m.state AS requester_state FROM family_prepaid_action_intents p JOIN family_financial_accounts a ON a.account_id=p.prepaid_account_id JOIN homeflow_identity_links m ON m.user_id=p.requester_user_id AND m.household_id=p.household_id WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1").bind(b.resource_id, b.request_id).first();
      if (!sameSource(item, b) || item.action !== "spend" || item.prepaid_kind !== "prepaid" || item.prepaid_origin !== "member_created" || item.prepaid_owner !== b.requester_user_id || item.prepaid_household !== b.household_id || item.prepaid_archived !== 0 || item.prepaid_version !== item.prepaid_live)
        return deny5("SOURCE_OR_ACCOUNT_CHANGED", 409);
      const opened = await decode3(env, item);
      if (!opened || opened.action !== "spend") return deny5("SEALED_INTENT_INVALID", 409);
      entry = present(opened, "\u4E2A\u4EBA\u50A8\u503C\u5361");
    }
    if (!entry || !["income", "expense"].includes(entry.type) || !Number.isSafeInteger(entry.amount) || entry.amount < 1)
      return deny5("PREVIEW_INVALID", 503);
    return reply8({
      ok: true,
      approval_id: b.request_id,
      proposal_id: b.resource_id,
      operation: b.operation,
      entry,
      before: null
    });
  } catch {
    return deny5("LEDGER_PREVIEW_UNAVAILABLE", 503);
  }
}
__name(approvalPreviewRoute, "approvalPreviewRoute");

// functions/api/prepaid-assets.js
var json6 = /* @__PURE__ */ __name((value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } }), "json");
var todayJST = /* @__PURE__ */ __name(() => new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10), "todayJST");
async function prepaidSchemaReady(db) {
  const { results } = await db.prepare("PRAGMA table_info(payment_sources)").all();
  return ["source_type", "opening_balance", "opening_date", "opening_entry_id"].every((col) => results.some((x) => x.name === col));
}
__name(prepaidSchemaReady, "prepaidSchemaReady");
async function handlePrepaid({ db, request, method, sub, ownerProof = null }) {
  if (!await prepaidSchemaReady(db)) return json6({ error: "\u30D7\u30EA\u30DA\u30A4\u30C9\u7BA1\u7406\u306E\u8FFD\u52A0\u79FB\u884C\u304C\u5FC5\u8981\u3067\u3059", code: "prepaid_migration_required" }, 409);
  const pending = await db.prepare("SELECT name FROM payment_sources WHERE source_type='prepaid' AND opening_date='__restore_pending__' LIMIT 1").first();
  if (pending) return json6({ error: "\u30D7\u30EA\u30DA\u30A4\u30C9\u6B8B\u9AD8\u306E\u5FA9\u5143\u304C\u5B8C\u4E86\u3057\u3066\u3044\u307E\u305B\u3093\u3002\u30D0\u30C3\u30AF\u30A2\u30C3\u30D7\u5FA9\u5143\u3092\u518D\u958B\u3057\u3066\u304F\u3060\u3055\u3044", code: "prepaid_restore_incomplete" }, 409);
  if (method === "POST" && sub === "alert") {
    if (!ownerProof?.verified || !ownerProof.userId || !ownerProof.householdId)
      return json6({ code: "PREPAID_ALERT_OWNER_REQUIRED" }, 403);
    const body = await request.json().catch(() => null);
    return updatePrepaidAlert(db, {
      scope: "legacy",
      key: body?.name,
      householdId: ownerProof.householdId,
      ownerUserId: ownerProof.userId,
      enabled: body?.enabled,
      thresholdJpy: body?.thresholdJpy
    });
  }
  if (method === "POST" && sub === "opening") {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const balance = body?.openingBalance;
    if (!name || name.length > 80 || !Number.isSafeInteger(balance) || balance < 0 || balance > 1e8)
      return json6({ error: "\u671F\u9996\u6B8B\u9AD8\u306F0\u5186\u4EE5\u4E0A\u306E\u6574\u6570\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044" }, 400);
    const updated = await db.prepare("UPDATE payment_sources SET opening_balance=?1 WHERE name=?2 AND source_type='prepaid'").bind(balance, name).run();
    if (!updated.meta?.changes) return json6({ error: "\u767B\u9332\u6E08\u307F\u306E\u30D7\u30EA\u30DA\u30A4\u30C9\u30AB\u30FC\u30C9\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" }, 404);
    return json6({ ok: true, name, opening_balance: balance });
  }
  if (method !== "GET" || sub) return json6({ error: "\u672A\u5BFE\u5FDC\u306E\u64CD\u4F5C\u3067\u3059" }, 405);
  const today3 = todayJST();
  const monthStart = today3.slice(0, 7) + "-01";
  const withAlert = !!ownerProof?.verified;
  const { results: cards } = await db.prepare(`SELECT p.name,p.is_archived,p.opening_balance,p.opening_entry_id,p.opening_date,
    ${withAlert ? "COALESCE(alert.enabled,0)" : "0"} AS alert_enabled,
    ${withAlert ? "COALESCE(alert.threshold_jpy,1000)" : "1000"} AS alert_threshold_jpy,
    ${withAlert ? "COALESCE(alert.version,0)" : "0"} AS alert_version,
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='transfer' AND e.transfer_target='prepaid:'||p.name
        AND e.id>p.opening_entry_id AND (e.date>=p.opening_date OR COALESCE(e.transfer_date,e.date)>=p.opening_date) AND e.date<=?1
        AND COALESCE(e.transfer_date,e.date)<=?1
        AND COALESCE(e.payment_source,'')<>p.name),0) charged,
    -- Month-to-date activity is the full calendar month, even when a card
    -- was registered mid-month. Only the current balance uses the opening
    -- anchor; otherwise pre-registration transactions disappear from totals.
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='transfer' AND e.transfer_target='prepaid:'||p.name
        AND e.date<=?1 AND COALESCE(e.transfer_date,e.date) BETWEEN ?2 AND ?1
        AND COALESCE(e.payment_source,'')<>p.name),0) charged_month,
    -- Point rewards credited to the wallet are receipts, not transfers. The
    -- generated top-up is a separate outgoing transfer; both sides must count.
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='income' AND e.category='\u30DD\u30A4\u30F3\u30C8\u9084\u5143' AND e.payment_source=p.name
        AND e.id>p.opening_entry_id AND e.date>=p.opening_date AND e.date<=?1),0) earned,
    -- Old point-income rows can have no source. For monthly reporting,
    -- recover only receipts matched to a real points-funded transfer;
    -- leave standalone cash income and current anchored balance unchanged.
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='income' AND e.category='\u30DD\u30A4\u30F3\u30C8\u9084\u5143'
        AND (e.payment_source=p.name
          OR (p.name='\u30DD\u30A4\u30F3\u30C8\u9084\u5143' AND COALESCE(e.payment_source,'')=''
            AND COALESCE(e.transfer_target,'')=''
            -- Unassigned legacy points count only when the user also recorded
            -- a matching debit from this wallet (e.g. +176 / -176 nanaco).
            -- A standalone "income only" reward is NOT a wallet top-up.
            AND EXISTS (SELECT 1 FROM entries t
              WHERE t.type='transfer' AND t.payment_source=p.name
                AND t.date=e.date AND t.amount=e.amount AND t.id>e.id
                AND e.id=(SELECT MAX(i.id) FROM entries i
                  WHERE i.type='income' AND i.category='\u30DD\u30A4\u30F3\u30C8\u9084\u5143'
                    AND COALESCE(i.payment_source,'')=''
                    AND COALESCE(i.transfer_target,'')=''
                    AND i.date=e.date AND i.amount=e.amount AND i.id<t.id)
            )))
        AND e.date BETWEEN ?2 AND ?1),0) earned_month,
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='expense' AND e.payment_source=p.name
        AND e.id>p.opening_entry_id AND e.date>=p.opening_date AND e.date<=?1),0) spent,
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='expense' AND e.payment_source=p.name
        AND e.date BETWEEN ?2 AND ?1),0) spent_month,
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='transfer' AND e.payment_source=p.name
        AND e.id>p.opening_entry_id AND (e.date>=p.opening_date OR COALESCE(e.transfer_date,e.date)>=p.opening_date) AND e.date<=?1
        AND COALESCE(e.transfer_date,e.date)<=?1
        AND COALESCE(e.transfer_target,'')<>'prepaid:'||p.name),0) transferred_out,
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='transfer' AND e.payment_source=p.name
        AND e.date<=?1 AND COALESCE(e.transfer_date,e.date) BETWEEN ?2 AND ?1
        AND COALESCE(e.transfer_target,'')<>'prepaid:'||p.name),0) transferred_out_month
    FROM payment_sources p
    ${withAlert ? `LEFT JOIN prepaid_balance_alert_settings alert
      ON alert.account_scope='legacy' AND alert.resource_key=p.name
      AND alert.household_id=?3 AND alert.owner_user_id=?4` : ""}
    WHERE p.source_type='prepaid'
    ORDER BY p.is_archived,p.sort_order,p.name`).bind(today3, monthStart, ...withAlert ? [ownerProof.householdId, ownerProof.userId] : []).all();
  const [latestUsage, latestCharge] = await Promise.all([
    db.prepare(`SELECT p.name AS card,e.id,e.date,e.amount,e.merchant
      FROM entries e
      JOIN payment_sources p ON p.source_type='prepaid' AND e.payment_source=p.name
      WHERE e.type='expense' AND e.id>p.opening_entry_id
        AND e.date>=p.opening_date AND e.date<=?1
      ORDER BY e.date DESC,COALESCE(e.time,'') DESC,e.id DESC LIMIT 1`).bind(today3).first(),
    db.prepare(`SELECT p.name AS card,e.id,COALESCE(e.transfer_date,e.date) AS date,
        e.amount,e.payment_source AS funding_source
      FROM entries e
      JOIN payment_sources p ON p.source_type='prepaid' AND e.transfer_target='prepaid:'||p.name
      WHERE e.type='transfer' AND e.id>p.opening_entry_id
        AND (e.date>=p.opening_date OR COALESCE(e.transfer_date,e.date)>=p.opening_date) AND e.date<=?1
        AND COALESCE(e.transfer_date,e.date)<=?1
        AND COALESCE(e.payment_source,'')<>p.name
      ORDER BY COALESCE(e.transfer_date,e.date) DESC,
        e.date DESC,COALESCE(e.time,'') DESC,e.id DESC LIMIT 1`).bind(today3).first()
  ]);
  return json6({
    // The legacy PWA displays charged_month directly. Return all monthly
    // incoming funds there (recharges + earned points), so older installed
    // clients also show the correct month total without double counting.
    cards: cards.map((p) => ({
      ...p,
      charged_month: Number(p.charged_month) + Number(p.earned_month),
      balance: Number(p.opening_balance) + Number(p.charged) + Number(p.earned) - Number(p.spent) - Number(p.transferred_out)
    })),
    latestUsage: latestUsage || null,
    latestCharge: latestCharge || null
  });
}
__name(handlePrepaid, "handlePrepaid");

// functions/api/family-finance/prepaid-report.js
var response2 = /* @__PURE__ */ __name((x, s = 200) => Response.json(x, { status: s, headers: { "cache-control": "no-store" } }), "response");
var today2 = /* @__PURE__ */ __name(() => new Date(Date.now() + 324e5).toISOString().slice(0, 10), "today");
async function familyPrepaidReport(env, user) {
  if (!env.DB || !user?.user_id || !user?.household_id)
    return response2({ ok: false, code: "IDENTITY_REQUIRED" }, 403);
  const db = env.DB, month2 = today2().slice(0, 7) + "-01";
  try {
    const q = await db.prepare("SELECT a.account_id,a.label,a.opening_balance,a.version,a.is_archived,a.created_at,COALESCE((SELECT SUM(j.delta_jpy) FROM family_prepaid_balance_journal j WHERE j.prepaid_account_id=a.account_id AND j.household_id=a.household_id),0) journal,COALESCE((SELECT SUM(t.amount_jpy) FROM family_member_prepaid_topups t WHERE t.prepaid_account_id=a.account_id AND t.household_id=a.household_id),0) direct_topups,COALESCE((SELECT SUM((CASE WHEN k.after_account_id=a.account_id THEN k.after_amount_jpy ELSE 0 END)-(CASE WHEN k.before_account_id=a.account_id THEN k.before_amount_jpy ELSE 0 END)) FROM family_member_prepaid_topup_corrections k WHERE k.household_id=a.household_id AND (k.before_account_id=a.account_id OR k.after_account_id=a.account_id)),0) correction_delta,COALESCE((SELECT SUM(j.delta_jpy) FROM family_prepaid_balance_journal j WHERE j.prepaid_account_id=a.account_id AND j.household_id=a.household_id AND j.effective_date>=? AND j.delta_jpy>0),0) charged_month,COALESCE((SELECT SUM(t.amount_jpy) FROM family_member_prepaid_topups t WHERE t.prepaid_account_id=a.account_id AND t.household_id=a.household_id AND t.effective_date>=?),0) direct_charged_month,COALESCE((SELECT SUM((CASE WHEN k.after_account_id=a.account_id AND k.after_effective_date>=? THEN k.after_amount_jpy ELSE 0 END)-(CASE WHEN k.before_account_id=a.account_id AND k.before_effective_date>=? THEN k.before_amount_jpy ELSE 0 END)) FROM family_member_prepaid_topup_corrections k WHERE k.household_id=a.household_id),0) correction_charged_month,COALESCE((SELECT SUM(-j.delta_jpy) FROM family_prepaid_balance_journal j WHERE j.prepaid_account_id=a.account_id AND j.household_id=a.household_id AND j.effective_date>=? AND j.delta_jpy<0),0) spent_month,COALESCE((SELECT SUM(c.amount_jpy) FROM family_points_prepaid_credits c WHERE c.prepaid_account_id=a.account_id AND c.household_id=a.household_id),0) points_credit,COALESCE((SELECT SUM(r.debited_prepaid_jpy) FROM family_points_prepaid_refunds r WHERE r.prepaid_account_id=a.account_id AND r.household_id=a.household_id),0) points_refund,COALESCE(alert.enabled,0) AS alert_enabled,COALESCE(alert.threshold_jpy,1000) AS alert_threshold_jpy,COALESCE(alert.version,0) AS alert_version FROM family_financial_accounts a LEFT JOIN prepaid_balance_alert_settings alert ON alert.account_scope='member' AND alert.resource_key=a.account_id AND alert.household_id=a.household_id AND alert.owner_user_id=a.owner_user_id WHERE a.household_id=? AND a.owner_user_id=? AND a.account_kind='prepaid' AND a.origin='member_created' AND a.is_archived=0 ORDER BY a.sort_order,a.created_at DESC LIMIT 101").bind(month2, month2, month2, month2, month2, user.household_id, user.user_id).all();
    const rows = q.results || [];
    if (rows.length > 100) return response2({ ok: false, code: "ACCOUNT_LIMIT" }, 409);
    const cards = [];
    for (const a of rows) {
      if (!/^[a-f0-9]{32}$/i.test(a.account_id) || typeof a.label !== "string" || ![a.opening_balance, a.journal, a.direct_topups, a.correction_delta, a.direct_charged_month, a.correction_charged_month, a.charged_month, a.spent_month, a.points_credit, a.points_refund].every(Number.isSafeInteger)) return response2({ ok: false, code: "INVALID_WALLET_BALANCE" }, 409);
      const balance = a.opening_balance + a.journal + a.direct_topups + a.correction_delta + a.points_credit - a.points_refund;
      if (!Number.isSafeInteger(balance) || balance < 0) return response2({ ok: false, code: "BALANCE_NEEDS_REVIEW" }, 409);
      cards.push({
        name: a.label,
        account_id: a.account_id,
        version: a.version,
        owner_user_id: user.user_id,
        alert_enabled: !!a.alert_enabled,
        alert_threshold_jpy: a.alert_threshold_jpy,
        alert_version: a.alert_version,
        is_archived: !!a.is_archived,
        opening_balance: a.opening_balance,
        opening_date: String(a.created_at || "").slice(0, 10) || "\u767B\u9332\u6642",
        balance,
        charged_month: a.charged_month + a.direct_charged_month + a.correction_charged_month,
        spent_month: a.spent_month,
        transferred_out_month: 0,
        earned_month: 0,
        tracked_only: true
      });
    }
    const journal = await db.prepare("SELECT j.effective_date,j.delta_jpy,a.label FROM family_prepaid_balance_journal j JOIN family_financial_accounts a ON a.account_id=j.prepaid_account_id AND a.household_id=j.household_id WHERE j.household_id=? AND a.owner_user_id=? AND a.account_kind='prepaid' ORDER BY j.effective_date DESC,j.created_at DESC LIMIT 100").bind(user.household_id, user.user_id).all();
    const recentDirect = (await db.prepare(
      "SELECT COALESCE(k.after_effective_date,t.effective_date) AS effective_date,COALESCE(k.after_amount_jpy,t.amount_jpy) AS delta_jpy,a.label,t.created_at FROM family_member_prepaid_topups t LEFT JOIN family_member_prepaid_topup_corrections k ON k.correction_id=(SELECT correction_id FROM family_member_prepaid_topup_corrections WHERE topup_request_id=t.request_id ORDER BY revision DESC LIMIT 1) JOIN family_financial_accounts a ON a.account_id=COALESCE(k.after_account_id,t.prepaid_account_id) WHERE t.household_id=? AND t.owner_user_id=? ORDER BY t.created_at DESC LIMIT 100"
    ).bind(user.household_id, user.user_id).all()).results || [];
    const acts = [...(journal.results || []).map((r) => ({ ...r, created_at: 0 })), ...recentDirect].sort((a, b) => b.effective_date.localeCompare(a.effective_date) || b.created_at - a.created_at);
    const latest = /* @__PURE__ */ __name((sign2) => {
      const j = acts.find((x) => sign2 > 0 ? x.delta_jpy > 0 : x.delta_jpy < 0);
      return j ? { card: j.label, merchant: "", amount: Math.abs(j.delta_jpy), date: j.effective_date } : null;
    }, "latest");
    return response2({
      ok: true,
      scope: "personal",
      owner_user_id: user.user_id,
      cards,
      latestUsage: latest(-1),
      latestCharge: latest(1),
      institution_verified: false,
      ledger_changed: false
    });
  } catch {
    return response2({ ok: false, code: "PERSONAL_PREPAID_REPORT_UNAVAILABLE" }, 503);
  }
}
__name(familyPrepaidReport, "familyPrepaidReport");

// functions/api/prepaid-alert-settings.js
var json7 = /* @__PURE__ */ __name((value, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } }), "json");
var validAlertAmount = /* @__PURE__ */ __name((value) => Number.isSafeInteger(value) && value >= 0 && value <= 1e8, "validAlertAmount");
async function updatePrepaidAlert(db, { scope, key: key2, householdId: householdId2, ownerUserId, enabled: enabled5, thresholdJpy }) {
  if (!["legacy", "member"].includes(scope) || typeof key2 !== "string" || !key2 || key2.length > 160 || !householdId2 || !ownerUserId || typeof enabled5 !== "boolean" || !validAlertAmount(thresholdJpy))
    return json7({ code: "INVALID_ALERT_SETTINGS" }, 400);
  const owner = scope === "legacy" ? await db.prepare(`SELECT p.name FROM payment_sources p JOIN family_legacy_owner_claims c
       ON c.record_scope='payment_source' AND c.record_key=p.name
       WHERE p.name=?1 AND p.source_type='prepaid' AND p.is_archived=0
         AND c.household_id=?2 AND c.owner_user_id=?3`).bind(key2, householdId2, ownerUserId).first() : await db.prepare(`SELECT account_id FROM family_financial_accounts
       WHERE account_id=?1 AND account_kind='prepaid' AND origin='member_created'
         AND is_archived=0 AND household_id=?2 AND owner_user_id=?3`).bind(key2, householdId2, ownerUserId).first();
  if (!owner) return json7({ code: "PREPAID_ALERT_NOT_OWNED" }, 403);
  const time = Date.now();
  await db.prepare(`INSERT INTO prepaid_balance_alert_settings
   (account_scope,resource_key,household_id,owner_user_id,enabled,threshold_jpy,updated_at)
   VALUES(?1,?2,?3,?4,?5,?6,?7)
   ON CONFLICT(account_scope,resource_key) DO UPDATE SET
     enabled=excluded.enabled,threshold_jpy=excluded.threshold_jpy,
     version=prepaid_balance_alert_settings.version+1,updated_at=excluded.updated_at
   WHERE prepaid_balance_alert_settings.household_id=excluded.household_id
     AND prepaid_balance_alert_settings.owner_user_id=excluded.owner_user_id
     AND (prepaid_balance_alert_settings.enabled<>excluded.enabled
       OR prepaid_balance_alert_settings.threshold_jpy<>excluded.threshold_jpy)`).bind(scope, key2, householdId2, ownerUserId, enabled5 ? 1 : 0, thresholdJpy, time).run();
  const setting = await db.prepare(`SELECT enabled,threshold_jpy,version
   FROM prepaid_balance_alert_settings WHERE account_scope=?1 AND resource_key=?2
     AND household_id=?3 AND owner_user_id=?4`).bind(scope, key2, householdId2, ownerUserId).first();
  if (!setting) return json7({ code: "PREPAID_ALERT_OWNER_CONFLICT" }, 409);
  return json7({
    ok: true,
    alert_enabled: !!setting.enabled,
    alert_threshold_jpy: setting.threshold_jpy,
    alert_version: setting.version
  });
}
__name(updatePrepaidAlert, "updatePrepaidAlert");
async function privatePrepaidAlertSnapshot(env, { householdId: householdId2, ownerUserId }) {
  if (!env.DB || typeof householdId2 !== "string" || !householdId2 || householdId2.length > 128 || typeof ownerUserId !== "string" || !/^[0-9a-f-]{36}$/i.test(ownerUserId))
    return json7({ error: "invalid_identity" }, 400);
  const db = env.DB;
  const identity6 = await db.prepare(`SELECT 1 FROM homeflow_identity_links
   WHERE user_id=?1 AND household_id=?2 AND state='active'`).bind(ownerUserId, householdId2).first();
  if (!identity6) return json7({ error: "not_authorized" }, 403);
  let settings;
  try {
    settings = (await db.prepare(`SELECT s.account_scope,s.resource_key,s.threshold_jpy,s.version
    FROM prepaid_balance_alert_settings s
    WHERE s.household_id=?1 AND s.owner_user_id=?2 AND s.enabled=1
    ORDER BY s.account_scope,s.resource_key LIMIT 101`).bind(householdId2, ownerUserId).all()).results || [];
  } catch {
    return json7({ error: "alert_settings_unavailable" }, 503);
  }
  if (settings.length > 100) return json7({ error: "alert_limit" }, 409);
  if (!settings.length) return json7({ ok: true, householdId: householdId2, ownerUserId, items: [] });
  const result2 = /* @__PURE__ */ new Map();
  if (settings.some((s) => s.account_scope === "legacy")) {
    const req = new Request("https://kakeibo.internal/api/prepaid-assets");
    const res = await handlePrepaid({ db, request: req, method: "GET", sub: null });
    if (!res.ok) return json7({ error: "legacy_balance_unavailable" }, 503);
    const data = await res.json();
    for (const card of data.cards || []) {
      if (!card.is_archived && Number.isSafeInteger(card.balance))
        result2.set("legacy:" + card.name, { name: card.name, balance: card.balance });
    }
  }
  if (settings.some((s) => s.account_scope === "member")) {
    const res = await familyPrepaidReport(env, { household_id: householdId2, user_id: ownerUserId });
    if (!res.ok) return json7({ error: "personal_balance_unavailable" }, 503);
    const data = await res.json();
    for (const card of data.cards || []) {
      if (!card.is_archived && Number.isSafeInteger(card.balance))
        result2.set("member:" + card.account_id, { name: card.name, balance: card.balance });
    }
  }
  const items = [];
  for (const row of settings) {
    if (!["legacy", "member"].includes(row.account_scope) || !validAlertAmount(row.threshold_jpy) || !Number.isSafeInteger(row.version)) continue;
    const allowed2 = row.account_scope === "legacy" ? await db.prepare(`SELECT 1 FROM family_legacy_owner_claims c
      JOIN payment_sources p ON p.name=c.record_key
      WHERE c.record_scope='payment_source' AND c.record_key=?1
        AND c.household_id=?2 AND c.owner_user_id=?3
        AND p.source_type='prepaid' AND p.is_archived=0`).bind(row.resource_key, householdId2, ownerUserId).first() : await db.prepare(`SELECT 1 FROM family_financial_accounts
      WHERE account_id=?1 AND household_id=?2 AND owner_user_id=?3
        AND account_kind='prepaid' AND origin='member_created' AND is_archived=0`).bind(row.resource_key, householdId2, ownerUserId).first();
    const card = result2.get(row.account_scope + ":" + row.resource_key);
    if (!allowed2 || !card) continue;
    items.push({
      scope: row.account_scope,
      key: row.resource_key,
      name: card.name,
      balance: card.balance,
      thresholdJpy: row.threshold_jpy,
      version: row.version
    });
  }
  return json7({ ok: true, householdId: householdId2, ownerUserId, items });
}
__name(privatePrepaidAlertSnapshot, "privatePrepaidAlertSnapshot");

// src/japan-holidays.js
var holidayCache = /* @__PURE__ */ new Map();
var pad = /* @__PURE__ */ __name((value) => String(value).padStart(2, "0"), "pad");
var key = /* @__PURE__ */ __name((year, month2, day) => `${year}-${pad(month2)}-${pad(day)}`, "key");
var weekday = /* @__PURE__ */ __name((year, month2, day) => new Date(Date.UTC(year, month2 - 1, day)).getUTCDay(), "weekday");
var nthMonday = /* @__PURE__ */ __name((year, month2, ordinal) => 1 + (8 - weekday(year, month2, 1)) % 7 + (ordinal - 1) * 7, "nthMonday");
var equinox = /* @__PURE__ */ __name((year, season) => {
  if (season === "spring") {
    return Math.floor((year < 1980 ? 20.8357 : year < 2100 ? 20.8431 : 21.851) + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  return Math.floor((year < 1980 ? 23.2588 : year < 2100 ? 23.2488 : 24.2488) + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}, "equinox");
function nationalHolidays(year) {
  const days = /* @__PURE__ */ new Set();
  if (!Number.isInteger(year) || year < 1948 || year > 9999) return days;
  const add = /* @__PURE__ */ __name((month2, day) => {
    const iso2 = key(year, month2, day);
    if (iso2 >= "1948-07-20") days.add(iso2);
  }, "add");
  add(1, 1);
  if (year >= 2e3) add(1, nthMonday(year, 1, 2));
  else if (year >= 1949) add(1, 15);
  if (year >= 1967) add(2, 11);
  if (year >= 2020) add(2, 23);
  if (year >= 1989 && year <= 2018) add(12, 23);
  add(3, equinox(year, "spring"));
  if (year >= 2007) add(4, 29);
  else if (year >= 1949) add(4, 29);
  add(5, 3);
  if (year >= 2007) add(5, 4);
  add(5, 5);
  if (year === 2020) {
    add(7, 23);
    add(7, 24);
    add(8, 10);
  } else if (year === 2021) {
    add(7, 22);
    add(7, 23);
    add(8, 8);
  } else {
    if (year >= 2003) add(7, nthMonday(year, 7, 3));
    else if (year >= 1996) add(7, 20);
    if (year >= 2016) add(8, 11);
    if (year >= 2e3) add(10, nthMonday(year, 10, 2));
    else if (year >= 1966) add(10, 10);
  }
  if (year >= 2003) add(9, nthMonday(year, 9, 3));
  else if (year >= 1966) add(9, 15);
  add(9, equinox(year, "autumn"));
  add(11, 3);
  add(11, 23);
  const special = {
    1959: [[4, 10]],
    1989: [[2, 24]],
    1990: [[11, 12]],
    1993: [[6, 9]],
    2019: [[5, 1], [10, 22]]
  };
  for (const [month2, day] of special[year] || []) add(month2, day);
  return days;
}
__name(nationalHolidays, "nationalHolidays");
function holidaysForYear(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const nationals = nationalHolidays(year);
  const holidays = new Set(nationals);
  if (year >= 1986) {
    for (let timestamp = Date.UTC(year, 0, 2); timestamp < Date.UTC(year, 11, 31); timestamp += 864e5) {
      const previous = new Date(timestamp - 864e5).toISOString().slice(0, 10);
      const current = new Date(timestamp).toISOString().slice(0, 10);
      const next = new Date(timestamp + 864e5).toISOString().slice(0, 10);
      if (!nationals.has(current) && nationals.has(previous) && nationals.has(next)) holidays.add(current);
    }
  }
  for (const iso2 of nationals) {
    if (iso2 < "1973-04-12" || weekday(year, Number(iso2.slice(5, 7)), Number(iso2.slice(8, 10))) !== 0) continue;
    let timestamp = Date.parse(iso2 + "T00:00:00Z") + 864e5;
    let next = new Date(timestamp).toISOString().slice(0, 10);
    if (year >= 2007) {
      while (nationals.has(next)) {
        timestamp += 864e5;
        next = new Date(timestamp).toISOString().slice(0, 10);
      }
    }
    if (!nationals.has(next)) holidays.add(next);
  }
  holidayCache.set(year, holidays);
  return holidays;
}
__name(holidaysForYear, "holidaysForYear");
function isJapanHoliday(date8) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date8)) return false;
  const year = Number(date8.slice(0, 4));
  const month2 = Number(date8.slice(5, 7));
  const day = Number(date8.slice(8, 10));
  const parsed = new Date(Date.UTC(year, month2 - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month2 - 1 || parsed.getUTCDate() !== day) return false;
  const dayOfWeek = parsed.getUTCDay();
  return dayOfWeek === 0 || dayOfWeek === 6 || holidaysForYear(year).has(date8);
}
__name(isJapanHoliday, "isJapanHoliday");

// src/recurring-posting.js
var validMonth = /* @__PURE__ */ __name((month2) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month2 || "")), "validMonth");
var monthOrdinal = /* @__PURE__ */ __name((month2) => Number(month2.slice(0, 4)) * 12 + Number(month2.slice(5, 7)) - 1, "monthOrdinal");
var parseArray = /* @__PURE__ */ __name((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}, "parseArray");
var normalizedDays = /* @__PURE__ */ __name((values, min, max, fallback) => {
  const valid = [...new Set(parseArray(values).map(Number).filter((n) => Number.isInteger(n) && n >= min && n <= max))].sort((a, b) => a - b);
  return valid.length ? valid : [Number(fallback)];
}, "normalizedDays");
var recurringMonthDays = /* @__PURE__ */ __name((plan) => normalizedDays(
  plan?.monthDays ?? plan?.month_days_json,
  1,
  31,
  plan?.day ?? 1
), "recurringMonthDays");
var recurringWeekdays = /* @__PURE__ */ __name((plan) => normalizedDays(
  plan?.weekdays ?? plan?.weekdays_json,
  0,
  6,
  plan?.weekday ?? 0
), "recurringWeekdays");
var recurringIntervalMonths = /* @__PURE__ */ __name((plan) => Number(plan?.intervalMonths ?? plan?.interval_months ?? 1), "recurringIntervalMonths");
function scheduledRecurringDate(month2, day) {
  if (!validMonth(month2)) return null;
  const [year, number] = month2.split("-").map(Number);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return month2 + "-" + String(Math.min(day, new Date(Date.UTC(year, number, 0)).getUTCDate())).padStart(2, "0");
}
__name(scheduledRecurringDate, "scheduledRecurringDate");
function recurringScheduleType(plan) {
  return plan?.workdayOnly || Number(plan?.workday_only) === 1 ? "workday" : plan?.scheduleType || plan?.schedule_type || "monthly";
}
__name(recurringScheduleType, "recurringScheduleType");
var recurringIsPerDate = /* @__PURE__ */ __name((plan) => recurringScheduleType(plan) !== "monthly" || recurringMonthDays(plan).length > 1, "recurringIsPerDate");
function recurringOccurrencePeriod(plan, date8) {
  return recurringIsPerDate(plan) ? date8 : date8.slice(0, 7);
}
__name(recurringOccurrencePeriod, "recurringOccurrencePeriod");
function recurringDatesInMonth(month2, {
  scheduleType = "monthly",
  day = 1,
  weekday: weekday2 = 0,
  weekdays = null,
  monthDays = null,
  intervalMonths = 1,
  startMonth = ""
} = {}) {
  if (!validMonth(month2)) return [];
  if (scheduleType === "monthly") {
    if (!Number.isInteger(Number(intervalMonths)) || Number(intervalMonths) < 1 || Number(intervalMonths) > 24) return [];
    if (startMonth && (!validMonth(startMonth) || month2 < startMonth || (monthOrdinal(month2) - monthOrdinal(startMonth)) % Number(intervalMonths) !== 0)) return [];
    const days = normalizedDays(monthDays, 1, 31, day);
    return [...new Set(days.map((d) => scheduledRecurringDate(month2, d)).filter(Boolean))].sort();
  }
  const [year, number] = month2.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  if (scheduleType === "workday") {
    const dates2 = [];
    for (let d = 1; d <= last; d++) {
      const date8 = month2 + "-" + String(d).padStart(2, "0");
      if (!isJapanHoliday(date8)) dates2.push(date8);
    }
    return dates2;
  }
  if (scheduleType !== "weekly") return [];
  const selected = normalizedDays(weekdays, 0, 6, weekday2);
  const first = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  const dates = [];
  for (let d = 1; d <= last; d++)
    if (selected.includes((first + d - 1) % 7)) dates.push(month2 + "-" + String(d).padStart(2, "0"));
  return dates;
}
__name(recurringDatesInMonth, "recurringDatesInMonth");
function recurringDatesForPlanInMonth(plan, month2) {
  return recurringDatesInMonth(month2, {
    scheduleType: recurringScheduleType(plan),
    day: Number(plan?.day),
    weekday: Number(plan?.weekday || 0),
    weekdays: recurringWeekdays(plan),
    monthDays: recurringMonthDays(plan),
    intervalMonths: recurringIntervalMonths(plan),
    startMonth: plan?.startMonth || plan?.start_month || ""
  });
}
__name(recurringDatesForPlanInMonth, "recurringDatesForPlanInMonth");
function recurringRequestId(planId, period) {
  return "recurring_" + planId.replace(/-/g, "") + "_" + period.replace(/-/g, "");
}
__name(recurringRequestId, "recurringRequestId");

// src/recurring-check.js
function previewRecurringEntries(plans, entries, { today: today3 = /* @__PURE__ */ new Date(), historicalMonths = 0, excluded = [], previewDaysAhead = 0 } = {}) {
  const excludedKeys = new Set(excluded.flatMap((x) => [x.planId + ":" + (x.date || x.month)]));
  const current = new Date(today3.getFullYear(), today3.getMonth(), today3.getDate());
  const currentKey = [current.getFullYear(), String(current.getMonth() + 1).padStart(2, "0"), String(current.getDate()).padStart(2, "0")].join("-");
  const end = new Date(current.getFullYear(), current.getMonth(), current.getDate() + (previewDaysAhead === 1 ? 1 : 0));
  const endKey = [end.getFullYear(), String(end.getMonth() + 1).padStart(2, "0"), String(end.getDate()).padStart(2, "0")].join("-");
  const earliest = new Date(current.getFullYear(), current.getMonth() - Math.max(0, Math.min(119, historicalMonths)), 1);
  const manualCounts = /* @__PURE__ */ new Map(), idempotency = /* @__PURE__ */ new Set();
  for (const entry of entries || []) {
    if (entry.type !== "expense") continue;
    const date8 = String(entry.date || "").slice(0, 10);
    if (entry.client_request_id) idempotency.add(entry.client_request_id);
    if (String(entry.client_request_id || "").startsWith("recurring_")) {
      const ownedByActivePlan = (plans || []).some((plan) => plan.enabled && recurringRequestId(plan.id, recurringOccurrencePeriod(plan, date8)) === entry.client_request_id);
      if (ownedByActivePlan) continue;
    }
    const base = [entry.merchant, entry.payment_source || ""].join("|");
    for (const period of [date8, date8.slice(0, 7)]) {
      const key2 = period + "|" + base;
      manualCounts.set(key2, (manualCounts.get(key2) || 0) + 1);
    }
  }
  const candidates = [];
  for (const plan of plans || []) {
    if (!plan.enabled || !/^\d{4}-(0[1-9]|1[0-2])$/.test(plan.startMonth || "")) continue;
    const scheduleType = plan.scheduleType || "monthly";
    if (!["monthly", "weekly", "workday"].includes(scheduleType)) continue;
    const [sy, sm] = plan.startMonth.split("-").map(Number);
    const start = new Date(Math.max(new Date(sy, sm - 1, 1).getTime(), earliest.getTime()));
    for (let year = start.getFullYear(), month2 = start.getMonth() + 1, i = 0; i < 121 && (year < end.getFullYear() || year === end.getFullYear() && month2 <= end.getMonth() + 1); i++, month2++) {
      if (month2 === 13) {
        month2 = 1;
        year++;
      }
      const m = year + "-" + String(month2).padStart(2, "0");
      for (const date8 of recurringDatesForPlanInMonth(plan, m)) {
        if (date8 > endKey || excludedKeys.has(plan.id + ":" + m) || excludedKeys.has(plan.id + ":" + date8)) continue;
        const perDate = recurringIsPerDate(plan);
        const requestId = recurringRequestId(plan.id, perDate ? date8 : m);
        if (idempotency.has(requestId)) continue;
        const base = [plan.name, plan.paymentSource || ""].join("|");
        const conflictKey = (perDate ? date8 : m) + "|" + base;
        candidates.push({
          planId: plan.id,
          month: m,
          date: date8,
          name: plan.name,
          amount: Number(plan.amount),
          paymentSource: plan.paymentSource,
          day: Number(plan.day),
          scheduleType,
          weekday: Number(plan.weekday || 0),
          monthDays: recurringMonthDays(plan),
          weekdays: recurringWeekdays(plan),
          intervalMonths: recurringIntervalMonths(plan),
          perDate,
          category: plan.category,
          startMonth: plan.startMonth,
          conflictKey,
          conflict: false,
          upcoming: date8 > currentKey
        });
      }
    }
  }
  const seenSlots = /* @__PURE__ */ new Map();
  for (const row of [...candidates].sort((a, b) => a.date.localeCompare(b.date) || a.planId.localeCompare(b.planId))) {
    const used = seenSlots.get(row.conflictKey) || 0;
    row.conflict = used < (manualCounts.get(row.conflictKey) || 0);
    seenSlots.set(row.conflictKey, used + 1);
  }
  return candidates.map(({ conflictKey, ...row }) => row);
}
__name(previewRecurringEntries, "previewRecurringEntries");

// workers/homeflow-bill-reminders.js
var json8 = /* @__PURE__ */ __name((x, status = 200) => Response.json(x, { status, headers: { "cache-control": "no-store" } }), "json");
var date7 = /* @__PURE__ */ __name((x) => typeof x === "string" && /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(x) && (/* @__PURE__ */ new Date(x + "T00:00:00Z")).toISOString().slice(0, 10) === x, "date");
var userId = /* @__PURE__ */ __name((x) => typeof x === "string" && /^[a-f0-9-]{36}$/i.test(x), "userId");
var householdId = /* @__PURE__ */ __name((x) => typeof x === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(x), "householdId");
var plusOne = /* @__PURE__ */ __name((x) => new Date(Date.parse(x + "T00:00:00Z") + 864e5).toISOString().slice(0, 10), "plusOne");
var all = /* @__PURE__ */ __name(async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [], "all");
var view = /* @__PURE__ */ __name((p) => ({
  id: p.id,
  name: p.name,
  amount: Number(p.amount ?? p.amount_jpy),
  paymentSource: p.payment_source,
  startMonth: p.start_month,
  enabled: true,
  day: Number(p.day || 1),
  weekday: Number(p.weekday || 0),
  scheduleType: p.schedule_type,
  workdayOnly: Number(p.workday_only || 0) === 1,
  weekdays: p.weekdays_json,
  monthDays: p.month_days_json,
  intervalMonths: Number(p.interval_months || 1)
}), "view");
async function projectBillConfirmationReminders(db, { day, recipientUserId, householdId: hid }) {
  if (!date7(day) || !userId(recipientUserId) || !householdId(hid)) return null;
  const owner = await db.prepare(`SELECT role FROM homeflow_identity_links
  WHERE user_id=?1 AND household_id=?2 AND state='active'
    AND role IN ('owner','member') LIMIT 1`).bind(recipientUserId, hid).first();
  if (!owner) return { householdId: hid, recipientId: recipientUserId, items: [] };
  const due = plusOne(day), month2 = due.slice(0, 7);
  const original = owner.role === "owner";
  const raw = original ? await all(db, `SELECT id,name,amount,day,weekday,schedule_type,
   workday_only,weekdays_json,month_days_json,interval_months,payment_source,start_month
   FROM recurring_plans WHERE enabled=1 AND posting_mode='manual'
    AND start_month<=?1 AND NOT EXISTS(SELECT 1 FROM trash_items t
    WHERE t.item_type='recurring_plan' AND t.item_id=recurring_plans.id)
   ORDER BY id LIMIT 200`, month2) : await all(db, `SELECT plan_id AS id,name,amount_jpy,month_days_json,weekdays_json,
   schedule_type,interval_months,payment_source,start_month
   FROM family_member_fixed_cost_settings
   WHERE household_id=?1 AND owner_user_id=?2 AND enabled=1 AND start_month<=?3
   ORDER BY plan_id LIMIT 200`, hid, recipientUserId, month2);
  const plans = raw.map(view);
  let items = [];
  if (plans.length) {
    const [entries, monthSkips, dateSkips] = await Promise.all([
      all(db, `SELECT date,merchant,payment_source,amount,type,client_request_id
    FROM entries WHERE type='expense' AND date>=?1 AND date<date(?1,'+1 month')
    ORDER BY date,id LIMIT 1500`, month2 + "-01"),
      original ? all(db, "SELECT plan_id AS planId,month FROM recurring_candidate_exclusions WHERE month=? LIMIT 200", month2) : [],
      original ? all(db, "SELECT plan_id AS planId,date FROM recurring_date_exclusions WHERE date=? LIMIT 200", due) : []
    ]);
    items = previewRecurringEntries(plans, entries, {
      today: /* @__PURE__ */ new Date(due + "T12:00:00Z"),
      historicalMonths: 0,
      excluded: [...monthSkips, ...dateSkips]
    }).filter((x) => x.date === due && !x.conflict).map((x) => ({
      kind: "fixed",
      planId: x.planId,
      name: x.name,
      dueOn: due,
      amountJpy: x.amount
    }));
  }
  if (original) {
    const bills = await all(db, `SELECT b.plan_id AS planId,b.period_month AS periodMonth,
   p.name,p.payment_source AS paymentSource,b.amount_jpy AS amountJpy
   FROM variable_recurring_bills b JOIN variable_recurring_plans p ON p.id=b.plan_id
   WHERE p.enabled=1 AND b.status='draft' AND b.expense_date=?1
   ORDER BY b.plan_id,b.period_month LIMIT 200`, day);
    for (const bill of bills) {
      const amt = Number(bill.amountJpy);
      const booked = Number.isSafeInteger(amt) && amt > 0 ? await db.prepare(`
     SELECT 1 FROM entries WHERE type='expense' AND merchant=?1
      AND COALESCE(payment_source,'')=?2 AND amount=?3
      AND date>=?4 AND date<date(?4,'+1 month') LIMIT 1`).bind(bill.name, bill.paymentSource || "", amt, day.slice(0, 7) + "-01").first() : null;
      if (!booked) items.push({
        kind: "variable",
        planId: bill.planId,
        name: bill.name,
        dueOn: day,
        periodMonth: bill.periodMonth,
        amountJpy: bill.amountJpy ?? null
      });
    }
  }
  return { householdId: hid, recipientId: recipientUserId, items: items.slice(0, 200) };
}
__name(projectBillConfirmationReminders, "projectBillConfirmationReminders");
async function readBillConfirmationReminders(request, db) {
  if (!db?.prepare) return json8({ error: "db_unavailable" }, 503);
  const q = new URL(request.url).searchParams, allowed2 = /* @__PURE__ */ new Set(["day", "recipientUserId", "householdId"]);
  if ([...q.keys()].some((k) => !allowed2.has(k) || q.getAll(k).length !== 1)) return json8({ error: "invalid_query" }, 400);
  const day = q.get("day"), recipientUserId = q.get("recipientUserId"), hid = q.get("householdId");
  if (!date7(day) || !userId(recipientUserId) || !householdId(hid)) return json8({ error: "invalid_query" }, 400);
  return json8(await projectBillConfirmationReminders(db, { day, recipientUserId, householdId: hid }));
}
__name(readBillConfirmationReminders, "readBillConfirmationReminders");

// workers/homeflow-service-bridge.js
var json9 = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), { status, headers: {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
} }), "json");
var validDate2 = /* @__PURE__ */ __name((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) && (/* @__PURE__ */ new Date(v + "T00:00:00Z")).toISOString().slice(0, 10) === v, "validDate");
var project = /* @__PURE__ */ __name((e) => ({
  id: e.id,
  date: e.date,
  amount: e.amount,
  category: e.category,
  merchant: e.merchant || "",
  type: e.type
}), "project");
async function envSafeSum(db, start, end) {
  const row = await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income,
    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense
    FROM entries WHERE NOT (amount=0 AND (COALESCE(client_request_id,'') LIKE 'hfcard:%' OR COALESCE(client_request_id,'') LIKE 'hfprepaid:%')) AND date>=?1 AND date<=?2 AND type IN ('income','expense')`).bind(start, end).first();
  const income = Number(row?.income || 0), expense = Number(row?.expense || 0);
  if (!Number.isSafeInteger(income) || !Number.isSafeInteger(expense))
    throw Error("invalid_sum");
  return { income, expense };
}
__name(envSafeSum, "envSafeSum");
async function readLedger(request, db) {
  const params = new URL(request.url).searchParams;
  if (params.get("summary") === "net") {
    const start2 = params.get("start"), end2 = params.get("end");
    if (!validDate2(start2) || !validDate2(end2) || end2 < start2 || Date.parse(end2 + "T00:00:00Z") - Date.parse(start2 + "T00:00:00Z") > 3660 * 864e5)
      return json9({ error: "invalid_range" }, 400);
    try {
      const row = await envSafeSum(db, start2, end2);
      return json9({ start: start2, end: end2, income: row.income, expense: row.expense, net: row.income - row.expense });
    } catch {
      return json9({ error: "ledger_read_unavailable" }, 503);
    }
  }
  const ids = params.get("ids");
  if (ids !== null) {
    if (!/^[1-9]\d{0,11}(,[1-9]\d{0,11}){0,49}$/.test(ids))
      return json9({ error: "invalid_ids" }, 400);
    const unique2 = [...new Set(ids.split(",").map(Number))];
    if (unique2.length > 50) return json9({ error: "invalid_ids" }, 400);
    const placeholders = unique2.map((_, i) => "?" + (i + 1)).join(",");
    try {
      const { results } = await db.prepare("SELECT id,date,amount,category,merchant,type FROM entries WHERE type='expense' AND id IN (" + placeholders + ") ORDER BY date DESC,id DESC").bind(...unique2).all();
      return json9({ entries: (results || []).map(project) });
    } catch {
      return json9({ error: "ledger_read_unavailable" }, 503);
    }
  }
  const start = params.get("start"), end = params.get("end");
  const limit = Number(params.get("limit") || "50");
  if (!validDate2(start) || !validDate2(end) || end < start || Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z") > 90 * 864e5 || !Number.isInteger(limit) || limit < 1 || limit > 100) return json9({ error: "invalid_range" }, 400);
  const cursor = params.get("cursor");
  let cursorDate = end, cursorId = Number.MAX_SAFE_INTEGER;
  if (cursor) {
    const match4 = /^(\d{4}-\d{2}-\d{2}):([1-9]\d{0,11})$/.exec(cursor);
    if (!match4 || !validDate2(match4[1]) || match4[1] < start || match4[1] > end)
      return json9({ error: "invalid_cursor" }, 400);
    cursorDate = match4[1];
    cursorId = Number(match4[2]);
  }
  try {
    const { results } = await db.prepare("SELECT id,date,amount,category,merchant,type FROM entries WHERE type='expense' AND date>=?1 AND date<=?2 AND (date<?3 OR (date=?3 AND id<?4)) ORDER BY date DESC,id DESC LIMIT ?5").bind(start, end, cursorDate, cursorId, limit + 1).all();
    const batch = (results || []).slice(0, limit);
    const more = (results || []).length > limit;
    return json9({ entries: batch.map(project), nextCursor: more && batch.length ? batch[batch.length - 1].date + ":" + batch[batch.length - 1].id : null });
  } catch {
    return json9({ error: "ledger_read_unavailable" }, 503);
  }
}
__name(readLedger, "readLedger");
var homeflow_service_bridge_default = {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api/internal/bill-confirmation-reminders") {
      if (request.method !== "GET") return json9({ error: "method_not_allowed" }, 405);
      try {
        return await readBillConfirmationReminders(request, env.DB);
      } catch {
        return json9({ error: "bill_reminder_source_unavailable" }, 503);
      }
    }
    if (path === "/api/internal/prepaid-balance-alerts") {
      if (request.method !== "GET") return json9({ error: "method_not_allowed" }, 405);
      const params = new URL(request.url).searchParams;
      try {
        return await privatePrepaidAlertSnapshot(env, {
          householdId: params.get("householdId"),
          ownerUserId: params.get("ownerUserId")
        });
      } catch {
        return json9({ error: "prepaid_alert_projection_unavailable" }, 503);
      }
    }
    if (path === "/api/internal/approval-preview") return approvalPreviewRoute(request, env);
    if (path.startsWith("/api/internal/")) {
      const response3 = await routeInternalFinance(request, env);
      if (response3) return response3;
      return json9({ ok: false, error: "internal_route_not_found" }, 404);
    }
    if (request.method === "POST" && path === "/api/bridge/document-assistant") {
      if (!env.DB) return json9({ ok: false, error: "ledger_unavailable" }, 503);
      return onRequestPost({ request, env: {
        ...env,
        JPDA_BRIDGE_ENABLED: "true",
        JPDA_PRIVATE_BRIDGE: "true"
      } });
    }
    if (request.method !== "GET" || path !== "/api/homeflow-ledger")
      return json9({ error: "not_found" }, 404);
    if (!env.DB) return json9({ error: "ledger_read_unavailable" }, 503);
    return readLedger(request, env.DB);
  }
};
export {
  homeflow_service_bridge_default as default,
  readLedger
};
//# sourceMappingURL=homeflow-service-bridge.js.map
