<script setup>
import { computed, ref, onMounted, onUnmounted } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { Search, Download, Monitor, Smartphone, Apple, Sparkles, ChevronLeft, ChevronRight, Clock3, ArrowRight } from "@lucide/vue";

const router = useRouter();
const query = ref("");
const software = ref([]);
const categories = ref([]);
const announcements = ref([]);
const site = ref({});
const slides = ref([]);
const loading = ref(true);
const error = ref("");
const activeSlide = ref(0);
let requestId = 0;
let slideTimer;

const fallbackSlides = [
  { image_url: "/banners/productivity.webp", kicker: "办公效率", title: "日常工作，从合适的软件开始", content: "精选稳定实用的办公工具，版本、大小与安装步骤一目了然。", target_type: "CATEGORY", target_value: "office" },
  { image_url: "/banners/system-tools.webp", kicker: "系统工具", title: "让设备维护更简单", content: "常用系统与网络工具集中整理，多个下载通道按需选择。", target_type: "CATEGORY", target_value: "system-tools" },
  { image_url: "/banners/creative-design.webp", kicker: "创意设计", title: "把创意工具装进工作流", content: "从图像处理到设计辅助，快速找到适合当前设备的版本。", target_type: "CATEGORY", target_value: "design" }
];
const activeSlides = computed(() => slides.value.length ? slides.value : fallbackSlides);
const limit = (key, fallback) => Math.max(1, Math.min(24, Number(site.value[key] || fallback) || fallback));
const enabled = key => site.value[key] !== "0";
const sectionOrder = computed(() => { try { const values = JSON.parse(site.value.homepage_sections || "[]"); return Array.isArray(values) ? values : []; } catch { return []; } });
const sectionStyle = key => ({ order: sectionOrder.value.includes(key) ? sectionOrder.value.indexOf(key) : 99 });
const visibleCategorySections = computed(() => enabled("homepage_show_categories") ? categorySections.value : []);

const searchMode = computed(() => Boolean(query.value.trim()));
const recommended = computed(() => software.value.filter(item => item.featured).slice(0, limit("homepage_recommended_limit", 6)));
const updated = computed(() => [...software.value].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))).slice(0, limit("homepage_updated_limit", 6)));
const categorySections = computed(() => categories.value.map(category => ({
  ...category,
  items: software.value.filter(item => item.category_slug === category.slug).slice(0, limit("homepage_category_limit", 4))
})).filter(category => category.items.length));

async function load() {
  const currentRequest = ++requestId;
  loading.value = true;
  error.value = "";
  const params = new URLSearchParams();
  if (query.value.trim()) params.set("q", query.value.trim());
  try {
    const response = await fetch(`/api/public/software?${params}`);
    if (!response.ok) throw new Error("LOAD_FAILED");
    const data = await response.json();
    if (currentRequest === requestId) software.value = data;
  } catch {
    if (currentRequest === requestId) error.value = "资源加载失败，请稍后重试";
  } finally {
    if (currentRequest === requestId) loading.value = false;
  }
}

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

function showSlide(index) {
  activeSlide.value = (index + activeSlides.value.length) % activeSlides.value.length;
  restartSlides();
}

function restartSlides() {
  clearInterval(slideTimer);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    slideTimer = setInterval(() => { activeSlide.value = (activeSlide.value + 1) % activeSlides.value.length; }, 6000);
  }
}

onMounted(async () => {
  try {
    const [categoryResponse, announcementResponse, siteResponse, slideResponse] = await Promise.all([fetch("/api/public/categories"), fetch("/api/public/announcements"), fetch("/api/public/site"), fetch("/api/public/slides")]);
    categories.value = categoryResponse.ok ? await categoryResponse.json() : [];
    announcements.value = announcementResponse.ok ? await announcementResponse.json() : [];
    site.value = siteResponse.ok ? await siteResponse.json() : {};
    slides.value = slideResponse.ok ? await slideResponse.json() : [];
  } catch {
    categories.value = [];
    announcements.value = [];
  }
  await load();
  restartSlides();
});
onUnmounted(() => clearInterval(slideTimer));

const platformIcon = platform => platform === "Android" ? Smartphone : platform === "macOS" ? Apple : Monitor;
</script>

