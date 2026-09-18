import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import HomeView from "./views/HomeView.vue";
import CategoryView from "./views/CategoryView.vue";
import PreviewView from "./views/PreviewView.vue";
import SoftwareView from "./views/SoftwareView.vue";
import DownloadView from "./views/DownloadView.vue";
import AdminView from "./views/AdminView.vue";
import "./styles.css";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: HomeView },
    { path: "/category/:slug", component: CategoryView },
    { path: "/preview/:id", component: PreviewView },
    { path: "/soft/:slug", component: SoftwareView },
    { path: "/download/:slug", component: DownloadView },
    { path: "/admin", component: AdminView }
  ],
  scrollBehavior: () => ({ top: 0 })
});

createApp(App).use(router).mount("#app");
