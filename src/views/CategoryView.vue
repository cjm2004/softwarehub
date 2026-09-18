<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { ArrowLeft, Clock3, Download, Monitor, Smartphone, Apple } from "@lucide/vue";

const route = useRoute();
const router = useRouter();
const categories = ref([]);
const software = ref([]);
const loading = ref(true);
const error = ref("");
const selectedPlatform = ref("");
const selectedSort = ref("updated");
const selectedTag = ref("");
const tags = ref([]);
const category = computed(() => categories.value.find(item => item.slug === route.params.slug));
const platformOptions = ["Windows", "macOS", "Android", "iOS", "Linux", "HarmonyOS", "Web", "ChromeOS", "飞牛 NAS"];
const platformIcon = platform => platform === "Android" || platform === "HarmonyOS" ? Smartphone : platform === "macOS" || platform === "iOS" ? Apple : Monitor;

function openSoftware(item, event) {
  if (event.target.closest("a,button,input,select,textarea,label")) return;
  router.push(`/soft/${item.slug}`);
}

function cardKeydown(item, event) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    router.push(`/soft/${item.slug}`);
  }
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [categoryResponse, softwareResponse, tagResponse] = await Promise.all([
      fetch("/api/public/categories"),
      fetch(`/api/public/software?${new URLSearchParams({ category: route.params.slug, platform: selectedPlatform.value, sort: selectedSort.value, tag: selectedTag.value })}`),
      fetch("/api/public/tags")
    ]);
    categories.value = categoryResponse.ok ? await categoryResponse.json() : [];
    tags.value = tagResponse.ok ? await tagResponse.json() : [];
    if (!category.value) {
      error.value = "该分类不存在或暂未启用";
      software.value = [];
      return;
    }
    if (!softwareResponse.ok) throw new Error("LOAD_FAILED");
    software.value = await softwareResponse.json();
  } catch {
    error.value = "分类资源加载失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}

watch(() => route.params.slug, load);
watch([selectedPlatform, selectedSort, selectedTag], load);
onMounted(load);
</script>

<template>
  <section class="category-page-head">
    <div class="container">
      <RouterLink to="/" class="back-link"><ArrowLeft :size="16" />返回软件首页</RouterLink>
      <p class="eyebrow">软件分类</p>
      <h1>{{ category?.name || '软件分类' }}</h1>
      <p>浏览{{ category?.name || '该分类' }}下已发布的软件资源。</p>
    </div>
  </section>
  <section class="container software-section category-page-content">
    <div v-if="loading" class="state-panel">正在加载分类资源...</div>
    <div v-else-if="error" class="state-panel">{{ error }}</div>
    <template v-else>
      <div class="section-heading compact"><div><p class="eyebrow">{{ category.name }}</p><h2>全部软件</h2></div><span class="result-count">{{ software.length }} 个应用</span></div>
      <div class="category-filters"><label>平台<select v-model="selectedPlatform"><option value="">全部平台</option><option v-for="platform in platformOptions" :key="platform">{{ platform }}</option></select></label><label>标签<select v-model="selectedTag"><option value="">全部标签</option><option v-for="tag in tags" :key="tag">{{ tag }}</option></select></label><label>排序<select v-model="selectedSort"><option value="updated">最新更新</option><option value="downloads">下载最多</option><option value="name">名称排序</option></select></label></div>
      <div v-if="!software.length" class="state-panel">该分类暂时没有已发布的软件</div>
      <div v-else class="software-grid"><article v-for="item in software" :key="item.id" class="software-card" role="link" tabindex="0" :aria-label="`查看 ${item.name}`" @click="openSoftware(item, $event)" @keydown="cardKeydown(item, $event)"><div class="software-cover"><img v-if="item.cover_image" :src="item.cover_image" :alt="`${item.name} Logo`" /><span v-else>{{ item.name.slice(0, 1).toUpperCase() }}</span></div><div class="software-body"><div class="software-title-row"><h3>{{ item.name }}</h3><span v-if="item.featured" class="badge">推荐</span></div><p>{{ item.summary || '暂无软件简介' }}</p><div class="platform-list"><span v-for="platform in item.platforms" :key="platform"><component :is="platformIcon(platform)" :size="14" />{{ platform }}</span></div><div class="software-meta"><span>v{{ item.version || '未知' }}</span><span><Clock3 :size="14" />{{ item.updated_at?.slice(0, 10) || '未知' }}</span><span><Download :size="14" />{{ item.download_count }}</span></div></div></article></div>
    </template>
  </section>
</template>
