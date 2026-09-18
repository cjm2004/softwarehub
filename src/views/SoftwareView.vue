<script setup>
import { ref, onMounted } from "vue";
import { useRoute, RouterLink } from "vue-router";
import { Download, HardDrive, Clock3, Monitor, Smartphone, Apple, Globe2, AlertTriangle, ChevronRight } from "@lucide/vue";

const route = useRoute();
const software = ref(null);
const loading = ref(true);
const error = ref("");
const site = ref({});
const maintenanceLabel = { MAINTAINED: "长期维护", BETA: "内测版", LIMITED: "有限维护", DEPRECATED: "停止维护", RISK: "风险提示" };
const platformIcon = platform => platform === "Android" || platform === "HarmonyOS" ? Smartphone : platform === "macOS" || platform === "iOS" ? Apple : platform === "Web" ? Globe2 : Monitor;
async function downloadVersion(link) {
  try {
    const response = await fetch(`/api/public/version-download/${link.id}/ticket`, { method: "POST" });
    if (!response.ok) throw new Error("DOWNLOAD_FAILED");
    const ticket = await response.json();
    location.href = ticket.url;
  } catch {
    error.value = "历史版本下载链接暂时不可用";
  }
}

function upsertMeta(property, content) {
  if (!content) return;
  let tag = document.head.querySelector(`meta[property="${property}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("property", property);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function applySeo(item) {
  const title = item.seo_title || `${item.name} 下载 - 软件仓库`;
  const description = item.seo_description || item.summary || "软件资源下载、版本与安装说明";
  document.title = title;
  let descriptionTag = document.head.querySelector('meta[name="description"]');
  if (!descriptionTag) {
    descriptionTag = document.createElement("meta");
    descriptionTag.name = "description";
    document.head.appendChild(descriptionTag);
  }
  descriptionTag.content = description;
  upsertMeta("og:title", item.og_title || title);
  upsertMeta("og:description", item.og_description || description);
  upsertMeta("og:image", item.og_image || item.cover_image || "");
  upsertMeta("og:type", "website");
}

onMounted(async () => {
  try {
    const [softwareResponse, siteResponse] = await Promise.all([
      fetch(`/api/public/software/${encodeURIComponent(route.params.slug)}`),
      fetch("/api/public/site")
    ]);
    if (!softwareResponse.ok) {
      error.value = softwareResponse.status === 404 ? "软件不存在或已下架" : "软件信息加载失败，请稍后重试";
      return;
    }
    const data = await softwareResponse.json();
    software.value = {
      ...data,
      platforms: Array.isArray(data.platforms) ? data.platforms : [],
      screenshots: Array.isArray(data.screenshots) ? data.screenshots : []
    };
    site.value = siteResponse.ok ? await siteResponse.json() : {};
    applySeo(software.value);
  } catch {
    error.value = "网络连接失败，请检查服务状态后重试";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-if="loading" class="container state-panel page-state">正在加载...</div>
  <div v-else-if="!software" class="container state-panel page-state">{{ error || '软件不存在或已下架' }}</div>
  <template v-else>
    <section class="detail-head">
      <div class="container detail-head-inner">
        <div class="detail-icon"><img v-if="software.cover_image" :src="software.cover_image" :alt="`${software.name} Logo`" /><span v-else>{{ software.name.slice(0, 1) }}</span></div>
        <div class="detail-title">
          <div class="breadcrumbs"><RouterLink to="/">软件</RouterLink><ChevronRight :size="14" /><span>{{ software.category_name }}</span></div>
          <h1>{{ software.name }}</h1>
          <p>{{ software.summary }}</p>
          <div class="detail-tags"><span v-for="p in software.platforms" :key="p"><component :is="platformIcon(p)" :size="14" />{{ p }}</span></div>
          <p v-if="software.maintenance_status && software.maintenance_status !== 'MAINTAINED'" class="maintenance-banner"><AlertTriangle :size="16" /><strong>{{ maintenanceLabel[software.maintenance_status] || software.maintenance_status }}</strong><span>{{ software.maintenance_note || '请在下载和使用前确认兼容性与安全性。' }}</span></p>
        </div>
        <RouterLink class="primary-button download-cta" :to="`/download/${software.slug}`"><Download :size="18" />立即下载</RouterLink>
      </div>
    </section>
    <section class="container detail-layout">
      <article class="article-content">
        <h2>软件介绍</h2><p>{{ software.description }}</p>
        <div v-if="software.screenshots.length" class="screenshot-grid"><img v-for="src in software.screenshots" :key="src" :src="src" :alt="`${software.name} 截图`" /></div>
        <h2>安装与使用</h2><p>{{ software.tutorial || '暂无使用教程。' }}</p>
        <h2>更新日志</h2><p>{{ software.changelog || '暂无更新日志。' }}</p>
        <section v-if="software.versions?.length" class="version-history"><h2>历史版本</h2><article v-for="version in software.versions" :key="version.id"><div><strong>{{ version.version }}</strong><span>{{ version.file_size || '大小未知' }} · {{ version.created_at?.slice(0, 10) }}</span><p>{{ version.changelog || '暂无版本说明。' }}</p></div><div class="version-actions"><button v-for="link in version.channels" :key="link.id" class="secondary-button" @click="downloadVersion(link)">{{ link.name }}<Download :size="15" /></button></div></article></section>
      </article>
      <aside class="info-panel">
        <h2>软件信息</h2>
        <dl><div><dt>版本</dt><dd>{{ software.version }}</dd></div><div><dt>大小</dt><dd><HardDrive :size="15" />{{ software.file_size }}</dd></div><div><dt>更新</dt><dd><Clock3 :size="15" />{{ software.updated_at ? software.updated_at.slice(0, 10) : '未知' }}</dd></div><div><dt>许可</dt><dd>{{ software.charge_type === 'PAID' ? `¥${(software.price_cents / 100).toFixed(2)}` : '免费' }}</dd></div></dl>
        <section v-if="site.donation_wechat || site.donation_alipay" class="donation-panel"><h3>支持本站</h3><p>资源对你有帮助时，可自愿赞助维护。</p><div><figure v-if="site.donation_wechat"><img :src="site.donation_wechat" alt="微信赞助二维码" /><figcaption>微信</figcaption></figure><figure v-if="site.donation_alipay"><img :src="site.donation_alipay" alt="支付宝赞助二维码" /><figcaption>支付宝</figcaption></figure></div></section>
      </aside>
    </section>
  </template>
</template>
