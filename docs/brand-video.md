# 首页品牌视频

首页组件：`app/components/BrandVideo.tsx`，样式为同目录 `BrandVideo.module.css`。

首页布局使用 `app/page.tsx` 与 `app/page.module.css`：顶部显示 offplan 文字品牌与“免费申请”入口，接视频与流程演示；底部“申请专属排休系统”也通过“免费申请”按钮打开同一申请弹窗。原首页工作台、时钟、问候、反馈入口、日历及视频上方介绍文案均已移除。样式限于首页组件，不改动其他页面或全局样式。

申请弹窗使用 `app/components/ApplicationCTA.tsx` 与同目录 `ApplicationCTA.module.css`。用户填写公司人数和“如何称呼”，并选择邮箱或电话作为联系方式；客户端和 `app/api/system-applications/route.ts` 服务端均校验输入。成功提交后显示确认状态。申请写入独立的 `public.system_applications`，不会占用骑手反馈表。现有数据库需先执行非破坏性的 `supabase/system_applications_migration.sql`；`supabase/schema.sql` 已同步新表定义，仅供全量重建使用，不要用它给现有数据库迁移。

流程演示使用 `app/components/WorkflowShowcase.tsx` 与同目录 `WorkflowShowcase.module.css`，以 SVG 和 CSS 动画表现名单导入、员工打开链接选择日期和上班时段、导出并展开排班表。三项纯文字选项位于动画容器上方，无前置图标；当前选项以浅色背景逐渐填充表示进度。默认每 6.8 秒切换一次，点击可切换并重播，支持方向键、Home、End。无暂停轮播按钮，鼠标悬停和键盘聚焦不会停止轮播。离开视口或切换浏览器标签后暂停，重新进入时继续播放。

视频品牌统一使用纯文字 offplan，不带 Logo 或前置图标。

- 视频：`public/videos/offplan-brand.mp4`，18 秒，1280×720，30 FPS，H.264 / AAC，约 2 MB，已启用 faststart。
- 封面：`public/videos/offplan-poster.jpg`，1280×720。
- 默认预加载并静音自动循环。点击声音按钮后从片头有声播放；支持手动暂停。离开视口或切换标签页时暂停，返回后恢复；用户主动暂停后不会自动恢复。
- 视频加载失败时显示文案与直接打开链接。

Remotion 复用已有工程：`C:/Users/luanj/Desktop/code-animation/code-animation/src/animations/offplan/`，独立入口 `index.tsx`，单个 Composition `OffplanBrand`。

制作记录、1080p 成片、完整预览、原创配乐与音效分轨：`C:/Users/luanj/Videos/remotion/out/offplan-brand/`。

在既有 Remotion 工程运行：

```powershell
python scripts/offplan-audio.py
node scripts/offplan-render.cjs preview
node scripts/offplan-render.cjs final
python scripts/offplan-review.py
```

`timeline.json` 同时驱动画面与音效。音乐为原创程序合成的 120 BPM 电子节拍，无旁白，无第三方音乐采样。重新渲染后，将压缩 MP4 和封面复制到网站对应 public 路径。
