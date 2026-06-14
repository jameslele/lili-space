import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { insert } from "@milkdown/utils";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AdminCategory, AdminMediaAsset, AdminPost, AdminTag } from "../../lib/admin";

type EditorPost = Partial<AdminPost> & {
  id?: string;
  excerpt?: string | null;
  markdown?: string;
  cover_url?: string | null;
};

type PostEditorSubmitEvent = {
  nativeEvent: Event;
  preventDefault: () => void;
};

interface Props {
  post?: EditorPost | null;
  categories: AdminCategory[];
  tags: AdminTag[];
  mediaAssets?: AdminMediaAsset[];
  defaultCategoryId?: string | null;
  error?: string | null;
  success?: string | null;
}

const successCopy: Record<string, string> = {
  saved: "草稿已保存。",
  published: "文章已发布。",
  archived: "文章已归档。",
};

export default function PostEditor({ post, categories, tags, mediaAssets = [], defaultCategoryId, error, success }: Props) {
  const editorRootRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const markdownInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const coverAssetInputRef = useRef<HTMLInputElement>(null);
  const categoryCreateButtonRef = useRef<HTMLButtonElement>(null);
  const [markdown, setMarkdown] = useState(post?.markdown ?? "");
  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [visibility, setVisibility] = useState(post?.visibility ?? "public");
  const [coverUrl, setCoverUrl] = useState(post?.cover_url ?? "");
  const [coverAssetId, setCoverAssetId] = useState(post?.cover_asset_id ?? "");
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>(() => post?.tags?.map((tag) => tag.name) ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "submitting">("idle");
  const [uploadState, setUploadState] = useState("");
  const [coverState, setCoverState] = useState("");
  const [insertState, setInsertState] = useState("");
  const [loadingMessage, setLoadingMessage] = useState("");
  const [availableMedia, setAvailableMedia] = useState(mediaAssets);

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

  function appendMarkdownImage(asset: AdminMediaAsset) {
    const imageMarkdown = `![${escapeMarkdownAlt(asset.alt || asset.file_name)}](${asset.public_url})`;

    if (crepeRef.current) {
      crepeRef.current.editor.action(insert(imageMarkdown));
      const nextMarkdown = crepeRef.current.getMarkdown();
      setMarkdown(nextMarkdown);
      if (markdownInputRef.current) markdownInputRef.current.value = nextMarkdown;
      setInsertState("图片已插入编辑区，保存后会进入文章内容。");
      setSaveState("dirty");
      return;
    }

    const nextMarkdown = `${markdown.trimEnd()}\n\n${imageMarkdown}\n`;
    setMarkdown(nextMarkdown);
    if (markdownInputRef.current) markdownInputRef.current.value = nextMarkdown;
    setInsertState("图片已追加到正文末尾，保存后会进入文章内容。");
    setSaveState("dirty");
  }

  function selectCover(asset: AdminMediaAsset) {
    setCoverUrl(asset.public_url);
    setCoverAssetId(asset.id);
    if (coverInputRef.current) coverInputRef.current.value = asset.public_url;
    if (coverAssetInputRef.current) coverAssetInputRef.current.value = asset.id;
    setCoverState(`已设为封面：${asset.file_name}`);
    setSaveState("dirty");
  }

  async function uploadImage(file: File, purpose: "cover" | "body") {
    const formData = new FormData();
    formData.set("intent", "upload");
    formData.set("file", file);
    formData.set("visibility", visibility);
    formData.set("post_id", post?.id ?? "");
    formData.set("alt", file.name.replace(/\.[^.]+$/, ""));
    formData.set("featured", "false");
    setUploadState("上传中...");
    setLoadingMessage(purpose === "cover" ? "正在上传封面..." : "正在上传图片...");

    try {
      const response = await fetch("/admin/media/action", {
        method: "POST",
        body: formData,
        headers: {
          accept: "application/json",
          "x-requested-with": "fetch",
        },
      });
      const result = await response.json() as { asset?: AdminMediaAsset; error?: string };
      if (!response.ok || !result.asset) {
        setUploadState(result.error || "上传失败");
        return;
      }

      setAvailableMedia((items) => [result.asset!, ...items]);
      if (purpose === "cover") selectCover(result.asset);
      if (purpose === "body") appendMarkdownImage(result.asset);
      setUploadState("上传成功。");
    } finally {
      setLoadingMessage("");
    }
  }

  function handleSubmit(event: PostEditorSubmitEvent) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value === "publish" && title.trim().length === 0) {
      event.preventDefault();
      setSaveState("idle");
      window.alert("发布前需要填写标题。");
      return;
    }

    setLoadingMessage(submitter?.value === "publish" ? "正在发布..." : submitter?.value === "archive" ? "正在归档..." : "正在保存...");
    syncMarkdown();
  }

  function addTag(name: string) {
    const normalized = name.trim();
    if (!normalized || selectedTagNames.includes(normalized)) return;
    setSelectedTagNames([...selectedTagNames, normalized]);
    setTagDraft("");
    setSaveState("dirty");
  }

  function removeTag(name: string) {
    setSelectedTagNames(selectedTagNames.filter((item) => item !== name));
    setSaveState("dirty");
  }

  return (
    <form className="space-y-5" method="post" action="/admin/posts/action" onSubmit={handleSubmit}>
      {loadingMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#f7f5f1]/70 backdrop-blur-sm" role="status" aria-live="assertive" aria-label={loadingMessage}>
          <div className="flex min-w-48 flex-col items-center gap-4 border border-[var(--color-line)] bg-white px-8 py-7 text-center shadow-sm">
            <span className="h-9 w-9 animate-spin rounded-full border-2 border-[var(--color-line)] border-t-[var(--color-ink)]" aria-hidden="true" />
            <span className="text-sm font-medium text-[var(--color-ink)]">{loadingMessage}</span>
          </div>
        </div>
      )}
      <input type="hidden" name="id" value={post?.id ?? ""} />
      <input ref={markdownInputRef} type="hidden" name="markdown" value={markdown} readOnly />
      <input type="hidden" name="tag_names" value={JSON.stringify(selectedTagNames)} readOnly />

      <div className="sticky top-0 z-20 -mx-5 border-b border-[var(--color-line)] bg-[#f7f5f1]/95 px-5 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-muted)]">
            <a className="min-h-10 border border-[var(--color-line)] bg-white px-3 py-2 transition hover:-translate-y-0.5 hover:text-[var(--color-ink)] active:translate-y-0" href="/admin/posts" onClick={() => setLoadingMessage("正在返回文章列表...")}>返回文章</a>
            {post?.slug && <a className="min-h-10 border border-[var(--color-line)] bg-white px-3 py-2 transition hover:-translate-y-0.5 hover:text-[var(--color-ink)] active:translate-y-0" href={`/posts/${post.slug}`} onClick={() => setLoadingMessage("正在打开前台文章...")}>前台查看</a>}
            <span aria-live="polite">{saveState === "dirty" ? "未保存" : saveState === "submitting" ? "保存中" : "已加载"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="min-h-10 border border-[var(--color-line)] bg-white px-4 text-sm font-medium transition hover:-translate-y-0.5 active:translate-y-0" type="submit" name="intent" value="draft">保存草稿</button>
            <button className="min-h-10 border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 active:translate-y-0" type="submit" name="intent" value="publish">
              {isPublished ? "更新发布" : "发布"}
            </button>
            {post?.id && !isArchived && (
              <button className="min-h-10 border border-[var(--color-line)] bg-[#f8f4ec] px-4 text-sm font-medium text-[var(--color-muted)] transition hover:-translate-y-0.5 active:translate-y-0" type="submit" name="intent" value="archive">归档</button>
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
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className="min-h-11 flex-1 border border-[var(--color-line)] px-3"
                    name="new_category_name"
                    placeholder="填写后保存为主分类"
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                    }}
                  />
                  <button ref={categoryCreateButtonRef} className="min-h-11 border border-[var(--color-line)] bg-white px-4 text-sm font-medium transition hover:-translate-y-0.5 active:translate-y-0" type="submit" name="intent" value="draft">
                    新建并保存
                  </button>
                </div>
              </label>
              <label className="grid gap-1">
                <span className="font-medium">封面 URL</span>
                <input ref={coverInputRef} className="min-h-10 border border-[var(--color-line)] px-3" name="cover_url" value={coverUrl} onChange={(event) => {
                  setCoverUrl(event.target.value);
                  setCoverAssetId("");
                  setSaveState("dirty");
                }} placeholder="https://..." />
              </label>
              <input ref={coverAssetInputRef} type="hidden" name="cover_asset_id" value={coverAssetId} readOnly />
              <label className="grid gap-1">
                <span className="font-medium">可见性</span>
                <select className="min-h-10 border border-[var(--color-line)] bg-white px-3" name="visibility" value={visibility} onChange={(event) => {
                  setVisibility(event.target.value as "public" | "private");
                  setSaveState("dirty");
                }}>
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
            <h2 className="font-serif-title text-xl font-semibold">媒体</h2>
            {coverState && <p className="mt-3 border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" aria-live="polite">{coverState}</p>}
            <div className="mt-4 grid gap-3 text-sm">
              <label className="grid gap-1">
                <span className="font-medium">上传为封面</span>
                <input className="min-h-10 border border-[var(--color-line)] bg-white px-3 py-2" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadImage(file, "cover");
                  event.currentTarget.value = "";
                }} />
              </label>
              <label className="grid gap-1">
                <span className="font-medium">上传并插入正文</span>
                <input className="min-h-10 border border-[var(--color-line)] bg-white px-3 py-2" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadImage(file, "body");
                  event.currentTarget.value = "";
                }} />
              </label>
              {uploadState && <p className="text-sm text-[var(--color-muted)]" aria-live="polite">{uploadState}</p>}
              {insertState && <p className="border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800" aria-live="polite">{insertState}</p>}
            </div>
            <div className="mt-5 max-h-72 space-y-3 overflow-auto">
              {availableMedia.length > 0 ? availableMedia.map((asset) => (
                <article className="grid grid-cols-[72px_1fr] gap-3 border border-[var(--color-line)] bg-[#fdfbf7] p-2" key={asset.id}>
                  <img className="h-16 w-16 object-cover" src={asset.display_url || asset.public_url} alt={asset.alt || asset.file_name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{asset.file_name}</p>
                    <p className="text-xs text-[var(--color-muted)]">{asset.bucket === "private-media" ? "仅自己可见" : "公开"}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button className="min-h-8 border border-[var(--color-line)] bg-white px-2 text-xs transition hover:-translate-y-0.5 hover:border-[var(--color-ink)] active:translate-y-0" type="button" onClick={() => selectCover(asset)}>设为封面</button>
                      <button className="min-h-8 border border-[var(--color-line)] bg-white px-2 text-xs transition hover:-translate-y-0.5 hover:border-[var(--color-ink)] active:translate-y-0" type="button" onClick={() => appendMarkdownImage(asset)}>插入正文</button>
                    </div>
                  </div>
                </article>
              )) : <p className="text-sm text-[var(--color-muted)]">还没有可选择的图片。</p>}
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
              }}
              placeholder="输入新标签后点添加"
            />
            <button className="mt-2 min-h-10 border border-[var(--color-line)] bg-white px-3 text-sm font-medium transition hover:-translate-y-0.5 active:translate-y-0" type="button" onClick={() => addTag(tagDraft)}>
              添加标签
            </button>
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

function escapeMarkdownAlt(value: string) {
  return value.replace(/[[\]]/g, "");
}

function toDateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
