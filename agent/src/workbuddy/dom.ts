import type { Page } from "playwright-core";

export type WbElement = {
  ref: string;
  tag: string;
  role: string;
  name: string;
  type: string;
  placeholder: string;
  value: string;
};

const ATTR = "data-wb-ref";

/** 给可交互元素编号并返回清单（供 LLM 规划） */
export async function annotateInteractive(page: Page): Promise<WbElement[]> {
  return page.evaluate((attr) => {
    const selectors = [
      "a[href]",
      "button",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[role='menuitem']",
      "[role='tab']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='switch']",
      "[role='combobox']",
      "[contenteditable='true']",
      "[onclick]",
    ].join(",");

    document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));

    const nodes = Array.from(document.querySelectorAll(selectors));
    const seen = new Set<Element>();
    const out: Array<{
      ref: string;
      tag: string;
      role: string;
      name: string;
      type: string;
      placeholder: string;
      value: string;
    }> = [];

    let i = 0;
    for (const el of nodes) {
      if (seen.has(el)) continue;
      seen.add(el);
      const html = el as HTMLElement;
      const style = window.getComputedStyle(html);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        continue;
      }
      const rect = html.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight + 20) continue;

      i += 1;
      const ref = `e${i}`;
      html.setAttribute(attr, ref);

      const name = (
        html.getAttribute("aria-label") ||
        html.getAttribute("title") ||
        (html as HTMLInputElement).placeholder ||
        html.innerText ||
        html.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);

      out.push({
        ref,
        tag: html.tagName.toLowerCase(),
        role: html.getAttribute("role") || "",
        name,
        type: (html as HTMLInputElement).type || "",
        placeholder: (html as HTMLInputElement).placeholder || "",
        value: ((html as HTMLInputElement).value || "").slice(0, 60),
      });
      if (out.length >= 80) break;
    }
    return out;
  }, ATTR);
}

export async function pageBrief(page: Page): Promise<string> {
  return page.evaluate(() => {
    const title = document.title || "";
    const bodyText = (document.body?.innerText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1800);
    return `title: ${title}\nurl: ${location.href}\ntext: ${bodyText}`;
  });
}

export function looksLikeLogin(url: string, brief: string): boolean {
  const u = url.toLowerCase();
  const t = brief.toLowerCase();
  if (/\/login|\/signin|\/sign-in|oauth|passport/.test(u)) return true;
  if (/请登录|立即登录|手机号登录|验证码登录|扫码登录|sign in|log in|login/.test(t)) {
    // 已登录首页偶尔也有「登录」字样，要求更强信号
    if (/密码|验证码|微信登录|短信登录|password|verification/.test(t)) return true;
    if (/\/login|\/signin/.test(u)) return true;
  }
  return false;
}

export { ATTR as WB_REF_ATTR };
