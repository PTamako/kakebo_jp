# D1 マイグレーション運用

本番 D1 に接続している API は現在、旧インストールの列不足を検出して互換的に追加します。安全な移行手順が検証されるまで**この処理を一度に削除しない**でください。

1. 本番のテーブル構成、件数、SBI の current_value / pnl、分類規則を読み取り専用で記録する。
2. 本番とは別の D1 複製を用意し、まず `migrations/0001_support_tables.sql` を複製で試す。
3. 対象 DB に `entries.type` / `payment_source` / `client_request_id` / `transfer_*` があるかを検査する。旧 DB には列が存在しない場合があるため、新規 schema.sql を既存 DB の全面移行と誤用しない。
4. 旧バックアップ v1 / v2 / v3 を複製に復元し、件数、SBI、ユーザー規則、固定支出を検証する。
5. 本番適用には別途承認が必要。現段階では旧 API の互換マイグレーションは維持する。

この PR では既存 D1 に SQL を実行していない。ファイルは段階的な移行の準備であり、本番移行完了の証明ではない。

## 新规则切换（2026-10-29）
- 旧内置 rules 行暂时保留在 D1 作为历史迁移资料，但 **不再参与自动分类**。API 返回由当前 `DEFAULT_RULE_ROWS` 和 `custom_rules` 合成，后者优先。
- 不自动批量删除 `rules`，因为它还存储自定义类别 `__category__:` 和升级前无法完全区分的手动规则。所有历史 `entries.category` 保持原样。
- `migrations/0002_versioned_migration_tracking.sql` 只能在隔离 D1 副本演练后执行。正式迁移仍需检查数据库结构、SBI 快照和用户自定义规则。
- 大于 500 笔明细或 500 项设置的备份仍采用可恢复逐笔模式；小型备份使用 D1 单次 `batch()` 事务。不可宣称任意大小恢复均原子化。

## Preview 绑定验收
1. Cloudflare Pages Preview 环境中绑定名 `DB` 到专用 D1；生产 `DB` 必须为另外一个 UUID。
2. Preview variables 中明确配置 `APP_ENV=preview`、`PREVIEW_D1_ISOLATED=true`、`PREVIEW_D1_ID`、`PRODUCTION_D1_ID`，并核对两个 UUID 与实际绑定一致。
3. 缺少任何一个验真标记均返回 `503 preview_db_not_verified`。完成验真后 GET 可读取测试 D1，财务写入仍 `403 preview_read_only`。
4. 不要使用生产账户真实账目作为 Preview 测试数据；不要仅将不同 UUID 写在变量中就假定实际绑定完成。

## 发布验证
Cloudflare 构建执行 `npm run build`：Node 回归测试、`npm audit --omit=dev --audit-level=high`、Vite 生产构建。这样即使 GitHub Actions 配额暂不可用，高危/严重生产依赖告警仍阻止 Pages 构建。
