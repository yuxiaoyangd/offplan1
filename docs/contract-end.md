# 断签统计表单

## 上线准备

在 Supabase SQL Editor 依次执行 `supabase/contract_end_migration.sql`、`supabase/contract_end_custom_reasons_migration.sql` 和 `supabase/contract_end_multiselect_migration.sql`。已经执行过的脚本无需重复执行。这些脚本不修改排班表。

完成后打开 `/admin`，通过“断签统计”入口进入独立管理页。新建表单带入六项默认原因，可以增删和编辑。表单默认关闭；开启后复制链接发给骑手。要编辑原因，先关闭收集。骑手可多选断签原因；选中“其他原因”时必须填写具体说明。

删除按钮始终可见。确认删除后，该表单和该批次全部提交记录会一并删除。

## 查看结果

点击任一表单卡片，卡片列表下方会显示该批次的提交数量、平均满意度、断签原因分布，以及每位骑手的姓名、评分、所选原因、其他原因说明和提交时间。再次点击同一张卡片会刷新结果。提交时看到的原因名称会随记录保存，后来编辑原因不改变历史记录。

结果页沿用当前后台的公开访问方式。提交记录也可在 Supabase SQL Editor 查看。

按表单汇总数量和平均满意度：

```sql
select f.title, f.is_open, count(s.id) as submission_count,
       round(avg(s.satisfaction)::numeric, 2) as average_satisfaction
from public.contract_end_forms f
left join public.contract_end_submissions s on s.form_id = f.id
group by f.id, f.title, f.is_open
order by f.created_at desc;
```

按原因统计：

```sql
select f.title, chosen.value->>'label' as reason_label, count(*) as selection_count
from public.contract_end_submissions s
join public.contract_end_forms f on f.id = s.form_id
cross join lateral jsonb_array_elements(s.selected_reasons) as chosen(value)
group by f.id, f.title, chosen.value->>'label'
order by f.title, selection_count desc;
```

当前后台管理与原排班功能一样，没有独立登录校验。断签提交记录已开放匿名读取，以支持在管理页直接查看。
