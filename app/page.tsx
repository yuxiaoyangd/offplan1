import type { Metadata } from "next";
import ApplicationCTA, { ApplicationProvider, HeaderApplicationButton } from "./components/ApplicationCTA";
import BrandVideo from "./components/BrandVideo";
import CopyEmail from "./components/CopyEmail";
import WorkflowShowcase from "./components/WorkflowShowcase";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "offplan｜员工排休与团队排班工具",
  description: "offplan 是面向团队的在线排休与排班工具：一键导入员工名单，员工通过链接自主选择上班时段和休息日期，完成后导出排班表。申请专属排休系统。",
  keywords: ["offplan", "员工排休", "团队排班", "在线排班", "排休系统", "排班工具", "员工自主排休", "排班表导出"],
  openGraph: {
    title: "offplan｜员工排休与团队排班工具",
    description: "一键导入员工名单，员工自主选择排休，完成后导出排班表。用 offplan 管理团队排休。",
    siteName: "offplan",
    locale: "zh_CN",
    type: "website",
  },
};

export default function HomePage() {
  return (
    <main className={styles.page}>
      <ApplicationProvider>
        <div className={styles.shell}>
          <header className={styles.header}>
            <h1 className={styles.wordmark}>offplan</h1>
            <HeaderApplicationButton />
          </header>

          <div className={styles.content}>
            <BrandVideo />
            <div className={styles.contentSection}>
              <WorkflowShowcase />
            </div>
            <div className={styles.contentSection}>
              <ApplicationCTA />
            </div>
          </div>

          <footer className={styles.footer}>
            <div className={styles.footerBrand}>
              <span>offplan</span>
              <span>简单安排，从容工作。</span>
            </div>
            <CopyEmail />
          </footer>
        </div>
      </ApplicationProvider>
    </main>
  );
}
