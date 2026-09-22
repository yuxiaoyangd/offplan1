-- 排班周提交成功页是否显示“骑手投诉或建议”入口
alter table public.schedule_weeks
  add column if not exists show_feedback_entry boolean not null default false;
