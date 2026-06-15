# 理哩的个人空间

一个私人博客 / 个人档案项目，使用 Astro + React Islands + Tailwind CSS + Supabase Postgres / Storage。

## 技术栈

- Astro
- React Islands
- Tailwind CSS
- Supabase Postgres
- Supabase Storage
- 自建账号密码鉴权
- `users + sessions`
- Milkdown Crepe
- Markdown 作为正文 source of truth

## 部署方式

当前项目使用 `@astrojs/vercel`，`output: "server"`。

- 推荐部署方式：Vercel
- 适合：Git 集成、预览部署、自动生产部署
- 不建议改成静态站点部署，因为项目依赖 SSR、session 和后台权限校验

## 必需环境变量

运行时：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_PUBLIC_BUCKET`，默认 `public-media`
- `SUPABASE_STORAGE_PRIVATE_BUCKET`，默认 `private-media`

前台浏览器代码读取：

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

仅迁移 / 校验脚本使用：

- `SUPABASE_DB_PASSWORD`

说明：

- `service_role` 只允许服务端使用。
- `private-media` 只应通过服务端生成 signed URL。
- 不要把真实 `.env` 提交到仓库。

## 本地启动

```bash
npm install
npm run dev
```

## 构建与预览

```bash
npm run check
npm test
npm run build
```

Vercel 本地预览请使用：

```bash
npx vercel dev
```

> 说明：`@astrojs/vercel` 不支持 `astro preview`，本地生产预览请走 `vercel dev`。

## Supabase 生产准备

1. 创建或确认 Supabase 项目。
2. 配置 `public-media` 和 `private-media` buckets。
3. 确认 `public-media` 可公开读取。
4. 确认 `private-media` 保持非公开。
5. 运行 `supabase/migrations` 下的迁移。
6. 确认 RLS 已启用。
7. 确认后台写操作只通过服务端 service role 执行。

## 数据库迁移

项目的 schema 与 seed 以 `supabase/migrations` 为准。

如果要在本地 Supabase 里核对生产准备，可以执行仓库内的校验脚本：

```bash
npm run verify:supabase
```

迁移脚本：

- `npm run migrate:lilisong`
- `npm run migrate:lilisong-media`
- `npm run gallery:feature`

## Storage 准备

- `public-media`
  - 公开读取
  - 前台直接展示
- `private-media`
  - 保持私有
  - 只允许服务端生成 signed URL

不要把 `private-media` 改成公开 bucket。

## 初始管理员

仓库当前的初始化约定里保留了 `root / 1212`。

上线前建议：

- 首次登录后立即修改管理员密码
- 如果已经是生产库，优先替换为强密码或创建新管理员后停用默认账号

## Vercel 部署步骤

1. 把代码推到 GitHub / GitLab / Bitbucket。
2. 在 Vercel 里导入仓库。
3. Vercel 会自动识别 Astro 和 `@astrojs/vercel`。
4. 构建命令保持默认 `npm run build`。
5. 输出目录保持默认，不要手工改成静态导出。
6. 在 Vercel 项目设置里填入环境变量。
7. 部署后先打开首页、登录页、后台首页做 smoke test。

## 上线前检查清单

- `npm run check`
- `npm test`
- `npm run build`
- `npx vercel dev`
- 访客只能访问公开已发布文章
- 普通用户不能进入 `/admin`
- 管理员可进入后台并看到私密 / 草稿 / 归档标识
- `public-media` 正常显示
- `private-media` 仅管理员授权视图可见
- 没有真实密钥进入仓库

## 目录

- `src/`：当前项目代码
- `supabase/`：数据库迁移与配置
- `docs_new/`：V2 设计文档
- `lilisong/`：旧博客源项目，仅作迁移参考
