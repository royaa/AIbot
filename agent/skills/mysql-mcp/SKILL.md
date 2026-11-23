---
name: mysql-mcp
description: 本机 MySQL 应优先通过已投影的 MySQL MCP 工具查询/改数；不要手写 mysql.exe 或臆造表结构。若当前 CLI 未挂载 MCP，说明限制并建议切换到已同步 MCP 的 Claude / Cursor Agent。
---

# 本机 MySQL（MCP）

需要查库、看表结构、改数据时：

1. 优先调用当前 CLI 已配置的 **MySQL MCP**（工具名通常含 `mysql`）。
2. 先 `mysql_status` / 列表库表，再写 SQL；跨库用 `database` 参数或 `db.table`。
3. 写操作（UPDATE/DELETE/DDL）先确认库表与 WHERE；改完再 SELECT 核对。
4. **不要**用 Shell 跑 `mysql.exe` 代替 MCP；**不要**把密码写进回复。

若当前 CLI 没有 MySQL MCP：明确告诉用户「当前 CLI 未挂载公共 MCP」，并建议在 App 切到已同步 MCP 的 Claude 或 Cursor Agent，或在 PC 上运行 `npm run sync:mcp` 投影配置。
