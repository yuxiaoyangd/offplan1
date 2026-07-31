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
```

## 3. 页面说明

- `/` 员工页面
- `/admin` 管理员页面

## 4. 数据导入

- “骑手时段意愿文档”为必选文件。
- “骑手小队数据”为可选文件；未上传时，所有骑手进入默认小队。
- 上传小队数据时，两份文档的骑手 ID 和姓名必须完全一致，否则禁止导入。
- 系统根据小队文件中的“分组ID”和“分组名称”自动创建小队。
- 每个小队拥有独立的每日排休名额。

## 5. 当前 MVP 约束

- 暂未接入正式登录，员工通过输入姓名操作
- 默认规则为工作日 5 人、周末 2 人，管理员可逐天覆盖
- 每位员工每周仅允许申请 1 个休息日，换日需先取消

## 6. 部署

直接推送到 GitHub 后导入 Vercel，配置同样的环境变量即可。
