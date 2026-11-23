import { CheckCircle2, X } from "lucide-react";
import { GUIDE_STEPS } from "../lib/guide.js";
import { Btn } from "./ui.js";

export function Guide({
  step,
  onStep,
  onClose,
}: {
  step: number;
  onStep: (index: number) => void;
  onClose: () => void;
}) {
  const current = GUIDE_STEPS[step] ?? GUIDE_STEPS[0];
  const last = step >= GUIDE_STEPS.length - 1;

  return (
    <div className="fixed inset-y-0 right-0 left-48 z-40 flex items-center justify-center bg-black/50 px-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        className="flex max-h-[86vh] w-[520px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-line px-6 py-4">
          <div>
            <div id="guide-title" className="text-sm font-semibold">
              新手引导
            </div>
            <div className="mt-0.5 text-[11px] text-dim">
              按这个顺序做完，手机就能遥控这台电脑上的 CLI
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-dim hover:bg-panel2 hover:text-fg"
            title="跳过引导"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-1.5 px-6 pt-4">
          {GUIDE_STEPS.map((s, i) => (
            <button
              key={s.page}
              type="button"
              onClick={() => onStep(i)}
              className="flex-1 text-left"
            >
              <div className={`h-1 rounded-full ${i <= step ? "bg-accent" : "bg-line"}`} />
              <div className={`mt-1.5 truncate text-[10px] ${i === step ? "text-accent" : "text-dim"}`}>
                {i + 1}. {s.short}
              </div>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="text-[11px] text-dim">
            第 {step + 1} 步 / 共 {GUIDE_STEPS.length} 步 · 左侧「{current.nav}」
          </div>
          <div className="mt-1.5 text-sm font-semibold">{current.title}</div>
          <p className="mt-3 text-xs leading-6 text-dim">{current.body}</p>
        </div>

        <div className="flex items-center justify-between border-t border-line px-6 py-3.5">
          <Btn variant="ghost" onClick={onClose}>
            跳过
          </Btn>
          <div className="flex items-center gap-2">
            <Btn variant="ghost" disabled={step === 0} onClick={() => onStep(step - 1)}>
              上一步
            </Btn>
            {last ? (
              <Btn onClick={onClose}>
                <CheckCircle2 size={13} /> 完成
              </Btn>
            ) : (
              <Btn onClick={() => onStep(step + 1)}>下一步</Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
