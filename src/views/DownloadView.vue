<script setup>
import { ref, onMounted } from "vue";
import { useRoute, RouterLink } from "vue-router";
import { Download, ExternalLink, Check, ShieldCheck, ArrowLeft } from "@lucide/vue";

const route = useRoute();
const software = ref(null);
const loading = ref(true);
const pageError = ref("");
const error = ref("");
const copied = ref(0);
const pending = ref(0);
const site = ref({});

onMounted(async () => {
  try {
    const [r, siteResponse] = await Promise.all([fetch(`/api/public/software/${encodeURIComponent(route.params.slug)}`), fetch("/api/public/site")]);
    site.value = siteResponse.ok ? await siteResponse.json() : {};
    if (!r.ok) {
      pageError.value = r.status === 404 ? "软件不存在或已下架" : "下载信息加载失败，请稍后重试";
      return;
    }
    software.value = await r.json();
  } catch {
    pageError.value = "网络连接失败，请检查服务状态后重试";
  } finally {
    loading.value = false;
  }
});

async function startDownload(link) {
  error.value = "";
  pending.value = link.id;
  try {
    const r = await fetch(`/api/public/download/${link.id}/ticket`, { method: "POST" });
    const data = await r.json();
    if (r.status === 402) return error.value = "该资源需要购买，支付模块将在商户参数配置后开放。";
    if (!r.ok) return error.value = "下载通道暂不可用，请稍后重试。";
    if (data.extractCode) {
      await navigator.clipboard.writeText(data.extractCode).catch(() => {});
      copied.value = link.id;
    }
    location.href = data.url;
  } catch {
    error.value = "网络连接失败，请稍后重试。";
  } finally {
    pending.value = 0;
  }
}
</script>

<template>
  <div v-if="loading" class="container state-panel page-state">正在加载下载信息...</div>
  <div v-else-if="!software" class="container state-panel page-state">{{ pageError || '软件不存在或已下架' }}</div>
  <section v-else class="container download-page">
    <RouterLink :to="`/soft/${software.slug}`" class="back-link"><ArrowLeft :size="17" />返回软件详情</RouterLink>
    <div class="download-summary">
      <div class="detail-icon small"><img v-if="software.cover_image" :src="software.cover_image" :alt="`${software.name} Logo`" /><span v-else>{{ software.name.slice(0, 1) }}</span></div>
      <div><p class="eyebrow">下载中间页</p><h1>{{ software.name }}</h1><p>{{ software.version }} · {{ software.file_size }}</p></div>
      <span class="safe-label"><ShieldCheck :size="17" />通道已由站点维护</span>
    </div>
    <div class="download-content">
      <article>
        <h2>选择下载通道</h2>
        <p class="muted">点击后由服务器签发短时票据，再跳转至对应下载地址。</p>
        <div v-if="error" class="error-banner">{{ error }}</div>
        <div class="channel-list">
          <div v-for="link in software.channels" :key="link.id" class="channel-row">
            <div class="channel-icon"><Download :size="21" /></div>
            <div class="channel-info"><strong>{{ link.name }}</strong><span>{{ link.channel_type }}</span></div>
            <span v-if="copied === link.id" class="code-button"><Check :size="15" />提取码已复制</span>
            <button class="primary-button" :disabled="pending === link.id" @click="startDownload(link)">{{ pending === link.id ? '正在准备...' : '前往下载' }}<ExternalLink :size="16" /></button>
          </div>
        </div>
      </article>
      <aside class="download-note"><h2>下载说明</h2><p>{{ software.download_note || software.tutorial || site.default_download_note || '请选择适合的下载通道，点击后将由服务器签发短时下载票据。' }}</p><p>{{ site.download_disclaimer || '请核对文件来源和数字签名。网盘提取码仅用于当前资源，不要向陌生人提供账户信息。' }}</p></aside>
    </div>
  </section>
</template>
