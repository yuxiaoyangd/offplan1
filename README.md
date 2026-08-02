# 在线休息申请协同系统 MVP

基于 `Next.js + Supabase + Vercel` 的最小可运行版本，核心目标是：

- 员工在手机浏览器中自主选择每周休息日
- 每天名额可限制，满额后不可继续申请
- 支持单小队和多小队分别配置排休名额
- 多人同时在线，提交后全员页面实时同步
- 最后一个名额由数据库函数原子控制，避免并发超卖

## 1. 本地启动

1. 安装依赖
2. 复制 `.env.local.example` 为 `.env.local`
3. 填入你的 Supabase 环境变量
4. 在 Supabase SQL Editor 执行 `supabase/schema.sql`
5. 运行开发环境

> `supabase/schema.sql` 会删除现有排班表并按最新结构重建，执行前请确认不需要保留旧数据。

```bash
npm install
npm run dev
```

## 2. 环境变量

```env
NEXT_PUBLIC_SUPABASE_URL=https://wwsndhuaxyswjkfancem.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=你的 publishable key
CLOUD_RUN_XLS_EXPORT_URL=https://xls-export-890180627519.asia-east1.run.app
CLOUD_RUN_XLS_EXPORT_KEY=可选，启用 Cloud Run 共享密钥后填写
```

## 3. 页面说明

- `/` 员工页面
- `/admin` 管理员页面
- 员工校验姓名后，可选择“随机排休”或“指定排休”。
- 随机排休会收集整周统一出勤时段，但不占用具体日期名额，随后由管理员从剩余名额中安排休息日。
- 指定排休一次选择整周统一出勤时段和一个排休日期。
- 管理员可筛选“随机待安排”和“未选择待安排”人员进行批量分配。
- 管理员可使用“自动补全排班”按小队剩余名额补齐排休，并用默认时段补足每天缺少的出勤时段；已有选择不会被覆盖。

## 4. 数据导入

- “骑手时段意愿文档”为必选文件。
- “骑手小队数据”为可选文件；未上传时，所有骑手进入默认小队。
- 上传小队数据时，两份文档的骑手 ID 和姓名必须完全一致，否则禁止导入。
- 系统根据小队文件中的“分组ID”和“分组名称”自动创建小队。
- 每个小队拥有独立的每日排休名额。
- 导入时会把当周原始 Excel 保存到 Supabase Storage，供兼容导出使用。
- 已有数据库请先在 Supabase SQL Editor 执行 `supabase/xls_export_migration.sql`。

## 5. 当前 MVP 约束

- 暂未接入正式登录，员工通过输入姓名操作
- 默认规则为工作日 5 人、周末 2 人，管理员可逐天覆盖
- 每位员工每周仅允许 1 个休息日
- 随机排休由员工确认后不可改为指定排休

## 6. 部署

直接推送到 GitHub 后导入 Vercel，配置同样的环境变量即可。导出时会优先调用 Cloud Run 生成可直接上传排班系统的文件；服务不可用时自动使用原有导出方式。
