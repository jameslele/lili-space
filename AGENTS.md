# AGENTS.md

## Project

「理哩的个人空间」是一个私人博客 / 个人档案项目，用于长期保存文章、照片、阅读、旅行、生活记录和旧博客内容。

项目目标不是做 SaaS、营销官网、技术博客模板或内容社区，而是做一个安静、文艺、长期可回看的个人空间。

核心气质：

- 温柔
- 文艺
- 安静
- 私人
- 有生活痕迹
- 长期回看
- 杂志目录感

前台视觉方向已经锁定为「杂志目录感」：

`design-demos/frontend-direction-2.html`

不要重新做视觉方向探索。不要把项目改成 SaaS landing page、科技官网、小红书模板或企业 CMS 风格。

---

## Tech Stack

当前技术栈：

- Astro
- React Islands
- Tailwind CSS
- Supabase Postgres
- Supabase Storage
- 自建账号密码鉴权
- `users + sessions`
- Milkdown Crepe
- Markdown 正文存储
- Supabase Storage buckets:
  - `public-media`
  - `private-media`

不要使用 Supabase Auth。

不要依赖 `auth.users`。

---

## Current State

以下阶段已完成：

1. 项目初始化与技术骨架
2. Supabase schema、seed、Storage buckets
3. 自建账号密码鉴权
4. 前台博客基础页面
5. `lilisong` 旧博客文章迁移
6. 媒体迁移到 Supabase Storage
7. 管理员前台透视逻辑与权限收口
8. 后台基础框架
9. Milkdown Crepe 文章编辑器与发布流程
10. 后台媒体上传与文章插入体验
11. 站点设置与前台文案配置
12. 媒体基础增强
13. 媒体高级增强
14. UI 精修、响应式与体验打磨

---

## Important Directories

主要目录：

- `/Users/a/lili-space`

重要文件 / 目录：

- `AGENTS.md`
- `package.json`
- `src/`
- `src/pages/`
- `src/components/`
- `src/layouts/`
- `src/lib/`
- `src/styles/`
- `docs_new/`
- `design-demos/`
- `migration-reports/`
- `supabase/`
- `lilisong/`

说明：

- `src/` 是当前新项目代码。
- `docs_new/` 是 V2 设计文档。
- `design-demos/frontend-direction-2.html` 是已选定视觉方向参考。
- `migration-reports/` 是 lilisong 迁移和媒体迁移报告。
- `lilisong/` 是旧博客源项目，只作为参考和迁移来源。

不要修改 `lilisong/`。

不要修改 `docs_new/`，除非用户明确要求更新设计文档。

不要修改迁移报告，除非当前任务明确要求读取或补充报告。

---

## Product Rules

### Content Model

文章是统一模型：

- `posts`

不再使用 Travel / Essays / Journal / Moments 作为固定内容类型。

文章通过以下方式组织：

- category
- tags
- archives
- visibility
- status

### Categories

分类是数据库管理的数据，不是写死常量。

`lilisong` 里的分类只是迁移后的初始数据。

规则：

- 一篇文章只有一个主分类。
- 分类用于表达文章所在栏目。
- 分类可以新增、编辑、隐藏。
- 分类不应轻易删除，尤其是已有文章关联时。
- 没有分类时默认使用「未分类」。

### Tags

标签是数据库管理的数据，不是写死常量。

规则：

- 一篇文章可以有多个标签。
- 标签用于表达关键词。
- 标签可以新增、编辑。
- 写文章时可以即时创建新标签。
- 标签为空也允许保存文章。

### Markdown

文章正文源数据是：

- `posts.markdown`

Markdown 是文章正文的 source of truth。

不要把私有富文本格式作为主数据。

不要在编辑器中加入正文颜色、字号、字体选择。

文章正文样式由前台 `MarkdownContent` 统一控制。

Markdown 渲染后会变成 HTML 标签，例如：

- `strong`
- `blockquote`
- `h1`
- `h2`
- `a`
- `code`
- `img`
- `audio`
- `video`

颜色、字号、字体由 CSS / Tailwind / MarkdownContent 控制，不写入 Markdown 内容本身。

---

## Auth Rules

项目不使用 Supabase Auth。

认证使用自建账号密码系统：

- `users`
- `sessions`

用户角色：

- `admin`
- `reader`

规则：

- 访客只能看公开且已发布文章。
- 普通用户 `reader` 只能看公开且已发布文章。
- 管理员 `admin` 可以进入后台。
- 管理员在前台可以看到全部文章，包括：
  - public
  - private
  - draft
  - archived
- 管理员看到非公开内容时应有状态标识。
- 普通用户不能进入 `/admin`。
- 未登录用户不能进入 `/admin`。
- 所有后台写操作必须服务端校验管理员权限。
- 不信任客户端提交的 `author_id`。
- 不暴露 service role key。

状态和可见性：

