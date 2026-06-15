import { createServiceRoleSupabaseClient } from "./supabase/server";

export const siteSettingDefaults = {
  site_title: "理哩的个人空间",
  site_subtitle: "私人博客目录",
  site_description: "以文字、照片和时间整理个人空间。",
  header_left_label: "私人博客目录",
  header_center_label: "文字 / 照片 / 归档",
  header_right_label: "管理员前台视图",
  home_eyebrow: "Personal Archive",
  home_title: "理哩的个人空间",
  home_description: "一些生活切片，一些远方的风，一些慢慢长大的自己。",
  footer_left_text: "以文字、照片和时间整理个人空间。",
  footer_right_text: "长期回看，安静留存。",
  footer_copyright: "© 2026 理哩的个人空间",
  post_copyright_notice: "本文著作权归作者 songlili 所有，转载或引用请联系作者获得授权。",
  about_intro: "这里记录一些生活、阅读、旅行与慢慢长大的痕迹。",
  about_site_note: "这个空间不是为了被快速浏览，而是为了在多年后仍然可以回看。",
} as const;

export type SiteSettingKey = keyof typeof siteSettingDefaults;
export type SiteSettings = Record<SiteSettingKey, string>;

export const siteSettingGroups: Array<{
  title: string;
  description: string;
  fields: Array<{ key: SiteSettingKey; label: string; multiline?: boolean }>;
}> = [
  {
    title: "站点基础信息",
    description: "用于浏览器标题、站点主标题和整体描述。",
    fields: [
      { key: "site_title", label: "站点标题" },
      { key: "site_subtitle", label: "站点副标题" },
      { key: "site_description", label: "站点描述", multiline: true },
    ],
  },
  {
    title: "首页文案",
    description: "首页开场和默认介绍文字。",
    fields: [
      { key: "home_eyebrow", label: "首页小标题" },
      { key: "home_title", label: "首页标题" },
      { key: "home_description", label: "首页描述", multiline: true },
    ],
  },
  {
    title: "顶部信息条",
    description: "导航下方三段短文字。",
    fields: [
      { key: "header_left_label", label: "左侧文字" },
      { key: "header_center_label", label: "中间文字" },
      { key: "header_right_label", label: "右侧管理员文字" },
    ],
  },
  {
    title: "页脚文案",
    description: "页面底部的长期说明。",
    fields: [
      { key: "footer_left_text", label: "左侧文字" },
      { key: "footer_right_text", label: "右侧文字" },
      { key: "footer_copyright", label: "版权文字" },
    ],
  },
  {
    title: "文章页文案",
    description: "文章正文结束后的统一说明。",
    fields: [
      { key: "post_copyright_notice", label: "文章版权说明", multiline: true },
    ],
  },
  {
    title: "关于页面",
    description: "关于页两段核心介绍。",
    fields: [
      { key: "about_intro", label: "关于理哩", multiline: true },
      { key: "about_site_note", label: "关于网站", multiline: true },
    ],
  },
];

const siteSettingKeys = Object.keys(siteSettingDefaults) as SiteSettingKey[];
const siteSettingsCacheTtlMs = 30_000;

let cachedSiteSettings: { expiresAt: number; value: SiteSettings } | null = null;
let pendingSiteSettingsLoad: Promise<SiteSettings> | null = null;

export async function getSiteSettingsWithDefaults(): Promise<SiteSettings> {
  const now = Date.now();
  if (cachedSiteSettings && cachedSiteSettings.expiresAt > now) {
    return { ...cachedSiteSettings.value };
  }

  if (pendingSiteSettingsLoad) {
    return pendingSiteSettingsLoad.then((settings) => ({ ...settings }));
  }

  pendingSiteSettingsLoad = loadSiteSettingsWithDefaults();
  try {
    const settings = await pendingSiteSettingsLoad;
    cachedSiteSettings = {
      expiresAt: Date.now() + siteSettingsCacheTtlMs,
      value: settings,
    };
    return { ...settings };
  } finally {
    pendingSiteSettingsLoad = null;
  }
}

async function loadSiteSettingsWithDefaults(): Promise<SiteSettings> {
  try {
    const { data, error } = await createServiceRoleSupabaseClient()
      .from("site_settings")
      .select("key, value")
      .in("key", siteSettingKeys);
    if (error) throw error;

    return (data ?? []).reduce<SiteSettings>((settings, row) => {
      if (isSiteSettingKey(row.key)) {
        settings[row.key] = normalizeSettingValue(row.value, siteSettingDefaults[row.key]);
      }
      return settings;
    }, { ...siteSettingDefaults });
  } catch (error) {
    console.warn("Failed to load site settings, using defaults.", error);
    return { ...siteSettingDefaults };
  }
}

export async function saveSiteSettings(input: Partial<Record<SiteSettingKey, string>>) {
  const rows = siteSettingKeys.map((key) => ({
    key,
    value: normalizeInputValue(input[key], siteSettingDefaults[key]),
  }));

  const { error } = await createServiceRoleSupabaseClient()
    .from("site_settings")
    .upsert(rows, { onConflict: "key" });
  if (error) throw error;

  cachedSiteSettings = null;
  pendingSiteSettingsLoad = null;
}

export function readSiteSettingsFromFormData(formData: FormData): Partial<Record<SiteSettingKey, string>> {
  return siteSettingKeys.reduce<Partial<Record<SiteSettingKey, string>>>((settings, key) => {
    settings[key] = String(formData.get(key) ?? "");
    return settings;
  }, {});
}

export function isSiteSettingKey(value: string): value is SiteSettingKey {
  return siteSettingKeys.includes(value as SiteSettingKey);
}

function normalizeSettingValue(value: unknown, fallback: string) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  return fallback;
}

function normalizeInputValue(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed || fallback;
}
