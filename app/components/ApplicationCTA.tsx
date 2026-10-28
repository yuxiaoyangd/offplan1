"use client";

import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import pageStyles from "../page.module.css";
import styles from "./ApplicationCTA.module.css";

type ContactMethod = "email" | "phone";
const ApplicationContext = createContext<(() => void) | null>(null);

function useOpenApplication() {
  const openApplication = useContext(ApplicationContext);
  if (!openApplication) throw new Error("ApplicationProvider is required");
  return openApplication;
}

function TeamSketch() {
  return (
    <svg className={styles.sketch} viewBox="0 0 160 132" fill="none" aria-hidden="true">
      <path d="M112 21c17-15 30 0 21 12m10-4 5-5m-1 16 7 1" stroke="#172425" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M26 105V81c0-24 46-24 46 0v24H26Z" fill="#ffb331" stroke="#172425" strokeWidth="2.5" />
      <ellipse cx="49" cy="48" rx="20" ry="23" fill="#f8f7f3" stroke="#172425" strokeWidth="2.5" />
      <path d="M42 46v3m14-3v3m-14 8q7 8 14 0" stroke="#172425" strokeWidth="2.5" strokeLinecap="round" />
      <g transform="rotate(9 99 88)"><rect x="70" y="58" width="62" height="61" rx="10" fill="#f8f7f3" stroke="#172425" strokeWidth="2.5" /><path d="M83 74h34m-34 12h34m-34 12h21" stroke="#172425" strokeWidth="2" strokeLinecap="round" /><circle cx="122" cy="110" r="15" fill="#d9ef83" stroke="#172425" strokeWidth="2.5" /><path d="m116 109 4 4 8-9" stroke="#172425" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></g>
      <path d="M14 116h127" stroke="#172425" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ApplicationProvider({ children }: { children: ReactNode }) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingRef = useRef(false);
  const successRef = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactMethod, setContactMethod] = useState<ContactMethod>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [open]);

  useEffect(() => {
    if (submitted) successRef.current?.focus();
  }, [submitted]);

  function openApplication() {
    setCompanySize("");
    setContactName("");
    setContactMethod("email");
    setEmail("");
    setPhone("");
    setErrorMessage("");
    setSubmitted(false);
    setOpen(true);
  }

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    pendingRef.current = true;
    setSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/system-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          companySize: Number(companySize),
          contactName,
          contactMethod,
          contactValue: contactMethod === "email" ? email : phone,
        }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message || "申请提交失败，请稍后重试");
      setSubmitted(true);
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message.startsWith("申请") ? error.message : "网络暂不可用，请稍后重试");
    } finally {
      pendingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <ApplicationContext.Provider value={openApplication}>
      {children}
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={`${id}-dialog-title`}
        onCancel={event => {
          if (pendingRef.current) event.preventDefault();
          else setOpen(false);
        }}
        onClose={() => setOpen(false)}
        onClick={event => {
          if (event.target === event.currentTarget && !pendingRef.current) setOpen(false);
        }}
      >
        <div className={styles.dialogCard}>
          <button className={styles.closeButton} type="button" aria-label="关闭申请窗口" disabled={submitting} onClick={() => setOpen(false)}>×</button>
          {submitted ? (
            <div className={styles.success} role="status">
              <span className={styles.successMark} aria-hidden="true">✓</span>
              <h2 id={`${id}-dialog-title`} ref={successRef} tabIndex={-1}>申请已提交</h2>
              <p>我们会通过你留下的联系方式与你联系。</p>
              <button className={styles.submitButton} type="button" onClick={() => setOpen(false)}>完成</button>
            </div>
          ) : (
            <>
              <h2 id={`${id}-dialog-title`} className={styles.dialogTitle}>申请专属排休系统</h2>
              <p className={styles.dialogIntro}>填写团队规模与联系方式，我们会与你联系。</p>
              <form className={styles.form} onSubmit={event => void submitApplication(event)} aria-busy={submitting}>
                <label className={styles.field} htmlFor={`${id}-company-size`}>
                  <span>公司人数</span>
                  <input id={`${id}-company-size`} type="number" inputMode="numeric" min={1} max={1000000} step={1} required autoFocus value={companySize} onChange={event => setCompanySize(event.target.value)} placeholder="例如 100" />
                </label>

                <label className={styles.field} htmlFor={`${id}-contact-name`}>
                  <span>如何称呼</span>
                  <input id={`${id}-contact-name`} type="text" autoComplete="name" maxLength={40} required value={contactName} onChange={event => setContactName(event.target.value)} placeholder="请输入称呼" />
                </label>

                <fieldset className={styles.methods}>
                  <legend>联系方式</legend>
                  <div className={styles.methodChoices}>
                    <label><input type="radio" name="contact-method" checked={contactMethod === "email"} onChange={() => setContactMethod("email")} /><span>邮箱</span></label>
                    <label><input type="radio" name="contact-method" checked={contactMethod === "phone"} onChange={() => setContactMethod("phone")} /><span>电话</span></label>
                  </div>
                </fieldset>

                <label className={styles.field} htmlFor={`${id}-contact-value`}>
                  <span>{contactMethod === "email" ? "联系邮箱" : "联系电话"}</span>
                  <input
                    key={contactMethod}
                    id={`${id}-contact-value`}
                    type={contactMethod === "email" ? "email" : "tel"}
                    inputMode={contactMethod === "email" ? "email" : "tel"}
                    autoComplete={contactMethod === "email" ? "email" : "tel"}
                    maxLength={contactMethod === "email" ? 254 : 30}
                    required
                    value={contactMethod === "email" ? email : phone}
                    onChange={event => contactMethod === "email" ? setEmail(event.target.value) : setPhone(event.target.value)}
                    placeholder={contactMethod === "email" ? "name@company.com" : "请输入电话号码"}
                  />
                </label>

                <p className={styles.privacyNote}>联系方式仅用于跟进这次申请。</p>
                {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
                <button className={styles.submitButton} type="submit" disabled={submitting}>{submitting ? "提交中…" : "提交申请"}</button>
              </form>
            </>
          )}
        </div>
      </dialog>
    </ApplicationContext.Provider>
  );
}

export function HeaderApplicationButton() {
  const openApplication = useOpenApplication();
  return <button className={pageStyles.headerApplyButton} type="button" onClick={openApplication}>免费申请</button>;
}

export default function ApplicationCTA() {
  const id = useId();
  const openApplication = useOpenApplication();
  return (
    <section className={styles.apply} aria-labelledby={`${id}-apply-title`}>
      <div className={styles.copy}>
        <TeamSketch />
        <div>
          <h2 id={`${id}-apply-title`}>申请专属排休系统</h2>
          <p>给团队一份清晰的安排，给自己一点轻松。</p>
        </div>
      </div>
      <button className={styles.applyButton} type="button" onClick={openApplication}>免费申请</button>
    </section>
  );
}
