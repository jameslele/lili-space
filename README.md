# 理哩的个人空间

「理哩的个人空间」是一个私人博客 / 个人档案项目，用来长期保存文章、照片、阅读、旅行、生活记录和旧博客内容。项目气质是安静、文艺、私人、可长期回看，不是 SaaS、营销站、技术博客模板或内容社区。

当前前台视觉方向为杂志目录感，参考 `design-demos/frontend-direction-2.html`。

## 技术栈

- Astro
- React Islands
- Tailwind CSS
- Supabase Postgres
- Supabase Storage
- custom `users` / `sessions` auth
- Milkdown Crepe
- Markdown 正文存储
- EdgeOne Pages adapter

项目不使用 Supabase Auth，也不依赖 `auth.users`。

## 目录结构

- `src/pages`：前台、后台和 API 路由
- `src/components`：前台组件和后台 React islands
- `src/layouts`：前台 / 后台布局
- `src/lib`：auth、content、admin、settings、Supabase helper
- `src/styles`：全局样式
- `supabase`：Supabase 配置和数据库迁移
- `docs_new`：V2 设计文档和上线收口文档
- `migration-reports`：旧博客与媒体迁移报告
- `design-demos`：视觉方向参考
- `lilisong`：旧博客源项目，仅作迁移参考

## 本地开发

```bash
npm install
npm run dev
```

本地开发默认使用 `.env`。不要提交真实 `.env`。

## 环境变量

从 `.env.example` 复制一份本地 `.env`，再填入真实值。

运行时服务端变量：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_PUBLIC_BUCKET`
- `SUPABASE_STORAGE_PRIVATE_BUCKET`

浏览器端变量：

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

脚本 / CLI 变量：

- `SUPABASE_DB_PASSWORD`

安全边界：

- `SUPABASE_SERVICE_ROLE_KEY` 只允许服务端使用。
- 不要把真实 key 写入 README、文档或仓库。
- `private-media` 不能改成公开 bucket。

## 常用命令

```bash
npm run dev
npm run check
npm test
npm run build
npm run preview
npm run verify:supabase
```

说明：当前使用 `@edgeone/astro`，`npm run preview` 会调用 `astro preview`，该 adapter 不支持 Astro preview。正式部署前可以先用 Astro 本地开发服务验证功能；如需按 EdgeOne 运行时本地联调，请安装 EdgeOne CLI 后使用：

```bash
edgeone makers dev
```

## Supabase 准备

数据库：

- 迁移文件位于 `supabase/migrations`
- 初始 schema 包含 `users`、`sessions`、`posts`、`categories`、`tags`、`post_tags`、`media_assets`、`site_settings`
- 所有后台写操作必须经过服务端管理员校验

Storage buckets：

- `public-media`：公开读取，用于公开图片、音频、视频
- `private-media`：必须保持私有，只通过服务端 signed URL 给管理员查看

校验 Supabase 基础状态：

```bash
npm run verify:supabase
```

## 部署

当前项目准备使用腾讯云 EdgeOne Pages 部署。

EdgeOne Pages 设置：

- Framework Preset：Astro
- Build Command：`npm run build`
- Output Directory：保持默认
- 环境变量：按 `.env.example` 在 EdgeOne Pages 项目设置中配置
- Node.js 版本：使用 Node.js 22.x（`@edgeone/astro` 当前声明要求 Node 22）

部署后先验证：

- 首页、登录页、后台首页可访问
- 访客只能看到公开已发布文章
- 普通用户不能进入后台
- 管理员能进入后台
- `public-media` 正常展示
- `private-media` 仅管理员授权视图可见

## 初始管理员

迁移 seed 中保留了初始化管理员约定：`root / 1212`。

生产上线前必须修改默认管理员密码，或创建新的强密码管理员后停用默认账号。

## 已知构建提示

`npm run build` 可能出现 Vite chunk size warning。当前主要来源是后台文章编辑器 `PostEditor` / Milkdown Crepe，不影响前台公开页面加载，也不阻塞上线。

## 相关文档

- `docs_new/管理员使用说明.md`
- `docs_new/已知限制与后续建议.md`
- `docs_new/备份与恢复建议.md`
- `docs_new/上线前QA清单.md`
