import Link from "next/link";
import styles from "./ContractEndEntry.module.css";

export default function ContractEndEntry() {
  return (
    <Link className={styles.link} href="/admin/contract-end" aria-label="进入断签统计（新功能）">
      进入断签统计
      <span className={styles.badge} aria-hidden="true">NEW</span>
    </Link>
  );
}
