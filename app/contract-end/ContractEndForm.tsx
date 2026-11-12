"use client";

import { FormEvent, useState } from "react";
import type { ContractEndReasonOption } from "@/lib/contract-end";
import styles from "./ContractEndForm.module.css";

const BLESSINGS = [
  "祝你接下来一切顺利。",
  "愿新的旅程顺心如意。",
  "祝你前程顺利，平安喜乐。",
  "愿你每天都有好心情。",
  "祝你未来的日子越来越好。",
];

type Props = {
  formId: string;
  title: string;
  description?: string | null;
  reasons: ContractEndReasonOption[];
};

export default function ContractEndForm({ formId, title, description, reasons }: Props) {
  const [stage, setStage] = useState<"name" | "questions" | "success">("name");
  const [riderName, setRiderName] = useState("");
  const [satisfaction, setSatisfaction] = useState(0);
  const [reasonIds, setReasonIds] = useState<string[]>([]);
  const [otherDetails, setOtherDetails] = useState("");
  const [blessing, setBlessing] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const otherSelected = reasons.some((item) => item.label === "其他原因" && reasonIds.includes(item.id));

  function enterForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = riderName.trim();
    if (!name || name.length > 40) {
      setErrorMessage("请填写姓名");
      return;
    }
    setRiderName(name);
    setErrorMessage("");
    setStage("questions");
  }

  function toggleReason(id: string) {
    setReasonIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setErrorMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!satisfaction || reasonIds.length === 0) {
      setErrorMessage("请选择满意度和断签原因");
      return;
    }
    if (otherSelected && !otherDetails.trim()) {
      setErrorMessage("请说明其他原因");
      return;
    }
    setSubmitting(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/contract-end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formId,
          riderName,
          satisfaction,
          reasonIds,
          details: otherSelected ? otherDetails.trim() : "",
        }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "提交失败，请稍后重试");
      setBlessing(BLESSINGS[Math.floor(Math.random() * BLESSINGS.length)]);
      setStage("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`${styles.shell} ${stage === "questions" ? styles.questionsShell : styles.centeredShell}`}>
      {stage === "name" ? (
        <form className={styles.card} onSubmit={enterForm}>
          <div className={styles.entryHeading}>
            <h1>{title}</h1>
            <p>{description || "请填写姓名后继续"}</p>
          </div>
          <h2>填写姓名</h2>
          <input className={styles.nameInput} aria-label="姓名" value={riderName} onChange={(event) => setRiderName(event.target.value)} maxLength={40} placeholder="请输入姓名" autoComplete="name" autoFocus />
          {errorMessage ? <p className={styles.error} role="alert">{errorMessage}</p> : null}
          <button className={styles.primaryButton} type="submit">下一步</button>
        </form>
      ) : null}

      {stage === "questions" ? (
        <form className={`${styles.card} ${styles.questionsCard}`} onSubmit={(event) => void submit(event)}>
          <fieldset className={styles.fieldset}>
            <legend>整体满意度 <b>*</b></legend>
            <div className={styles.ratingOptions}>
              {[1, 2, 3, 4, 5].map((score) => (
                <label className={styles.ratingOption} key={score}>
                  <input type="radio" name="satisfaction" value={score} checked={satisfaction === score} onChange={() => setSatisfaction(score)} />
                  <span>{score}</span>
                </label>
              ))}
            </div>
            <div className={styles.ratingHints}><span>很不满意</span><span>非常满意</span></div>
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend>断签原因 <b>*</b></legend>
            <div className={styles.reasonOptions}>
              {reasons.map((item) => (
                <label className={styles.reasonOption} key={item.id}>
                  <input type="checkbox" name="reasons" value={item.id} checked={reasonIds.includes(item.id)} onChange={() => toggleReason(item.id)} />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {otherSelected ? (
            <label className={styles.otherField}>
              <span>请说明其他原因 <b>*</b></span>
              <textarea value={otherDetails} onChange={(event) => setOtherDetails(event.target.value)} maxLength={1000} rows={4} placeholder="请输入具体原因" />
            </label>
          ) : null}
          {errorMessage ? <p className={`${styles.error} ${styles.questionError}`} role="alert">{errorMessage}</p> : null}
          <button className={`${styles.primaryButton} ${styles.fixedSubmit}`} type="submit" disabled={submitting}>{submitting ? "提交中…" : "提交断签"}</button>
        </form>
      ) : null}

      {stage === "success" ? (
        <section className={`${styles.card} ${styles.success}`}>
          <div className={styles.successMark}>✓</div>
          <h2>提交成功</h2>
          <p>{blessing}</p>
        </section>
      ) : null}
    </div>
  );
}