<template>
  <section class="home-intro">
    <div class="container home-intro-grid">
      <div class="home-message">
        <p class="eyebrow"><Sparkles :size="16" /> 精选与常用工具</p>
        <h1>找到真正需要的软件</h1>
        <p>提供清晰的版本信息、安装说明和多个下载通道，适配电脑与移动设备浏览。</p>
      </div>
      <form class="header-search" role="search" @submit.prevent="load">
        <Search :size="19" />
        <input v-model="query" aria-label="搜索软件" placeholder="搜索软件名称、用途或平台" />
        <button class="primary-button" type="submit">搜索</button>
      </form>
    </div>
  </section>

  <div class="homepage-flow">
  <section v-if="enabled('homepage_show_announcements') && announcements.length" class="container announcement-list" :style="sectionStyle('announcements')"><article v-for="item in announcements" :key="item.id"><strong>{{ item.title }}</strong><span v-if="item.content">{{ item.content }}</span></article></section>

  <section v-if="enabled('homepage_show_carousel')" class="container home-showcase" :style="sectionStyle('carousel')">
    <div class="hero-carousel" aria-roledescription="轮播图" @mouseenter="clearInterval(slideTimer)" @mouseleave="restartSlides">
      <article v-for="(slide, index) in activeSlides" :key="slide.id || slide.image_url" class="hero-slide" :class="{ active: activeSlide === index }" :aria-hidden="activeSlide !== index">
        <img :src="slide.image_url" alt="" />
        <div class="hero-shade"></div>
        <div class="hero-copy">
          <span>{{ slide.kicker }}</span>
          <h2>{{ slide.title }}</h2>
          <p>{{ slide.content }}</p>
          <RouterLink v-if="slide.target_type==='CATEGORY' && slide.target_value" class="hero-action" :to="`/category/${slide.target_value}`">浏览分类</RouterLink><a v-else-if="slide.target_type==='URL' && slide.target_value" class="hero-action" :href="slide.target_value" rel="noopener noreferrer">访问链接</a>
        </div>
      </article>
      <button v-if="activeSlides.length>1" class="carousel-arrow previous" aria-label="上一张" @click="showSlide(activeSlide - 1)"><ChevronLeft :size="20" /></button>
      <button v-if="activeSlides.length>1" class="carousel-arrow next" aria-label="下一张" @click="showSlide(activeSlide + 1)"><ChevronRight :size="20" /></button>
      <div v-if="activeSlides.length>1" class="carousel-dots">
        <button v-for="(_, index) in activeSlides" :key="index" :class="{ active: activeSlide === index }" :aria-label="`切换到第 ${index + 1} 张`" @click="showSlide(index)"></button>
      </div>
    </div>
  </section>

  <section class="container software-section" style="display:contents">
    <template v-if="loading">
      <div class="state-panel">正在加载资源...</div>
    </template>
    <template v-else-if="error">
      <div class="state-panel">{{ error }}</div>
    </template>
    <template v-else-if="searchMode">
      <div class="section-heading compact"><div><p class="eyebrow">软件资源</p><h2>搜索结果</h2></div><span class="result-count">{{ software.length }} 个结果</span></div>
      <div v-if="!software.length" class="state-panel">没有找到匹配的软件</div>
      <div v-else class="software-grid"><article v-for="item in software" :key="item.id" class="software-card" role="link" tabindex="0" :aria-label="`查看 ${item.name}`" @click="openSoftware(item, $event)" @keydown="cardKeydown(item, $event)"><div class="software-cover"><img v-if="item.cover_image" :src="item.cover_image" :alt="`${item.name} Logo`" /><span v-else>{{ item.name.slice(0, 1).toUpperCase() }}</span></div><div class="software-body"><div class="software-title-row"><h3>{{ item.name }}</h3><span v-if="item.featured" class="badge">推荐</span></div><p>{{ item.summary || '暂无软件简介' }}</p><div class="platform-list"><span v-for="platform in item.platforms" :key="platform"><component :is="platformIcon(platform)" :size="14" />{{ platform }}</span></div><div class="software-meta"><span>v{{ item.version || '未知' }}</span><span><Clock3 :size="14" />{{ item.updated_at?.slice(0, 10) || '未知' }}</span><span><Download :size="14" />{{ item.download_count }}</span></div></div></article></div>
    </template>
    <template v-else>
      <section v-if="enabled('homepage_show_recommended') && recommended.length" class="software-group" :style="sectionStyle('recommended')"><div class="section-heading compact"><div><p class="eyebrow">精选资源</p><h2>推荐</h2></div><span class="result-count">{{ recommended.length }} 个应用</span></div><div class="software-grid"><article v-for="item in recommended" :key="`recommended-${item.id}`" class="software-card" role="link" tabindex="0" :aria-label="`查看 ${item.name}`" @click="openSoftware(item, $event)" @keydown="cardKeydown(item, $event)"><div class="software-cover"><img v-if="item.cover_image" :src="item.cover_image" :alt="`${item.name} Logo`" /><span v-else>{{ item.name.slice(0, 1).toUpperCase() }}</span></div><div class="software-body"><div class="software-title-row"><h3>{{ item.name }}</h3><span class="badge">推荐</span></div><p>{{ item.summary || '暂无软件简介' }}</p><div class="platform-list"><span v-for="platform in item.platforms" :key="platform"><component :is="platformIcon(platform)" :size="14" />{{ platform }}</span></div><div class="software-meta"><span>v{{ item.version || '未知' }}</span><span><Clock3 :size="14" />{{ item.updated_at?.slice(0, 10) || '未知' }}</span><span><Download :size="14" />{{ item.download_count }}</span></div></div></article></div></section>
      <section v-if="enabled('homepage_show_updated') && updated.length" class="software-group" :style="sectionStyle('updated')"><div class="section-heading compact"><div><p class="eyebrow">近期维护</p><h2>更新</h2></div><span class="result-count">{{ updated.length }} 个应用</span></div><div class="software-grid"><article v-for="item in updated" :key="`updated-${item.id}`" class="software-card" role="link" tabindex="0" :aria-label="`查看 ${item.name}`" @click="openSoftware(item, $event)" @keydown="cardKeydown(item, $event)"><div class="software-cover"><img v-if="item.cover_image" :src="item.cover_image" :alt="`${item.name} Logo`" /><span v-else>{{ item.name.slice(0, 1).toUpperCase() }}</span></div><div class="software-body"><div class="software-title-row"><h3>{{ item.name }}</h3></div><p>{{ item.summary || '暂无软件简介' }}</p><div class="platform-list"><span v-for="platform in item.platforms" :key="platform"><component :is="platformIcon(platform)" :size="14" />{{ platform }}</span></div><div class="software-meta"><span>v{{ item.version || '未知' }}</span><span><Clock3 :size="14" />{{ item.updated_at?.slice(0, 10) || '未知' }}</span><span><Download :size="14" />{{ item.download_count }}</span></div></div></article></div></section>
      <section v-for="category in visibleCategorySections" :key="category.id" class="software-group category-section" :style="sectionStyle('categories')"><div class="section-heading compact"><div><p class="eyebrow">分类资源</p><h2>{{ category.name }}</h2></div><span class="result-count">{{ category.items.length }} 个应用</span></div><div class="software-grid"><article v-for="item in category.items" :key="`${category.slug}-${item.id}`" class="software-card" role="link" tabindex="0" :aria-label="`查看 ${item.name}`" @click="openSoftware(item, $event)" @keydown="cardKeydown(item, $event)"><div class="software-cover"><img v-if="item.cover_image" :src="item.cover_image" :alt="`${item.name} Logo`" /><span v-else>{{ item.name.slice(0, 1).toUpperCase() }}</span></div><div class="software-body"><div class="software-title-row"><h3>{{ item.name }}</h3><span v-if="item.featured" class="badge">推荐</span></div><p>{{ item.summary || '暂无软件简介' }}</p><div class="platform-list"><span v-for="platform in item.platforms" :key="platform"><component :is="platformIcon(platform)" :size="14" />{{ platform }}</span></div><div class="software-meta"><span>v{{ item.version || '未知' }}</span><span><Clock3 :size="14" />{{ item.updated_at?.slice(0, 10) || '未知' }}</span><span><Download :size="14" />{{ item.download_count }}</span></div></div></article></div><RouterLink class="category-browse" :to="`/category/${category.slug}`">点击浏览{{ category.name }}<ArrowRight :size="16" /></RouterLink></section>
      <div v-if="!recommended.length && !updated.length && !visibleCategorySections.length" class="state-panel">暂无已发布的软件</div>
    </template>
  </section>
  </div>
</template>
