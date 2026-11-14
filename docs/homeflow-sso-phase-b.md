# HomeFlow 统一账号 · 家計簿阶段 B（安全隔离基础，仅 Draft）

> 2026-11-13 开发阶段。**不允许合并、部署、执行生产 0022 迁移**：用户将在有电脑时自行完成四个 D1 与 R2 的加密可恢复备份和恢复测试。目前无任何备份门槛豁免。禁止创建 Preview Worker/D1/R2。

## 新增内容

- 仅追加 `migrations/0022_homeflow_identity_foundation.sql`（未执行），不修改现有 `entries`、`payment_sources`、`device_sessions`、基金、定投、卡账单、余额或财务统计。
- `functions/api/homeflow-sso/[[path]].js` 是**与旧财务 API 完全分开的受控路由**。默认 `KAKEIBO_HOMEFLOW_SSO_ENABLED` 缺失/false 即禁用；未配置精确正式 HTTPS origin、AES 密钥或仅服务端可调用的 HomeFlow Service Binding 时也禁用，Preview 一律禁用。
- HomeFlow 现有 OAuth Authorization Code + PKCE S256 后端换码和 userinfo 确认 `user_id/household_id/role/display_name`。前端原 PWA 持有 5 分钟随机 `resume_secret`；Safari 回调只加密暂存 code，**绝不设置会话 Cookie**；回原 PWA 后由独立凭证 + Origin 校验完成，一次性 CAS 防重放。
- HomeFlow owner **首次**链接必须同时持有现有家計簿有效 `device_sessions` 的旧身份凭证；HomeFlow member 必须等同家庭 owner 首次绑定后才能建立个人身份。任何人不得根据昵称、邮箱、访问码文本或角色直接映射 owner 历史记录。
- 新 SSO 会话存在独立 `homeflow_sso_sessions`，**不会被原 `/api/*` 识别**。`GET /api/homeflow-sso/me` 仅返回 `ledger_access:false` 的身份状态，不提供账本/资产/个人配置访问。成员暂时不能使用该 SSO 访问财务内容，这是刻意安全门槛，须等阶段 C 真正落实数据库权限过滤和审批预提交后才能接入 UI / 旧 API。
- 服务端 `homeflow_identity_events` 留存已验证 actor 的首次链接、登录、注销操作摘要；不存原始 HomeFlow access token、密码、身份代码或银行资料。

## 待推进（不能视作可用 SSO）

1. 阶段 A：四 D1/R2 完整加密备份（真实文件持久存储和隔离恢复校验），**用户在有电脑时自行处理**；到此之前不得在生产执行 0022 或开启登录。
2. 阶段 B：HomeFlow PR #305 正式服务凭证与 callback allowlist、iPhone Safari/PWA 双人实机授权；更重要：跨 App 冻结/注销时验证并撤销独立 SSO 会话，暂时 15 分钟会话不具备即时撤销保证。
3. 阶段 C：当前财务 API 的权限门禁，全部账本/统计/所有资产余额家庭共享，信用卡/储值卡/定投/固定费/账户余额按个人 owner 分离；稳定账户 ID 替换 `payment_sources.name` PK 的无损兼容改造；member 正式记账改删新增必须预提交到 HomeFlow 审批，审核前不写正式账本。
4. 阶段 D/F：HomeFlow 审批目标事务执行器、幂等、安全审计、双人 E2E；然后才逐步清退旧 `AUTH_TOKEN` 单人登录，不可提前删除或停用。

## 自动测试

`tests/homeflow-sso-isolated.test.mjs`：Node 内存 SQLite 真迁移，OAuth mock 与真实 Pages Function 路由，验证旧 owner 双证、member 首次独立、新 PWA 与 Safari 不共享 Cookie、一次性凭证、错误来源、role/audience 冒用、旧会话被撤销，以及新 SSO Cookie **不能**访问旧财务 `/api/entries`。运行 `npm run test:parse`，再运行 `npm run build`。CI 成功不等于 iPhone 实机或正式安全验收。
