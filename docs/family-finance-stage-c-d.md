# 四应用统一账号 · 家計簿 C/D 阶段开发增量（Draft，未上线）

> 2026-11-13；依据 Google Drive 四应用实施设计书 v1.1。**用户稍后会在电脑上自行执行四 D1/R2 加密备份与隔离恢复测试**；备份门槛未达到，生产绝不能运行 0022/0023/0024，不能启用新 SSO 或账户/草稿开关，更不能将此 Draft 合并 main。禁止新建 Preview。

## C：个人账户稳定 ID 与家庭共用账本只读 API

- `migrations/0023_family_financial_account_identities.sql` 为新增表 `family_financial_accounts` / `family_finance_events`，每个账户用稳定 `account_id` 和 HomeFlow 身份 `owner_user_id`，可重名，owner 或家庭不允许越权更绑。操作事件保存真实操作者，禁止修改旧审计。
- 独立服务 `functions/api/family-finance/[[path]].js` 要求 `KAKEIBO_FAMILY_FINANCE_ENABLED='true'`，原 `KAKEIBO_HOMEFLOW_SSO_ENABLED='true'`，固定正式家庭 `KAKEIBO_FAMILY_HOUSEHOLD_ID`。每请求均经 HomeFlow 后端 session-introspect 验证；单人旧 `device_sessions` 与新会话分离。
- `GET /api/family-finance/accounts`：双方可看家庭名下账户摘要（不含金融卡号/源密钥）。`POST/PATCH /accounts`：member 仅本人账户，owner 可管理双方；更新时按账户 ID、版本、HomeFlow 身份做 CAS 并存审计。历史 `origin='legacy'` 的账户尚未切换旧业务 SQL，因此 **拒绝用这个新接口直接改历史设置**。
- `POST /api/family-finance/legacy/adopt`：仅经过原旧账号 + HomeFlow 双重验证的 owner、且显式 `confirm:true` 才可复制原 `payment_sources` 的账户设置到稳定 ID 映射表；保存原名、opening_balance 等，不删/不改任何旧表，幂等，拒绝成员冒领。**仅开发测试，尚未在正式运行**。
- `GET /api/family-finance/shared/entries`：两人读取同一家庭账本分页明细（不返回 OCR raw），`GET /shared/ledger-totals?month=YYYY-MM`：两人读取相同的月收入/支出/转移简计。**不是完整统计页面**；未改旧统计页面。
- **绝无**成员直写正式 `entries`：`POST /shared/entries` 不存在，且 HomeFlow SSO cookie 无法访问旧 `/api/entries`。现有旧单人账户、信用卡账期、持仓、定投、固定费、余额及历史不变。

## D：加密记账提案，仅本地准备，不提交审批、绝不入账

- 新增**未执行** `migrations/0024_family_finance_pending_actions.sql`：严格绑定真实 member、本人 `member_created` 且未归档的稳定账户 ID；状态只允许 `prepared→cancelled`，无假冒的 `approved/applied`；请求人 + household/账户/密文/哈希不可变。14 天过期，单人幂等键哈希防重复、私人加密载荷保存于家計簿 D1。
- 单独 `KAKEIBO_FAMILY_PENDING_KEY` **64 位十六进制 Secret**，仅服务端 AES-GCM 加密；未配置立即 503，不允许改成明文。这个 Secret **还没有配置生产、也不要求现在配置**。
- `POST /api/family-finance/proposals`：仅 member，暂支持已经有 stable ID 的本人账户、`expense/income` 小额常规明细；金额、类别、商家、日期做严格白名单验证。拒绝任何 transfer/SBI、已有历史卡号未映射情形，避免错误入账。返回 `status:'prepared_not_submitted'`、`homeflow_approval_id:null`、`ledger_changed:false`。
- `GET /proposals` 仅该 member 本人五条分页，返回 digest/status/时间，不读取还原敏感载荷；`POST /proposals/{id}/cancel` 仅原请求人，不重复取消，记真实 actor 审计。相同幂等键 + 不同内容返回 409。
- **禁止将草稿视作 HomeFlow 待审批**。目前尚无签名服务间 `POST /api/approvals` 代申请、HomeFlow owner 审核后有凭证的目标执行器，也没有自动更新正式家計簿 `entries`，所以任何状态都不能宣称 `approved` 或 `applied`。

## 自动验证 / 安全验收

[家計簿 Validate #43409918429](https://github.com/PTamako/kakebo_jp/actions/runs/43409918429) 已成功，覆盖源 HomeFlow 双会话、跨家庭/越权、同名账户不同归属、老账无损映射、重复/版本冲突、两人共享收支、加密草稿、不重复取消、转移类型拒绝、原 `entries/payment_sources` 字节级 SQL 行不变。移动端 WebKit Smoke 不等同于双真人 PWA E2E。

## 尚未完成

1. 阶段 C：**不可用现有旧 `payment_sources.name` 主键直接实现两位家庭成员**。需一次无损引入 stable `account_id` 至旧账本、支付规则、卡账单/储值余额/信用卡/SBI/定投/固定费，保留历史原名语义，旧 owner 数据只归 owner；完整统计页面家庭共享，私人账户编辑只给所属人和 owner。
2. 阶段 D：HomeFlow Draft #306 的审批申请与审核只有意图，需要服务间 Actor 授权、目标 App 密文取得/哈希校验、HomeFlow 真实 `approved` 证明、版本冲突控制、幂等事务（网络超时先查目标记账结果）、`executing→applied` 状态和审计，最后接 PWA 审批 UI；提交审批前和未获批准时均不得写家账。
3. 阶段 F：四 D1/R2 备份与隔离恢复、正式迁移顺序、双人 iPhone/Safari/PWA 切号、登出撤权、故障重试与旧登录回收验证完成后才部署；任何线上开关先保持 OFF。
