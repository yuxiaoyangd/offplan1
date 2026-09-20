"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";

export default function FeedbackPage() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfirmOpen(true);
  }

  async function submitFeedback() {
    const form = formRef.current;
    if (!form) return;
    setSubmitting(true);
    setConfirmOpen(false);
    setErrorMessage("");
    const formData = new FormData(form);

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incomeSatisfaction: formData.get("income-satisfaction"),
          managementSatisfaction: formData.get("management-satisfaction"),
          otherFeedback: formData.get("other-feedback"),
          riderName: formData.get("rider-name"),
        }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "提交失败，请稍后重试");
      setSubmitted(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="feedback-page">
      <div className="feedback-shell">
        <div className="feedback-topbar">
          <Link className="feedback-back" href="/">‹ 返回首页</Link>
          <h1>满意度反馈</h1>
        </div>
        {submitted ? (
          <section className="feedback-success">
            <h2>感谢你的反馈</h2>
            <p>我们已经收到你的建议，会认真查看并持续改进。</p>
            <Link className="feedback-primary-button" href="/">返回首页</Link>
          </section>
        ) : (
          <form ref={formRef} className="feedback-form" onSubmit={handleSubmit}>
            <fieldset className="feedback-rating-group">
              <legend>收益满意度</legend>
              <div className="feedback-rating-options">
                {[1, 2, 3, 4, 5].map((score) => (
                  <label key={score} className="feedback-rating-option">
                    <input type="radio" name="income-satisfaction" value={score} defaultChecked={score === 3} />
                    <span>{score}</span>
                  </label>
                ))}
              </div>
              <div className="feedback-rating-hints"><span>不满意</span><span>非常满意</span></div>
            </fieldset>
            <fieldset className="feedback-rating-group">
              <legend>管理满意度</legend>
              <div className="feedback-rating-options">
                {[1, 2, 3, 4, 5].map((score) => (
                  <label key={score} className="feedback-rating-option">
                    <input type="radio" name="management-satisfaction" value={score} defaultChecked={score === 3} />
                    <span>{score}</span>
                  </label>
                ))}
              </div>
              <div className="feedback-rating-hints"><span>不满意</span><span>非常满意</span></div>
            </fieldset>
            <label><span>其他反馈 <em>可选</em></span><textarea name="other-feedback" placeholder="在签约、管理过程或者有其他需要投诉、建议的内容" rows={5} /></label>
            <label><span>是否留下你的姓名 <em>可选</em></span><input className="feedback-name-input" name="rider-name" type="text" placeholder="请输入姓名" /></label>
            <p className="feedback-privacy-note">不填写姓名的情况下，你的反馈信息是完全保密的，不会透露任何个人的信息。</p>
            {errorMessage ? <p className="feedback-error" role="alert">{errorMessage}</p> : null}
            <button className="feedback-primary-button" type="submit" disabled={submitting}>{submitting ? "提交中…" : "提交反馈"}</button>
          </form>
        )}
        {confirmOpen ? (
          <div className="feedback-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="feedback-confirm-title">
            <div className="feedback-confirm-card">
              <h2 id="feedback-confirm-title">确定提交</h2>
              <div className="feedback-confirm-actions">
                <button className="feedback-confirm-cancel" type="button" onClick={() => setConfirmOpen(false)}>返回修改</button>
                <button className="feedback-primary-button" type="button" onClick={() => void submitFeedback()}>确认提交</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