- `status`
  - `draft`
  - `published`
  - `archived`
- `visibility`
  - `public`
  - `private`

---

## Media Rules

Supabase Storage buckets:

- `public-media`
- `private-media`

规则：

- `public-media` 可以公开读取。
- `private-media` 必须保持非公开。
- 不要为了省事把 `private-media` 改公开。
- 私密媒体只能通过服务端 signed URL 给授权管理员查看。
- signed URL 不应写回数据库。
- `posts.markdown` 中不要保存临时 signed URL。
- 普通用户和访客不能获得 private-media signed URL。
- public/private bucket 规则不能破坏。

媒体能力已完成：

- 单图上传
- 批量图片上传
- 封面选择
- 正文图片插入
- 图片插入 Milkdown 当前光标位置
- Gallery 标记
- Gallery 排序
- 音频上传
- 视频上传
- 原生 audio/video 播放
- private-media signed URL 基础适配

不做：

- 音视频转码
- 视频封面抽帧
- 码率处理
- AI 图片处理
- 复杂企业 DAM

---

## Frontend Rules

前台核心页面：

- `/`
- `/posts/[slug]`
- `/categories`
- `/categories/[slug]`
- `/tags`
- `/tags/[slug]`
- `/archives`
- `/gallery`
- `/about`
- `/login`
- `/register`
- `/forbidden`

前台导航：

- 首页
- 分类
- 归档
- 照片
- 关于
- 登录 / 用户菜单
- 管理员登录后显示后台入口

前台视觉方向：

- `design-demos/frontend-direction-2.html`

关键词：

- 杂志目录感
- 封面图节奏
- 文章卡片
- 分类 / 归档结构
- 安静、文学、个人档案

不要：

- SaaS landing page
- 科技产品官网
- 小红书模板
- 企业后台风
- 过度卡片堆叠
- 紫蓝科技渐变

---

## Admin Rules

后台入口：

- `/admin`

后台页面：

- `/admin`
- `/admin/posts`
- `/admin/posts/new`
- `/admin/posts/[id]`
- `/admin/categories`
- `/admin/tags`
- `/admin/media`
- `/admin/gallery`
- `/admin/settings`
- `/admin/users`

后台风格：

- 安静
- 实用
- 清晰
- 轻量
- 不做数据大屏
- 不做复杂 CMS
- 不做营销页

后台只允许管理员访问。

普通用户访问后台应跳转或显示无权限。

---

## Settings Rules

站点设置来自：

- `site_settings`

设置用于管理前台基础文案。

典型配置：

- `site_title`
- `site_subtitle`
- `site_description`
- `header_left_label`
- `header_center_label`
- `header_right_label`
- `home_eyebrow`
- `home_title`
- `home_description`
- `footer_left_text`
- `footer_right_text`
- `footer_copyright`
- `about_intro`
- `about_site_note`

规则：

- Settings 内容按纯文本处理。
- 不直接渲染危险 HTML。
- 数据库为空时前台应使用默认值。
- Settings 读取失败不能导致前台白屏。
- Settings 保存必须管理员权限。

---

## Design Skills

已安装或可用设计相关 skills：

- `frontend-design`
- `ui-ux-pro-max`
- `huashu-design`
- `design-review`

建议用法：

- `huashu-design`：只用于高保真探索和原型，不要再用它推翻方向 2。
- `frontend-design`：用于生产 UI 落地和视觉一致性。
- `ui-ux-pro-max`：用于可用性、响应式、交互状态、表单体验检查。
- `design-review`：用于最后挑刺，找视觉、间距、层级、移动端问题。

当前项目视觉方向已定，不要重新做三套方向。

---

## Development Rules

编辑原则：

- 小步改动。
- 只改当前任务需要的文件。
- 不做无关重构。
- 不删除用户或其他智能体已有改动。
- 不修改 `lilisong/`。
- 不修改 `docs_new/`，除非用户明确要求。
- 不提交真实密钥。
- 不写真实 key 到 `.env.example`。
- 不把 Supabase service role key 暴露到客户端。
- 不破坏迁移数据。
- 如果创建 QA 测试数据，使用 `[QA]` 前缀，方便清理。

优先使用项目已有模式：

- 现有 auth helper
- 现有 Supabase helper
- 现有 admin query/action helper
- 现有 layout/components
- 现有 Tailwind token

不要引入重型 UI 框架。

不要为了小功能引入过重依赖。

---

## Verification

常规验证：

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test`

实际可用命令以 `package.json` 为准。

如果某个命令不存在，不要编造。请说明实际可用命令。

开发时建议启动 dev server 并浏览器验证关键路径。

重点验证身份：

- 未登录访客
- 普通用户 reader
- 管理员 admin

重点验证内容状态：

- public + published
- private + published
- draft
- archived
- noindex

重点验证媒体：

- public-media
- private-media
- signed URL
- 图片
- 音频
- 视频
- Gallery

---

