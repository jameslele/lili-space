import { useMemo, useState } from "react";

type UploadVisibility = "public" | "private";
type UploadStatus = "idle" | "uploading" | "done" | "failed";

type UploadItem = {
  id: string;
  file: File;
  status: UploadStatus;
  error?: string;
};

const acceptedTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "video/mp4",
  "video/quicktime",
  "video/webm",
].join(",");

export default function MediaBatchUploader() {
  const [visibility, setVisibility] = useState<UploadVisibility>("public");
  const [featured, setFeatured] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [summary, setSummary] = useState("");
  const isUploading = items.some((item) => item.status === "uploading");
  const doneCount = items.filter((item) => item.status === "done").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const imageOnlyFeatured = useMemo(() => items.some((item) => !item.file.type.startsWith("image/")), [items]);

  function selectFiles(files: FileList | null) {
    const nextItems = Array.from(files ?? []).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      status: "idle" as UploadStatus,
    }));
    setItems(nextItems);
    setSummary(nextItems.length > 0 ? `已选择 ${nextItems.length} 个文件。` : "");
  }

  async function uploadOne(item: UploadItem) {
    updateItem(item.id, { status: "uploading", error: "" });
    const formData = new FormData();
    formData.set("intent", "upload");
    formData.set("file", item.file);
    formData.set("visibility", visibility);
    formData.set("alt", stripExtension(item.file.name));
    formData.set("featured", featured && item.file.type.startsWith("image/") ? "true" : "false");

    try {
      const response = await fetch("/admin/media/action", {
        method: "POST",
        body: formData,
        headers: {
          accept: "application/json",
          "x-requested-with": "fetch",
        },
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "上传失败");
      updateItem(item.id, { status: "done", error: "" });
    } catch (error) {
      updateItem(item.id, { status: "failed", error: error instanceof Error ? error.message : "上传失败" });
    }
  }

  async function uploadAll() {
    setSummary("正在上传...");
    for (const item of items) {
      if (item.status === "done") continue;
      await uploadOne(item);
    }
    setItems((current) => {
      const hasFailed = current.some((item) => item.status === "failed");
      const hasUploaded = current.some((item) => item.status === "done");
      if (hasUploaded && !hasFailed) {
        setSummary("上传完成，正在刷新列表...");
        window.setTimeout(() => window.location.reload(), 600);
      } else {
        setSummary("上传完成。失败项可以重试，成功项已写入媒体库。");
      }
      return current;
    });
  }

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  return (
    <section className="mb-6 border border-[var(--color-line)] bg-white p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-serif-title text-xl font-semibold">上传媒体</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">图片可批量上传；音频和视频不转码，单个文件不超过 50MB。</p>
        </div>
        {doneCount > 0 && (
          <button className="min-h-10 border border-[var(--color-line)] bg-white px-4 text-sm font-medium transition hover:bg-[#f8f4ec]" type="button" onClick={() => window.location.reload()}>
            刷新列表
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">文件</span>
          <input className="min-h-11 border border-[var(--color-line)] bg-white px-3 py-2" type="file" accept={acceptedTypes} multiple onChange={(event) => selectFiles(event.currentTarget.files)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">可见性</span>
          <select className="min-h-11 border border-[var(--color-line)] bg-white px-3" value={visibility} onChange={(event) => setVisibility(event.target.value as UploadVisibility)}>
            <option value="public">公开媒体</option>
            <option value="private">仅自己可见</option>
          </select>
        </label>
        <div className="flex items-end">
          <button className="min-h-11 border border-[var(--color-ink)] bg-[var(--color-ink)] px-5 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={items.length === 0 || isUploading} onClick={uploadAll}>
            {isUploading ? "上传中..." : "开始上传"}
          </button>
        </div>
      </div>

      <label className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} />
        <span>图片上传后加入照片页精选</span>
      </label>
      {featured && imageOnlyFeatured && <p className="text-sm text-[var(--color-muted)]">音频和视频不会加入照片页精选。</p>}

      {summary && <p className="mt-3 text-sm text-[var(--color-muted)]" aria-live="polite">{summary} 成功 {doneCount} 个，失败 {failedCount} 个。</p>}

      {items.length > 0 && (
        <div className="mt-4 divide-y divide-[var(--color-line)] border border-[var(--color-line)]">
          {items.map((item) => (
            <article className="grid gap-3 p-3 text-sm md:grid-cols-[minmax(0,1fr)_120px_auto]" key={item.id}>
              <div className="min-w-0">
                <p className="truncate font-medium">{item.file.name}</p>
                <p className="mt-1 text-xs text-[var(--color-muted)]">{item.file.type || "未知类型"} · {formatFileSize(item.file.size)}</p>
                {item.error && <p className="mt-1 text-xs text-red-700">{item.error}</p>}
              </div>
              <span className={statusClass(item.status)}>{statusText(item.status)}</span>
              <div className="flex items-center md:justify-end">
                {item.status === "failed" && (
                  <button className="min-h-9 border border-[var(--color-line)] bg-white px-3 text-xs font-medium transition hover:bg-[#f8f4ec]" type="button" onClick={() => void uploadOne(item)}>
                    重试
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function statusText(status: UploadStatus) {
  if (status === "uploading") return "上传中";
  if (status === "done") return "已上传";
  if (status === "failed") return "失败";
  return "等待";
}

function statusClass(status: UploadStatus) {
  const base = "inline-flex min-h-8 w-20 items-center justify-center border text-xs font-medium";
  if (status === "done") return `${base} border-emerald-200 bg-emerald-50 text-emerald-800`;
  if (status === "failed") return `${base} border-red-200 bg-red-50 text-red-800`;
  if (status === "uploading") return `${base} border-sky-200 bg-sky-50 text-sky-800`;
  return `${base} border-[var(--color-line)] bg-white text-[var(--color-muted)]`;
}

function stripExtension(name: string) {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
