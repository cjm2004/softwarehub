<script setup>
import { onMounted, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import { AlertTriangle, Clock3, Download, HardDrive, Monitor } from "@lucide/vue";

const route = useRoute();
const software = ref(null);
const loading = ref(true);
const error = ref("");
const maintenanceLabel = { MAINTAINED: "长期维护", BETA: "内测版", LIMITED: "有限维护", DEPRECATED: "停止维护", RISK: "风险提示" };
onMounted(async () => {
  try {
    const response = await fetch(`/api/admin/software/${route.params.id}/preview`);
    if (!response.ok) throw new Error("PREVIEW_FAILED");
    software.value = await response.json();
  } catch {
    error.value = "预览不可用：请从已登录的管理后台打开。";
  } finally {
    loading.value = false;
  }
});
</script>
<template>
  <div v-if="loading" class="container state-panel page-state">正在加载草稿预览...</div>
  <div v-else-if="!software" class="container state-panel page-state">{{ error }}</div>
  <template v-else>
    <section class="detail-head"><div class="container detail-head-inner"><div class="detail-icon"><img v-if="software.cover_image" :src="software.cover_image" :alt="software.name"/><span v-else>{{ software.name.slice(0,1) }}</span></div><div class="detail-title"><p class="eyebrow">仅管理员可见的草稿预览</p><h1>{{ software.name }}</h1><p>{{ software.summary }}</p><div class="detail-tags"><span v-for="platform in software.platforms" :key="platform"><Monitor :size="14"/>{{platform}}</span></div><p v-if="software.maintenance_status !== 'MAINTAINED'" class="maintenance-banner"><AlertTriangle :size="16"/><strong>{{maintenanceLabel[software.maintenance_status]}}</strong><span>{{software.maintenance_note}}</span></p></div><RouterLink to="/admin" class="secondary-button"><Download :size="16"/>返回后台</RouterLink></div></section>
    <section class="container detail-layout"><article class="article-content"><h2>软件介绍</h2><p>{{software.description}}</p><div v-if="software.screenshots?.length" class="screenshot-grid"><img v-for="src in software.screenshots" :key="src" :src="src" alt="截图"/></div><h2>安装与使用</h2><p>{{software.tutorial||'暂无使用教程。'}}</p><h2>更新日志</h2><p>{{software.changelog||'暂无更新日志。'}}</p></article><aside class="info-panel"><h2>预览信息</h2><dl><div><dt>版本</dt><dd>{{software.version}}</dd></div><div><dt>大小</dt><dd><HardDrive :size="15"/>{{software.file_size}}</dd></div><div><dt>更新时间</dt><dd><Clock3 :size="15"/>{{software.updated_at?.slice(0,10)}}</dd></div></dl></aside></section>
  </template>
</template>
