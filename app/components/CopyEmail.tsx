"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../page.module.css";

const email = "jianjieluan@163.com";

export default function CopyEmail() {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  async function handleCopy() {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(email);
        copied = true;
      }
    } catch {
      // 某些浏览器不允许直接访问剪贴板，继续使用兼容方式。
    }

    if (!copied) {
      const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const input = document.createElement("textarea");
      input.value = email;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      try {
        input.select();
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      } finally {
        input.remove();
        previousFocus?.focus();
      }
    }

    setStatus(copied ? "copied" : "failed");
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), 2200);
  }

  return (
    <button className={styles.contactButton} type="button" onClick={() => void handleCopy()}>
      <span>联系我们：{email}</span>
      <span className={styles.contactToast} role="status">{status === "copied" ? "已复制" : status === "failed" ? "复制失败" : ""}</span>
    </button>
  );
}
