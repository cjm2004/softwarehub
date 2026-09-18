<script setup>
import { computed, ref, onMounted } from "vue";
import { RouterLink, RouterView } from "vue-router";
import { Moon, Sun, ShieldCheck, Settings } from "@lucide/vue";

const theme = ref("light");
const site = ref({ site_name: "软件仓库", site_description: "干净、清晰的软件资源下载站", site_logo: "", footer_copyright: "", footer_icp: "", footer_links: "[]" });
const footerLinks = computed(() => { try { const links = JSON.parse(site.value.footer_links || "[]"); return Array.isArray(links) ? links.filter(link => link?.name && /^https?:\/\//.test(link.url)) : []; } catch { return []; } });
const categories = ref([]);

function applyTheme(value) {
  document.documentElement.dataset.theme = value;
  document.documentElement.style.colorScheme = value;
  theme.value = value;
  localStorage.setItem("theme", value);
}

function toggleTheme(event) {
  const next = theme.value === "dark" ? "light" : "dark";
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return applyTheme(next);
  const x = event?.clientX ?? innerWidth - 40;
  const y = event?.clientY ?? 40;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.documentElement.style.setProperty("--theme-x", `${x}px`);
  document.documentElement.style.setProperty("--theme-y", `${y}px`);
  document.documentElement.style.setProperty("--theme-radius", `${radius}px`);
  document.startViewTransition(() => applyTheme(next));
}

onMounted(async () => {
  applyTheme(localStorage.getItem("theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const [siteResponse, categoryResponse] = await Promise.allSettled([
    fetch("/api/public/site"),
    fetch("/api/public/categories")
  ]);
  if (siteResponse.status === "fulfilled" && siteResponse.value.ok) site.value = await siteResponse.value.json();
  if (categoryResponse.status === "fulfilled" && categoryResponse.value.ok) categories.value = await categoryResponse.value.json();
});
</script>

<template>
  <header class="site-header">
    <div class="header-inner">
      <RouterLink to="/" class="brand" aria-label="返回首页">
        <span class="brand-mark"><img v-if="site.site_logo" :src="site.site_logo" alt="" /><ShieldCheck v-else :size="20" /></span>
        <span>{{ site.site_name }}</span>
      </RouterLink>
      <nav class="main-nav" aria-label="主导航">
        <RouterLink v-for="category in categories" :key="category.id" :to="`/category/${category.slug}`">{{ category.name }}</RouterLink>
      </nav>
      <div class="header-actions">
        <button class="icon-button" title="切换明暗主题" aria-label="切换明暗主题" @click="toggleTheme">
          <Sun v-if="theme === 'dark'" :size="19" />
          <Moon v-else :size="19" />
        </button>
      </div>
    </div>
  </header>
  <main><RouterView /></main>
  <footer class="site-footer">
    <div><strong>{{ site.footer_copyright || site.site_name }}</strong><span>{{ site.site_description }}</span><span v-if="site.footer_icp">{{ site.footer_icp }}</span></div>
    <div class="footer-links"><a href="/rss.xml" target="_blank" rel="noopener noreferrer">RSS 更新</a><a v-for="link in footerLinks" :key="link.url" :href="link.url" rel="noopener noreferrer">{{ link.name }}</a><RouterLink to="/admin" class="footer-admin"><Settings :size="15" />管理后台</RouterLink></div>
  </footer>
</template>
