"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Loading from "./loading";

const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
const INITIAL_DATE = new Date(2000, 0, 1, 0, 0, 0);

export default function HomePage() {
  const [today, setToday] = useState(() => INITIAL_DATE);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setToday(new Date());
    setReady(true);
    const timer = window.setInterval(() => setToday(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!ready) return <Loading />;

  const month = today.getMonth();
  const date = today.getDate();
  const firstDay = new Date(today.getFullYear(), month, 1).getDay();
  const daysInMonth = new Date(today.getFullYear(), month + 1, 0).getDate();
  const calendarDays = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];

  return (
    <main className="homepage-intro">
      <div className="homepage-workspace">
        <header className="homepage-header">
          <div className="homepage-brand">
            <span className="homepage-brand-dot" />
            <span>工作台</span>
          </div>
          <div className="homepage-clock" aria-label="实时时间">
            <strong>{today.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</strong>
          </div>
        </header>

        <section className="homepage-hero" aria-label="今日问候">
          <div className="homepage-hero-copy">
            <p className="homepage-kicker">{today.getHours() < 12 ? "早上好" : today.getHours() < 18 ? "下午好" : "晚上好"}</p>
            <h1>今天的工作怎么样？</h1>
            <p className="homepage-description">先看看今天的安排，再出发。愿你一路顺利，平安收工。</p>
            <Link className="homepage-feedback-link" href="/feedback">
              <span className="homepage-feedback-icon">☺</span>
              <span><strong>满意度反馈</strong><small>可匿名对站点工作做建议或投诉</small></span>
              <span className="homepage-feedback-arrow">›</span>
            </Link>
          </div>
        </section>

        <section className="homepage-calendar" aria-label="实时日历">
          <div className="homepage-calendar-heading">
            <div><p>实时日历</p><h2>{today.getFullYear()}年 {month + 1}月</h2></div>
            <span className="homepage-today-label">今天 {month + 1}/{date}</span>
          </div>
          <div className="homepage-calendar-grid">
            {weekDays.map((day) => <span className="homepage-weekday" key={day}>{day}</span>)}
            {calendarDays.map((day, index) => (
              <span className={`homepage-calendar-day${day === date ? " is-today" : ""}`} key={`${day ?? "empty"}-${index}`}>{day}</span>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
