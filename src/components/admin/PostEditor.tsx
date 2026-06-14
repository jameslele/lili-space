import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AdminCategory, AdminPost, AdminTag } from "../../lib/admin";

type EditorPost = Partial<AdminPost> & {
  id?: string;
  excerpt?: string | null;
  markdown?: string;
  cover_url?: string | null;
};

interface Props {
  post?: EditorPost | null;
  categories: AdminCategory[];
  tags: AdminTag[];
  defaultCategoryId?: string | null;
  error?: string | null;
  success?: string | null;
}

const successCopy: Record<string, string> = {
  saved: "草稿已保存。",
  published: "文章已发布。",
  archived: "文章已归档。",
};

export default function PostEditor({ post, categories, tags, defaultCategoryId, error, success }: Props) {
  const editorRootRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const markdownInputRef = useRef<HTMLInputElement>(null);
  const [markdown, setMarkdown] = useState(post?.markdown ?? "");
  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>(() => post?.tags?.map((tag) => tag.name) ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "submitting">("idle");

  const existingTagNames = useMemo(() => tags.map((tag) => tag.name), [tags]);
  const categoryId = post?.category?.id ?? defaultCategoryId ?? "";
  const publishedAt = toDateTimeLocal(post?.published_at);
  const isPublished = post?.status === "published";
  const isArchived = post?.status === "archived";

  useEffect(() => {
    if (!editorRootRef.current || crepeRef.current) return;

    const crepe = new Crepe({
      root: editorRootRef.current,
      defaultValue: markdown || "\n",
      features: {
        [Crepe.Feature.Table]: false,
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.AI]: false,
      },
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_, nextMarkdown) => {
        setMarkdown(nextMarkdown);
        if (markdownInputRef.current) markdownInputRef.current.value = nextMarkdown;
        setSaveState("dirty");
      });
    });

    crepe.create();
    crepeRef.current = crepe;

    return () => {
      crepe.destroy();
      crepeRef.current = null;
    };
  }, []);

  function syncMarkdown() {
    const nextMarkdown = crepeRef.current?.getMarkdown() ?? markdown;
    setMarkdown(nextMarkdown);
    if (markdownInputRef.current) markdownInputRef.current.value = nextMarkdown;
    setSaveState("submitting");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value === "publish" && title.trim().length === 0) {
      event.preventDefault();
      setSaveState("idle");
      window.alert("发布前需要填写标题。");
      return;
    }

    syncMarkdown();
  }

  function addTag(name: string) {
    const normalized = name.trim();
    if (!normalized || selectedTagNames.includes(normalized)) return;
    setSelectedTagNames([...selectedTagNames, normalized]);
    setSaveState("dirty");
  }

  function removeTag(name: string) {
    setSelectedTagNames(selectedTagNames.filter((item) => item !== name));
    setSaveState("dirty");
  }

  return (
    <form className="space-y-5" method="post" action="/admin/posts/action" onSubmit={handleSubmit}>
      <input type="hidden" name="id" value={post?.id ?? ""} />
      <input ref={markdownInputRef} type="hidden" name="markdown" value={markdown} readOnly />
      <input type="hidden" name="tag_names" value={JSON.stringify(selectedTagNames)} readOnly />

      <div className="sticky top-0 z-20 -mx-5 border-b border-[var(--color-line)] bg-[#f7f5f1]/95 px-5 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-muted)]">
            <a className="min-h-10 border border-[var(--color-line)] bg-white px-3 py-2 hover:text-[var(--color-ink)]" href="/admin/posts">返回文章</a>
            {post?.slug && <a className="min-h-10 border border-[var(--color-line)] bg-white px-3 py-2 hover:text-[var(--color-ink)]" href={`/posts/${post.slug}`}>前台查看</a>}
            <span aria-live="polite">{saveState === "dirty" ? "未保存" : saveState === "submitting" ? "保存中" : "已加载"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="min-h-10 border border-[var(--color-line)] bg-white px-4 text-sm font-medium" type="submit" name="intent" value="draft">保存草稿</button>
            <button className="min-h-10 border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 text-sm font-medium text-white" type="submit" name="intent" value="publish">
              {isPublished ? "更新发布" : "发布"}
            </button>
            {post?.id && !isArchived && (
              <button className="min-h-10 border border-[var(--color-line)] bg-[#f8f4ec] px-4 text-sm font-medium text-[var(--color-muted)]" type="submit" name="intent" value="archive">归档</button>
            )}
          </div>
        </div>
      </div>

      {error && <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>}
      {success && successCopy[success] && <p className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{successCopy[success]}</p>}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <label className="block">
            <span className="sr-only">标题</span>
            <input
              className="font-serif-title w-full border-0 border-b border-[var(--color-line)] bg-transparent px-0 py-4 text-4xl font-semibold outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-ink)]"
              name="title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setSaveState("dirty");
              }}
              placeholder="写下标题"
            />
          </label>
          <div className="min-h-[620px] border border-[var(--color-line)] bg-white">
            <div ref={editorRootRef} className="lili-crepe min-h-[620px]" />
          </div>
        </div>

        <aside className="space-y-4">
          <section className="border border-[var(--color-line)] bg-white p-5">
            <h2 className="font-serif-title text-xl font-semibold">发布设置</h2>
            <div className="mt-4 grid gap-4 text-sm">
              <label className="grid gap-1">
                <span className="font-medium">URL 标识</span>
                <input className="min-h-10 border border-[var(--color-line)] px-3" name="slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="留空按标题生成" />
              </label>
              <label className="grid gap-1">
                <span className="font-medium">摘要</span>
                <textarea className="min-h-24 border border-[var(--color-line)] px-3 py-2" name="excerpt" defaultValue={post?.excerpt ?? ""} />
              </label>
              <label className="grid gap-1">
                <span className="font-medium">主分类</span>
                <select className="min-h-10 border border-[var(--color-line)] bg-white px-3" name="category_id" defaultValue={categoryId}>
                  <option value="">未分类</option>
                  {categories.map((category) => (
                    <option value={category.id} key={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="font-medium">新建分类</span>
                <input className="min-h-10 border border-[var(--color-line)] px-3" name="new_category_name" placeholder="填写后保存为主分类" />
              </label>
              <label className="grid gap-1">
                <span className="font-medium">封面 URL</span>
                <input className="min-h-10 border border-[var(--color-line)] px-3" name="cover_url" defaultValue={post?.cover_url ?? ""} placeholder="https://..." />
              </label>
              <label className="grid gap-1">
                <span className="font-medium">可见性</span>
                <select className="min-h-10 border border-[var(--color-line)] bg-white px-3" name="visibility" defaultValue={post?.visibility ?? "public"}>
                  <option value="public">公开</option>
                  <option value="private">仅自己可见</option>
                </select>
              </label>
              <label className="inline-flex min-h-11 items-center gap-2">
                <input name="show_on_home" type="checkbox" defaultChecked={!post?.noindex} />
                <span>显示在首页</span>
              </label>
              <label className="grid gap-1">
                <span className="font-medium">发布时间</span>
                <input className="min-h-10 border border-[var(--color-line)] px-3" name="published_at" type="datetime-local" defaultValue={publishedAt} />
              </label>
            </div>
          </section>

          <section className="border border-[var(--color-line)] bg-white p-5">
            <h2 className="font-serif-title text-xl font-semibold">标签</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {selectedTagNames.map((name) => (
                <button className="min-h-9 border border-[var(--color-line)] bg-[#f8f4ec] px-3 text-sm" key={name} type="button" onClick={() => removeTag(name)}>
                  {name} ×
                </button>
              ))}
            </div>
            <input
              className="mt-3 min-h-10 w-full border border-[var(--color-line)] px-3 text-sm"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addTag(tagDraft);
                setTagDraft("");
              }}
              placeholder="输入新标签后回车"
            />
            <div className="mt-4 flex max-h-48 flex-wrap gap-2 overflow-auto">
              {existingTagNames.map((name) => (
                <button
                  className={`min-h-9 border px-3 text-sm ${selectedTagNames.includes(name) ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white" : "border-[var(--color-line)] bg-white text-[var(--color-muted)]"}`}
                  key={name}
                  type="button"
                  onClick={() => selectedTagNames.includes(name) ? removeTag(name) : addTag(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </form>
  );
}

function toDateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
