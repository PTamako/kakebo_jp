# 家計簿 7项审查整改执行记录（2026-10-29）

基线 main：`17700097db73c3680d5fe070b88f061e99a8736e`。只改 GitHub 分支，未连接或修改生产 D1，也未清理历史明细、SBI 数值、个人规则及本机收据图片。

| 问题 | 分支处理内容 | 验收边界 |
| --- | --- | --- |
| P1-1 跨月份重复导入 | `saveAll` 按草稿涉及月份重新读全量明细、复核日期/金额/店名/支付方式/类型；用户确认后才允许同内容多次入账；后端原请求 ID 幂等保留 | 非服务器全局唯一经济事件判定，并发入账仍需集成验证 |
| P1-2 JSON 恢复一致性 | 新备份 SHA-256 完整性字段；导出前后对账本与配置分别二次校验；恢复的新银行卡名称及结账日、默认卡、类别规则、支付规则及账单走单语句 insert-only/conditional 服务端路径，避免覆盖其他设备已存在的设置 | **不是全表原子事务**；旧版 JSON 仍可导入；需隔离 D1 完整恢复及断网重试 |
| P1-3 Preview 数据隔离 | 识别 Pages 预览域名并支持 `APP_ENV=preview` 和可用的分支标记；预览未验证时 503 断开访问，验证后业务写入仍 403；Wrangler Preview 标识默认生效 | **无法从仓库验证 Preview/Production 真实 D1 ID 不同**；必须 Cloudflare 控制台核验并在独立库演练 |
| P2-1 OCR Regex | 修复 `parse.js` 双反斜杠的数字、空白匹配模式，增加样例回归 | 真正相机 OCR、Safari、极端账单仍需实测 |
| P2-2 分类默认冲突 | 新安装的 `schema.sql` 统一便利店/超市 `饮食料品`；旧规则不批量覆盖，个人规则保持优先 | 旧版同名且用户已主动分类的规则无法自动区分，需逐条人工确认 |
| P2-3 D1 迁移治理 | 新安装 schema 补足必要列/表，添加 `migrations/0001_support_tables.sql` 和安全运维手册，减少非投资请求初始化投资表 | **现存 D1 兼容 ALTER 仍在 API**，禁止未经真实环境演练直接删除；未对生产执行 SQL |
| P2-4 发布验证 | 新增 `npm run verify:release`，把生产依赖 High 漏洞报告作为人工 CI 阻断条件；Actions 保持人工启动，增加审计 JSON 产物；补充多项新测试 | GitHub Actions 配额历史耗尽，最新 CI / npm audit / Cloudflare Preview Build 结果需另行查证 |

## 本次新增/修改测试
- `scripts/audit-seven-regression.test.js`：解析、备份 checksum、跨月份重复预检、Preview 和发布脚本。
- `scripts/d1-sqlite-integration.test.js`：实际 SQLite 的 insert-only 恢复（含银行卡名称/结账日/默认卡）和自定义域名 Preview 503。
- 原有所有 `scripts/*.test.js` 仍被生产 `npm run build` 纳入执行，不删除旧兼容测试。

## 合并安全门槛
1. 基于 PR 最新 SHA 的 `npm ci && npm run verify:release` 成功：全量 Node 测试、Vite 构建、生产依赖漏洞。
2. Cloudflare Pages Preview 构建成功，确认 Preview 准确连接独立 D1；Preview 未验证时 API 503 是保护行为，不是应绕过的故障。
3. 独立 D1 测试旧 v1/v2/v3 备份、SBI 非空估值不可覆盖、固定支出手动改 ¥101,500 为 ¥98,000、断网重复恢复。
4. iPhone Safari/PWA 实际点击、OCR 和分类、离线草稿与图表交互通过。
5. 生产 D1 只读统计、SBI 和用户自定义规则保留基线，再考虑正式合并。

**未经上述验证不得声称全部 7 项已彻底解决，不得直接清空、自动重算或覆盖既有账目。**
