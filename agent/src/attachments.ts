import fs from "node:fs";
import path from "node:path";
import type { TaskCreatePayload } from "@grokbot/protocol";

export type TaskAttachment = {
  name: string;
  mimeType: string;
  dataBase64: string;
};

export function materializeAttachments(
  task: TaskCreatePayload,
  workspacePath: string,
): TaskCreatePayload {
  const attachments = task.options?.attachments as TaskAttachment[] | undefined;
  if (!attachments?.length) return task;

  const dir = path.join(workspacePath, ".grokbot", "uploads", task.taskId);
  fs.mkdirSync(dir, { recursive: true });
  const saved: string[] = [];
  for (const a of attachments) {
    const safe = path.basename(a.name).replace(/[^\w.\-]+/g, "_") || "upload.bin";
    const file = path.join(dir, safe);
    fs.writeFileSync(file, Buffer.from(a.dataBase64, "base64"));
    saved.push(file);
  }

  const list = saved.map((p) => `- ${p}`).join("\n");
  const prompt =
    task.prompt +
    "\n\n【用户上传的图片（PC 本地路径）】\n" +
    list +
    "\n请结合这些文件回答。";

  const { attachments: _drop, ...rest } = task.options ?? {};
  return {
    ...task,
    prompt,
    options: Object.keys(rest).length > 0 ? rest : undefined,
  };
}
