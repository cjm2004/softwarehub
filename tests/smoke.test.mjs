import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const node = process.execPath;

async function waitFor(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test("server exposes health, software and protected download ticket", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "softwarehub-test-"));
  const port = 31981;
  const child = spawn(node, [fileURLToPath(new URL("../server.mjs", import.meta.url))], {
    cwd: root,
    env: { ...process.env, APP_DATA_DIR: dataDir, APP_PORT: String(port), APP_HOST: "::", APP_IPV6_ONLY: "false", APP_ADMIN_PASSWORD: "TestPass123" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let childOutput = "";
  child.stdout.on("data", chunk => { childOutput += chunk; });
  child.stderr.on("data", chunk => { childOutput += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      await new Promise(resolve => {
        child.once("exit", resolve);
        child.kill();
      });
    }
    await rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  const base = `http://127.0.0.1:${port}`;
  let health;
  try {
    health = await waitFor(`${base}/api/health`);
  } catch (error) {
    throw new Error(`${error.message}\n${childOutput}`);
  }
  assert.deepEqual(await health.json(), { ok: true, database: "sqlite" });
  const ipv6Health = await fetch(`http://[::1]:${port}/api/health`);
  assert.equal(ipv6Health.status, 200);

  const list = await fetch(`${base}/api/public/software`).then(r => r.json());
  assert.equal(list[0].slug, "wps-office");
  const detail = await fetch(`${base}/api/public/software/wps-office`).then(r => r.json());
  const officialLink = detail.channels.find(link => link.channel_type === "OFFICIAL");
  const ticketResponse = await fetch(`${base}/api/public/download/${officialLink.id}/ticket`, { method: "POST" });
  const ticket = await ticketResponse.json();
  const firstRedirect = await fetch(`${base}${ticket.url}`, { redirect: "manual" });
  assert.equal(firstRedirect.status, 302);
  const loginResponse = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ username: "admin", password: "TestPass123" })
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get("set-cookie").split(";", 1)[0];
  const meResponse = await fetch(`${base}/api/admin/me`, { headers: { Cookie: cookie } });
  assert.deepEqual(await meResponse.json(), { username: "admin" });

  const fakeUpload = await fetch(`${base}/api/admin/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ dataUrl: `data:image/png;base64,${Buffer.from("not a png").toString("base64")}` })
  });
  assert.equal(fakeUpload.status, 400);

  const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const logoUpload = await fetch(`${base}/api/admin/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ dataUrl: `data:image/png;base64,${onePixelPng}` })
  });
  assert.equal(logoUpload.status, 201);
  const logoUrl = (await logoUpload.json()).url;

  const createSoftware = await fetch(`${base}/api/admin/software`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ name: "Logo Test", slug: "logo-test", version: "1.0", coverImage: logoUrl, status: "PUBLISHED", platforms: ["Windows"] })
  });
  assert.equal(createSoftware.status, 201);
  const publicSoftware = await fetch(`${base}/api/public/software/logo-test`).then(r => r.json());
  assert.equal(publicSoftware.cover_image, logoUrl);
  const logoResponse = await fetch(`${base}${logoUrl}`);
  assert.equal(logoResponse.status, 200);
  assert.equal(logoResponse.headers.get("content-type"), "image/png");

  const categoryResponse = await fetch(`${base}/api/admin/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ name: "开发工具", slug: "dev-tools", sortOrder: 5, status: true })
  });
  assert.equal(categoryResponse.status, 201);
  const categoryId = (await categoryResponse.json()).id;
  const categories = await fetch(`${base}/api/admin/categories`, { headers: { Cookie: cookie } }).then(r => r.json());
  assert.equal(categories.some(item => item.id === categoryId && item.slug === "dev-tools"), true);

  const seoUpdate = await fetch(`${base}/api/admin/software/${publicSoftware.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ ...publicSoftware, categoryId, fileSize: publicSoftware.file_size, chargeType: publicSoftware.charge_type, priceCents: publicSoftware.price_cents, coverImage: logoUrl, status: "PUBLISHED", sortOrder: 2, seoTitle: "Logo Test SEO", seoDescription: "SEO 描述", seoKeywords: "logo,test", ogTitle: "分享标题", ogDescription: "分享描述", ogImage: logoUrl })
  });
  assert.equal(seoUpdate.status, 200);
  const seoPublic = await fetch(`${base}/api/public/software/logo-test`).then(r => r.json());
  assert.equal(seoPublic.seo_title, "Logo Test SEO");
  assert.equal(seoPublic.og_image, logoUrl);

  const classifiedList = await fetch(`${base}/api/public/software?category=dev-tools`).then(r => r.json());
  assert.equal(classifiedList.some(item => item.slug === "logo-test" && item.category_slug === "dev-tools"), true);
  const summarySearch = await fetch(`${base}/api/public/software?q=Logo`).then(r => r.json());
  assert.equal(summarySearch.some(item => item.slug === "logo-test"), true);

  const multiPlatformUpdate = await fetch(`${base}/api/admin/software/${publicSoftware.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ ...seoPublic, categoryId, fileSize: seoPublic.file_size, chargeType: seoPublic.charge_type, priceCents: seoPublic.price_cents, coverImage: logoUrl, status: "PUBLISHED", platforms: ["Windows", "Linux", "Web", "NOT_ALLOWED"], maintenanceStatus: "BETA", maintenanceNote: "测试维护状态", downloadNote: "请使用测试下载通道。" })
  });
  assert.equal(multiPlatformUpdate.status, 200);
  const multiPlatformPublic = await fetch(`${base}/api/public/software/logo-test`).then(r => r.json());
  assert.deepEqual(multiPlatformPublic.platforms, ["Windows", "Linux", "Web"]);
  assert.equal(multiPlatformPublic.maintenance_status, "BETA");
  assert.equal(multiPlatformPublic.download_note, "请使用测试下载通道。");

  const softwareLinks = await fetch(`${base}/api/admin/software/${publicSoftware.id}/links`, { headers: { Cookie: cookie } }).then(r => r.json());
  assert.equal(softwareLinks.length, 0);
  const downloadLink = await fetch(`${base}/api/admin/software/${publicSoftware.id}/links`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ name: "官方下载", channelType: "OFFICIAL", targetUrl: "https://example.com/download", status: "ACTIVE", sortOrder: 1 })
  }).then(r => r.json());
  const downloadTicket = await fetch(`${base}/api/public/download/${downloadLink.id}/ticket`, { method: "POST", headers: { "User-Agent": "SoftwareHubTest/1.0" } }).then(r => r.json());
  const downloadRedirect = await fetch(`${base}${downloadTicket.url}`, { redirect: "manual", headers: { "User-Agent": "SoftwareHubTest/1.0" } });
  assert.equal(downloadRedirect.status, 302);
  assert.equal(downloadRedirect.headers.get("location"), "https://example.com/download");
  const testLink = await fetch(`${base}/api/admin/software/${publicSoftware.id}/links`, { 
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ name: "测试直链", channelType: "DIRECT", targetUrl: "https://example.com/file", status: "ACTIVE", sortOrder: 3 })
  }).then(r => r.json());
  const editedLink = await fetch(`${base}/api/admin/software/${publicSoftware.id}/links/${testLink.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ name: "测试直链更新", channelType: "DIRECT", targetUrl: "https://example.com/updated", status: "DISABLED", sortOrder: 4 })
  });
  assert.equal(editedLink.status, 200);
  const deletedLink = await fetch(`${base}/api/admin/software/${publicSoftware.id}/links/${testLink.id}`, { method: "DELETE", headers: { Cookie: cookie, Origin: base } });
  assert.equal(deletedLink.status, 200);

  const createdVersion = await fetch(`${base}/api/admin/software/${publicSoftware.id}/versions`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ version: "0.9.0", fileSize: "100 MB", changelog: "历史版本", status: "ACTIVE" })
  }).then(r => r.json());
  const versionLink = await fetch(`${base}/api/admin/versions/${createdVersion.id}/links`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ name: "历史直链", targetUrl: "https://example.com/old", status: "ACTIVE" })
  }).then(r => r.json());
  const history = await fetch(`${base}/api/public/software/logo-test`).then(r => r.json());
  assert.equal(history.versions.some(item => item.id === createdVersion.id && item.channels[0].id === versionLink.id), true);
  const versionTicket = await fetch(`${base}/api/public/version-download/${versionLink.id}/ticket`, { method: "POST" }).then(r => r.json());
  const versionRedirect = await fetch(`${base}${versionTicket.url}`, { redirect: "manual" });
  assert.equal(versionRedirect.status, 302);
  assert.equal(versionRedirect.headers.get("location"), "https://example.com/old");

  const createdAnnouncement = await fetch(`${base}/api/admin/announcements`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ title: "维护通知", content: "测试公告", status: true })
  }).then(r => r.json());
  const publicAnnouncements = await fetch(`${base}/api/public/announcements`).then(r => r.json());
  assert.equal(publicAnnouncements.some(item => item.id === createdAnnouncement.id), true);
  const backup = await fetch(`${base}/api/admin/backup`, { headers: { Cookie: cookie } }).then(r => r.json());
  assert.equal(backup.schema, "softwarehub-backup");
  assert.equal(Array.isArray(backup.data.software_version), true);

  const stats = await fetch(`${base}/api/admin/statistics`, { headers: { Cookie: cookie } }).then(r => r.json());
  assert.equal(stats.overview.software >= 1, true);
  assert.equal(Array.isArray(stats.popular), true);
  assert.equal(Array.isArray(stats.recent), true);
  assert.equal(stats.series.length, 30);
  assert.equal(stats.downloads.some(item => item.software_name === "Logo Test" && item.client_ip && item.user_agent === "SoftwareHubTest/1.0"), true);
});

