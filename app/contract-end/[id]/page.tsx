"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { validContractEndReasons, type ContractEndFormRow } from "@/lib/contract-end";
import ContractEndForm from "../ContractEndForm";
import styles from "../ContractEndForm.module.css";

export default function ContractEndPage() {
  const params = useParams();
  const formId = params.id as string;
  const [form, setForm] = useState<ContractEndFormRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;
    async function loadForm() {
      setLoading(true);
      const { data, error } = await supabase
        .from("contract_end_forms")
        .select("id,title,description,reasons,is_open,created_at")
        .eq("id", formId)
        .maybeSingle();
      if (!active) return;
      setForm(data && validContractEndReasons(data.reasons) ? data as ContractEndFormRow : null);
      setErrorMessage(error || (data && !validContractEndReasons(data.reasons)) ? "表单暂时无法加载，请稍后重试" : data ? "" : "表单不存在");
      setLoading(false);
    }
    void loadForm();
    return () => { active = false; };
  }, [formId]);

  return (
    <main className={styles.page}>
      {loading ? <div className={styles.statusCard}>表单加载中…</div> : null}
      {!loading && errorMessage ? <div className={styles.statusCard}>{errorMessage}</div> : null}
      {!loading && form && !form.is_open ? (
        <div className={styles.statusCard}>
          <h1>{form.title}</h1>
          <p>此表单已关闭收集，暂时无法提交。</p>
        </div>
      ) : null}
      {!loading && form?.is_open ? <ContractEndForm formId={form.id} title={form.title} description={form.description} reasons={form.reasons} /> : null}
    </main>
  );
}
