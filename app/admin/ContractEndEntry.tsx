import Link from "next/link";
import styles from "./ContractEndEntry.module.css";

export default function ContractEndEntry() {
  return <Link className={styles.link} href="/admin/contract-end">进入断签统计</Link>;
}
