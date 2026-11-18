# 2026-11-18 记账本正式版验收与发布守则

## 本次处理目标
- Issue #384：新建成员专属信用卡/储值卡支出在 HomeFlow 审批后，金额/日期/类别/支付账户更正的原子账务差额、资产余额、月年统计、跨卡账期、已结算和积分抵扣，以及删除恢复。
- 发布控制：Pages 生产/Preview 的 Git 自动发布已经关闭。本次进一步把 `Deploy Private Kakeibo Bridge` 改为仅 `workflow_dispatch`，防止仅合并代码就重发私有 Worker。
- 备份：对 JSON+R2 小票 ZIP 执行端到端编码/解析/完整性/旧新明细 ID 匹配回归测试。导出时拒绝超过 200 KB 的图片，与恢复 API 及 ZIP 读取器保持一致。

## 核验依据与边界
- 2026-11-18 的正式 D1 已有 schema-0100 至 schema-0108 迁移；Pages 生产 `KAKEIBO_ACCOUNT_CORRECTIONS_ENABLED` 与 `KAKEIBO_OWNER_ACCOUNT_CORRECTIONS_ENABLED` 为 true，私有桥接的更正执行开关为 true。
- 已存在 `tests/family-shared-mutation-approved.test.mjs` 的完整 HomeFlow 提交、验证、执行、重复回执/回滚、信用卡、储值、跨卡、结算及积分抵扣场景；`tests/approved-account-household-sync-matrix.test.mjs` 覆盖真实 SQLite 对账聚合与统计；`tests/allocated-card-credit-reconciliation.test.mjs` 验证信用卡剩余额度、未抵用额。
- 2026-11-18 只读跨库比对：记账本 11 条 submitted 历史申请，HomeFlow 9 applied + 2 cancelled；9 条正式执行回执，0 条状态不一致。这不是 11 条当前待审。
- 正式数据库目前 `family_financial_accounts` 和 `family_approved_account_corrections` 均为 0 条。没有在生产创建虚假卡片/消费来测试；因此真实双人 iPhone 与真实首笔新卡消费仍需由实际使用验证，不可宣称实测完成。
- 备份回归以独立内存、模拟小票和 ZIP 进行；未导出个人生产账本或覆盖任何生产 R2 对象。完整备份依赖用户执行下载，HomeFlow 独立 D1 和家庭成员个人资产的完整灾难恢复不应被误解成单个原版 JSON ZIP 即可覆盖全部四平台。

## 手动部署原则
- **Pages**：使用既有生产环境的手动 Pages 发布命令/过程，发布前先看 `npm run verify:release` 与 Mobile WebKit Smoke；不重新打开 Pages Git 自动生产/Preview。
- **私有 Worker**：在 GitHub Actions 手动触发 `Deploy Private Kakeibo Bridge`，或运行 `npx wrangler deploy --config wrangler.homeflow-bridge.toml`。此工作流有独立生产凭据检查，切勿自动随 main 推送执行。
- **NAV Worker**：仅当 `workers/fund-nav-cron.js` / `wrangler.nav.toml` 或其依赖变更时单独手动发布；不额外创建 Preview Worker/D1/R2。
- 正式 D1 只读核验可以检查迁移与回执，**不要**用真实家庭账户创建测试交易，亦不要为了测试重跑 `schema.sql` 或历史迁移。
