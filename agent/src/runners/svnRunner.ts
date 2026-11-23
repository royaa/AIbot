import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { TaskCreatePayload } from "@grokbot/protocol";
import type { AgentConfig } from "../config.js";
import { assertPathInWorkspace } from "../config.js";
import { spawnTool, type ChunkHandler } from "./spawnUtil.js";

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

function collectOutput(
  svn: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<{ out: string; err: string; code: number }> {
  let out = "";
  let err = "";
  // Windows SVN 控制台多为 GBK，强制按 GBK 解码以免中文乱码
  const encoding = process.platform === "win32" ? ("gbk" as const) : ("utf8" as const);
  const { done } = spawnTool(
    svn,
    args,
    cwd,
    (kind, text) => {
      if (kind === "stderr") err += text;
      else out += text;
    },
    signal,
    { encoding },
  );
  return done.then(({ exitCode }) => ({ out, err, code: exitCode }));
}

function formatStatusMarkdown(svnRoot: string, xmlText: string): string {
  try {
    const doc = xml.parse(xmlText) as {
      status?: { target?: { entry?: unknown } };
    };
    let entries = doc.status?.target?.entry;
    const lines: string[] = [
      "### SVN 状态",
      "",
      `工作副本: \`${svnRoot}\``,
      "",
    ];
    if (!entries) {
      lines.push("无变更。\n");
      return lines.join("\n");
    }
    if (!Array.isArray(entries)) entries = [entries];
    lines.push("| 标记 | 路径 |", "| --- | --- |");
    for (const e of entries as { item?: string; path?: string }[]) {
      const mark = (e.item ?? "?").padEnd(4, " ");
      lines.push(`| ${mark} | \`${e.path ?? ""}\` |`);
    }
    lines.push("");
    return lines.join("\n");
  } catch {
    return xmlText;
  }
}

/** 解析相对 workspace 的 SVN 工作副本根目录（必填） */
function resolveSvnRoot(
  workspacePath: string,
  task: TaskCreatePayload,
  onChunk: ChunkHandler,
): string | null {
  let rel = task.options?.svnWorkDir?.trim();
  if (!rel) {
    const m = task.prompt.match(
      /^(?:status|update|diff|log|commit|提交|更新|差异|状态)\s+(\S.+)$/i,
    );
    if (m) rel = m[1].trim();
  }
  if (!rel) {
    onChunk(
      "stderr",
      "请指定 SVN 工作副本目录：在 App 填写「SVN 子目录」（相对 PC 工作区），或指令如「status www/某子项目」。\n",
    );
    return null;
  }
  rel = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const svnRoot = path.resolve(workspacePath, rel);
  assertPathInWorkspace(workspacePath, svnRoot);
  if (!fs.existsSync(svnRoot)) {
    onChunk("stderr", `目录不存在: ${svnRoot}\n`);
    return null;
  }
  return svnRoot;
}

function resolveFilePaths(
  workspacePath: string,
  svnRoot: string,
  relativePaths: string[],
): string[] {
  return relativePaths.map((p) => {
    const t = path.resolve(svnRoot, p);
    assertPathInWorkspace(workspacePath, t);
    return t;
  });
}

export async function runSvn(
  cfg: AgentConfig,
  workspacePath: string,
  task: TaskCreatePayload,
  onChunk: ChunkHandler,
  signal?: AbortSignal,
): Promise<number> {
  const svn = cfg.tools.svn ?? "svn";
  const svnRoot = resolveSvnRoot(workspacePath, task, onChunk);
  if (!svnRoot) return 1;

  const action = task.options?.svnAction ?? inferAction(task.prompt);
  const paths = resolveFilePaths(
    workspacePath,
    svnRoot,
    task.options?.svnPaths ?? [],
  );

  onChunk("info", `SVN 目标: \`${svnRoot}\`\n\n`);

  if (action === "commit") {
    const msg =
      task.options?.svnMessage ??
      task.prompt.replace(/^(commit|提交)\s*/i, "").trim();
    if (!msg || msg === task.options?.svnWorkDir) {
      onChunk("stderr", "请填写提交说明\n");
      return 1;
    }

    const st = await collectOutput(
      svn,
      ["status", "--xml", svnRoot],
      svnRoot,
      signal,
    );
    if (st.code !== 0) {
      onChunk("stderr", st.err || st.out);
      return st.code;
    }
    onChunk("markdown", formatStatusMarkdown(svnRoot, st.out));

    const diff = await collectOutput(
      svn,
      paths.length ? ["diff", ...paths] : ["diff", svnRoot],
      svnRoot,
      signal,
    );
    if (diff.out.trim()) {
      onChunk("markdown", "### 变更内容\n\n```diff\n" + trimDiff(diff.out) + "\n```\n\n");
    } else if (diff.err.trim()) {
      onChunk("stderr", diff.err);
    }

    onChunk("info", `### 执行提交\n\n说明: ${msg}\n\n`);
    const commitArgs = ["commit", "-m", msg, ...(paths.length ? paths : [svnRoot])];
    const cm = await collectOutput(svn, commitArgs, svnRoot, signal);
    if (cm.out.trim()) onChunk("stdout", cm.out + "\n");
    if (cm.err.trim()) onChunk("stderr", cm.err);
    if (cm.code === 0) onChunk("markdown", "**提交完成。**\n");
    return cm.code;
  }

  if (action === "status") {
    const st = await collectOutput(svn, ["status", "--xml", svnRoot], svnRoot, signal);
    if (st.code !== 0) {
      onChunk("stderr", st.err || st.out);
      return st.code;
    }
    onChunk("markdown", formatStatusMarkdown(svnRoot, st.out));
    return 0;
  }

  let args: string[] = [];
  switch (action) {
    case "update":
      args = ["update", svnRoot];
      break;
    case "log":
      args = ["log", "-l", "10", svnRoot];
      break;
    case "diff":
      args = paths.length ? ["diff", ...paths] : ["diff", svnRoot];
      break;
    default:
      onChunk("stderr", `未知 svn 动作: ${action}\n`);
      return 1;
  }

  const r = await collectOutput(svn, args, svnRoot, signal);
  if (action === "diff" && r.out.trim()) {
    onChunk("markdown", "### 差异\n\n```diff\n" + trimDiff(r.out) + "\n```\n");
  } else {
    if (r.out.trim()) onChunk("stdout", r.out + "\n");
    if (r.err.trim()) onChunk("stderr", r.err);
  }
  return r.code;
}

function trimDiff(s: string, max = 12000): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n…(差异过长，已截断)\n";
}

function inferAction(prompt: string) {
  const p = prompt.trim().toLowerCase();
  if (p.startsWith("commit") || p.startsWith("提交")) return "commit" as const;
  if (p.startsWith("update") || p.startsWith("更新")) return "update" as const;
  if (p.startsWith("diff") || p.startsWith("差异")) return "diff" as const;
  if (p.startsWith("log")) return "log" as const;
  if (p.startsWith("status") || p.startsWith("状态")) return "status" as const;
  return "status" as const;
}