test("advanced operations, scheduling, statistics, RSS and backup compatibility work", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "softwarehub-advanced-"));
  const port = 31982;
  const child = spawn(node, [fileURLToPath(new URL("../server.mjs", import.meta.url))], {
    cwd: root,
    env: { ...process.env, APP_DATA_DIR: dataDir, APP_PORT: String(port), APP_HOST: "127.0.0.1", APP_ADMIN_PASSWORD: "TestPass123" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let childOutput = "";
  child.stdout.on("data", chunk => { childOutput += chunk; });
  child.stderr.on("data", chunk => { childOutput += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      await new Promise(resolve => {
        child.once("exit", resolve);
        child.kill();
      });
    }
    await rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(`${base}/api/health`);
  } catch (error) {
    throw new Error(`${error.message}\n${childOutput}`);
  }
  const loginResponse = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ username: "admin", password: "TestPass123" })
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get("set-cookie").split(";", 1)[0];
  const adminHeaders = { "Content-Type": "application/json", Cookie: cookie, Origin: base };
  const adminJson = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { ...adminHeaders, ...(options.headers || {}) } });

  const createTagged = await adminJson("/api/admin/software", {
    method: "POST",
    body: JSON.stringify({
      name: "Tagged Tool",
      slug: "tagged-tool",
      version: "2.0",
      platforms: ["Linux", "飞牛 NAS"],
      tags: ["开源软件", "绿色版"],
      summary: "用于标签与统计测试",
      status: "PUBLISHED",
      featured: true
    })
  });
  assert.equal(createTagged.status, 201);
  const taggedId = (await createTagged.json()).id;

  const tags = await fetch(`${base}/api/public/tags`).then(r => r.json());
  assert.equal(tags.includes("开源软件"), true);
  const taggedList = await fetch(`${base}/api/public/software?tag=${encodeURIComponent("开源软件")}`).then(r => r.json());
  assert.deepEqual(taggedList.map(item => item.slug), ["tagged-tool"]);
  const unrelatedTag = await fetch(`${base}/api/public/software?tag=${encodeURIComponent("付费软件")}`).then(r => r.json());
  assert.equal(unrelatedTag.length, 0);

  await fetch(`${base}/api/public/software?q=${encodeURIComponent("不存在的软件关键词")}`);
  const taggedDetail = await fetch(`${base}/api/public/software/tagged-tool`);
  assert.equal(taggedDetail.status, 200);
  const statsAfterTraffic = await adminJson("/api/admin/statistics").then(r => r.json());
  assert.equal(statsAfterTraffic.searches.some(item => item.query === "不存在的软件关键词" && item.no_results === 1), true);
  assert.equal(statsAfterTraffic.views.some(item => item.slug === "tagged-tool" && item.views >= 1), true);

  const duplicateResponse = await adminJson(`/api/admin/software/${taggedId}/duplicate`, { method: "POST" });
  assert.equal(duplicateResponse.status, 201);
  const duplicate = await duplicateResponse.json();
  const duplicatedRow = (await adminJson("/api/admin/software").then(r => r.json())).find(item => item.id === duplicate.id);
  assert.equal(duplicatedRow.status, "DRAFT");
  assert.equal(duplicatedRow.featured, 0);
  assert.deepEqual(duplicatedRow.tags, ["开源软件", "绿色版"]);

  const jsonImport = await adminJson("/api/admin/software/import", {
    method: "POST",
    body: JSON.stringify({ items: [{
      name: "Imported JSON",
      slug: "imported-json",
      version: "1.0",
      platforms: ["Windows"],
      tags: ["免费软件"],
      links: [{ name: "官方", channelType: "OFFICIAL", targetUrl: "https://example.com/json" }]
    }] })
  });
  assert.equal(jsonImport.status, 200);
  const jsonImportedId = (await jsonImport.json()).created[0];
  const importedLinks = await adminJson(`/api/admin/software/${jsonImportedId}/links`).then(r => r.json());
  assert.equal(importedLinks.length, 1);
  assert.equal(importedLinks[0].target_url, "https://example.com/json");

  const csvImport = await adminJson("/api/admin/software/import", {
    method: "POST",
    body: JSON.stringify({ csv: "name,slug,version,platforms,tags,summary\r\nImported CSV,imported-csv,3.1,Linux,绿色版,CSV 导入测试" })
  });
  assert.equal(csvImport.status, 200);
  const csvImportedId = (await csvImport.json()).created[0];
  const importedRows = await adminJson("/api/admin/software").then(r => r.json());
  const csvImported = importedRows.find(item => item.id === csvImportedId);
  assert.deepEqual(csvImported.platforms, ["Linux"]);
  assert.deepEqual(csvImported.tags, ["绿色版"]);

  const bulkResponse = await adminJson("/api/admin/software/bulk", {
    method: "POST",
    body: JSON.stringify({ ids: [jsonImportedId, csvImportedId], status: "PUBLISHED", featured: true })
  });
  assert.equal(bulkResponse.status, 200);
  const bulkRows = await adminJson("/api/admin/software").then(r => r.json());
  assert.equal(bulkRows.filter(item => [jsonImportedId, csvImportedId].includes(item.id)).every(item => item.status === "PUBLISHED" && item.featured === 1), true);

  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 3600_000).toISOString();
  const scheduledPublish = await adminJson("/api/admin/software", {
    method: "POST",
    body: JSON.stringify({ name: "Scheduled Publish", slug: "scheduled-publish", status: "DRAFT", publishAt: past, platforms: ["Web"] })
  });
  assert.equal(scheduledPublish.status, 201);
  const scheduledPublishId = (await scheduledPublish.json()).id;
  const scheduledOffline = await adminJson("/api/admin/software", {
    method: "POST",
    body: JSON.stringify({ name: "Scheduled Offline", slug: "scheduled-offline", status: "PUBLISHED", featured: true, unpublishAt: past, unfeatureAt: past, platforms: ["Web"] })
  });
  assert.equal(scheduledOffline.status, 201);
  const scheduledOfflineId = (await scheduledOffline.json()).id;
  const futurePublish = await adminJson("/api/admin/software", {
    method: "POST",
    body: JSON.stringify({ name: "Future Publish", slug: "future-publish", status: "DRAFT", publishAt: future, platforms: ["Web"] })
  });
  assert.equal(futurePublish.status, 201);
  const futurePublishId = (await futurePublish.json()).id;

  await fetch(`${base}/api/public/software`);
  const scheduledRows = await adminJson("/api/admin/software").then(r => r.json());
  const publishedRow = scheduledRows.find(item => item.id === scheduledPublishId);
  const offlineRow = scheduledRows.find(item => item.id === scheduledOfflineId);
  const futureRow = scheduledRows.find(item => item.id === futurePublishId);
  assert.equal(publishedRow.status, "PUBLISHED");
  assert.equal(publishedRow.publish_at, "");
  assert.equal(offlineRow.status, "OFFLINE");
  assert.equal(offlineRow.featured, 0);
  assert.equal(futureRow.status, "DRAFT");
  assert.notEqual(futureRow.publish_at, "");

  const rssResponse = await fetch(`${base}/rss.xml`);
  assert.equal(rssResponse.status, 200);
  assert.match(rssResponse.headers.get("content-type"), /application\/rss\+xml/);
  const rss = await rssResponse.text();
  assert.match(rss, /<rss version="2.0">/);
  assert.match(rss, /Tagged Tool/);
  assert.doesNotMatch(rss, /Future Publish/);

  const categoryRss = await fetch(`${base}/feed.xml?category=office`).then(r => r.text());
  assert.match(categoryRss, /WPS Office/);
  assert.doesNotMatch(categoryRss, /Tagged Tool/);

  const settingsResponse = await adminJson("/api/admin/settings").then(r => r.json());
  const settingsUpdate = await adminJson("/api/admin/settings", {
    method: "PUT",
    body: JSON.stringify({ ...settingsResponse, link_auto_disable: "1", link_failure_threshold: "1", link_check_interval_hours: "24" })
  });
  assert.equal(settingsUpdate.status, 200);
  const localLinkResponse = await adminJson(`/api/admin/software/${taggedId}/links`, {
    method: "POST",
    body: JSON.stringify({ name: "内网测试", channelType: "DIRECT", targetUrl: "http://127.0.0.1/private", status: "ACTIVE" })
  });
  assert.equal(localLinkResponse.status, 201);
  const localLinkId = (await localLinkResponse.json()).id;
  const checked = await adminJson(`/api/admin/software/${taggedId}/links/${localLinkId}/check`, { method: "POST" }).then(r => r.json());
  assert.equal(checked.status, "ERROR");
  assert.equal(checked.failures, 1);
  assert.equal(checked.autoDisabled, true);
  const checkedLinks = await adminJson(`/api/admin/software/${taggedId}/links`).then(r => r.json());
  assert.equal(checkedLinks.find(item => item.id === localLinkId).status, "DISABLED");

  const backupResponse = await adminJson("/api/admin/backup");
  assert.equal(backupResponse.status, 200);
  const backup = await backupResponse.json();
  assert.equal(Array.isArray(backup.data.search_event), true);
  assert.equal(Array.isArray(backup.data.page_view), true);
  const legacyBackup = structuredClone(backup);
  delete legacyBackup.data.search_event;
  delete legacyBackup.data.page_view;
  const restoreResponse = await adminJson("/api/admin/restore", { method: "POST", body: JSON.stringify(legacyBackup) });
  assert.equal(restoreResponse.status, 200);
  const restoredSoftware = await adminJson("/api/admin/software").then(r => r.json());
  assert.equal(restoredSoftware.some(item => item.slug === "tagged-tool"), true);

  const csvExport = await adminJson("/api/admin/downloads.csv");
  assert.equal(csvExport.status, 200);
  assert.match(csvExport.headers.get("content-type"), /text\/csv/);
  const csvBytes = new Uint8Array(await csvExport.arrayBuffer());
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(new TextDecoder().decode(csvBytes), /^时间,软件,固定链接,通道,类型,来源IP,浏览器/);

  const deleteBulk = await adminJson("/api/admin/software/bulk", {
    method: "POST",
    body: JSON.stringify({ ids: [jsonImportedId, csvImportedId], delete: true })
  });
  assert.equal(deleteBulk.status, 200);
  const afterDelete = await adminJson("/api/admin/software").then(r => r.json());
  assert.equal(afterDelete.some(item => [jsonImportedId, csvImportedId].includes(item.id)), false);
});
