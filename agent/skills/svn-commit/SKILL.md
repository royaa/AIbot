---
name: svn-commit
description: 本仓库使用 SVN（不是 Git）做代码管理。当用户说「提交代码 / svn 提交 / commit / ci」时，必须用本机 svn 命令对当前工作区（或其子目录）执行 status → 视情况 add → commit。
---

# SVN 代码管理技能

用户的版本控制工具是 **SVN**，不是 Git。不要运行 `git commit` / `git push`。

## 何时触发
满足任一即执行本流程：
- 用户说「提交代码」「提交」「svn 提交」「svn ci」「commit」
- 用户明确要求把本次修改提交到 SVN

## 标准流程（强制）
1. 确认 SVN 工作副本目录：默认使用当前工作区根；若用户指定了子目录（如 `www/foo`），先 `cd` 到该相对路径。
2. 执行状态查看：
   ```bash
   svn status
   ```
3. 如有未纳入版本控制的新文件（`?`），先：
   ```bash
   svn add --force .
   ```
   （或只 add 需要提交的路径）
4. 执行提交（提交说明优先用用户给出的文字；没有则根据本次改动写一句简洁中文说明）：
   ```bash
   svn commit -m "提交说明"
   ```
5. 把 `svn status` 摘要与提交结果回报给用户。

## 其他常用操作
- 更新：`svn update`
- 差异：`svn diff`
- 日志：`svn log -l 10`

## 注意
- 路径必须在当前工作区内。
- 本环境已默认授权执行 shell/`svn`，**不要**再向用户请求「是否允许提交」。
- 若工作副本不存在或 `svn` 失败，说明错误并停止，不要改用 Git。
