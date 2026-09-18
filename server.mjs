import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DatabaseSync } from "node:sqlite";

const ROOT = resolve(import.meta.dirname);
const WEB_ROOT = join(ROOT, "dist");
const DATA_DIR = resolve(process.env.APP_DATA_DIR || join(ROOT, ".data"));
const DB_PATH = join(DATA_DIR, "softwarehub.db");
const ADMIN_USERNAME_FILE = process.env.APP_ADMIN_USERNAME_FILE || "";
const ADMIN_PASSWORD_FILE = process.env.APP_ADMIN_PASSWORD_FILE || "";
const PORT = Number(process.env.APP_PORT || 31880);
const HOST = process.env.APP_HOST || "127.0.0.1";
const IPV6_ONLY = String(process.env.APP_IPV6_ONLY || "false").toLowerCase() === "true";

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
mkdirSync(join(DATA_DIR, "files"), { recursive: true });
mkdirSync(join(DATA_DIR, "backups"), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
db.exec(`
CREATE TABLE IF NOT EXISTS admin_user (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES category(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS software (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES category(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL DEFAULT '',
  platforms TEXT NOT NULL DEFAULT '[]',
  file_size TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  tutorial TEXT NOT NULL DEFAULT '',
  changelog TEXT NOT NULL DEFAULT '',
  cover_image TEXT NOT NULL DEFAULT '',
  screenshots TEXT NOT NULL DEFAULT '[]',
  charge_type TEXT NOT NULL DEFAULT 'FREE',
  price_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  featured INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS download_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  software_id INTEGER NOT NULL REFERENCES software(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  target_url TEXT NOT NULL,
  extract_code TEXT NOT NULL DEFAULT '',
  require_purchase INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);
CREATE TABLE IF NOT EXISTS session (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS download_ticket (
  token_hash TEXT PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES download_link(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS site_setting (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS download_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  software_id INTEGER NOT NULL REFERENCES software(id) ON DELETE CASCADE,
  link_id INTEGER NOT NULL REFERENCES download_link(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  client_ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS software_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  software_id INTEGER NOT NULL REFERENCES software(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  file_size TEXT NOT NULL DEFAULT '',
  changelog TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS version_download_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES software_version(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);
CREATE TABLE IF NOT EXISTS version_download_ticket (
  token_hash TEXT PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES version_download_link(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS site_announcement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS homepage_slide (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_url TEXT NOT NULL DEFAULT '',
  kicker TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL DEFAULT 'CATEGORY',
  target_value TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER REFERENCES admin_user(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  client_ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS search_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS page_view (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  software_id INTEGER REFERENCES software(id) ON DELETE CASCADE,
  page_type TEXT NOT NULL DEFAULT 'SOFTWARE',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_download_event_software_time ON download_event(software_id, created_at);
CREATE INDEX IF NOT EXISTS idx_software_version_software ON software_version(software_id, sort_order, id);
`);

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing("software", "sort_order", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("software", "seo_title", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("software", "seo_description", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("software", "seo_keywords", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("software", "og_title", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("software", "og_description", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("software", "og_image", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("software", "maintenance_status", "TEXT NOT NULL DEFAULT 'MAINTAINED'");
addColumnIfMissing("software", "maintenance_note", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("software", "download_note", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("software", "tags", "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing("software", "publish_at", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("software", "unpublish_at", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("software", "unfeature_at", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("download_link", "last_checked_at", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("download_link", "last_check_status", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("download_link", "last_check_message", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("download_link", "consecutive_failures", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("download_event", "client_ip", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("download_event", "user_agent", "TEXT NOT NULL DEFAULT ''");

function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password, stored) {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function tokenHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readCredential(path, fallback = "") {
  if (!path) return fallback;
  try {
    return (await readFile(path, "utf8")).replace(/[\r\n]+$/, "");
  } catch {
    return fallback;
  }
}

async function ensureSeed() {
  const admin = db.prepare("SELECT id FROM admin_user LIMIT 1").get();
  if (!admin) {
    const initialUsername = await readCredential(ADMIN_USERNAME_FILE, process.env.APP_ADMIN_USERNAME || "admin");
    const initialPassword = await readCredential(ADMIN_PASSWORD_FILE, process.env.APP_ADMIN_PASSWORD || randomBytes(18).toString("base64url"));
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(initialUsername) || initialPassword.length < 8 || initialPassword.length > 128) {
      throw new Error("INVALID_INITIAL_ADMIN_CREDENTIALS");
    }
    db.prepare("INSERT INTO admin_user(username,password_hash) VALUES(?,?)").run(initialUsername, passwordHash(initialPassword));
    console.log(`Initial admin account created: ${initialUsername}`);
  }
  const insertCategory = db.prepare("INSERT OR IGNORE INTO category(name,slug,sort_order) VALUES(?,?,?)");
  for (const category of [["办公软件", "office", 10], ["系统工具", "system-tools", 20], ["图形设计", "design", 30]]) {
    insertCategory.run(...category);
  }
  const office = db.prepare("SELECT id FROM category WHERE slug='office'").get();
  const existingSoftware = db.prepare("SELECT id FROM software WHERE slug='wps-office'").get();
  if (!existingSoftware) {
    const softwareInfo = db.prepare(`INSERT INTO software(category_id,name,slug,version,platforms,file_size,summary,description,tutorial,changelog,charge_type,status,featured)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(office?.id || null, "WPS Office", "wps-office", "2025", '["Windows","macOS","Android"]', "248 MB", "轻量、兼容性良好的办公套件。", "支持文字、表格、演示和 PDF 工具，适合个人与团队日常办公。", "下载后运行安装程序，根据向导完成安装。", "优化启动速度并增强格式兼容性。", "FREE", "PUBLISHED", 1);
    const softwareId = Number(softwareInfo.lastInsertRowid);
    const insertLink = db.prepare("INSERT INTO download_link(software_id,name,channel_type,target_url,extract_code,sort_order) VALUES(?,?,?,?,?,?)");
    insertLink.run(softwareId, "官方网站", "OFFICIAL", "https://www.wps.cn/", "", 10);
    insertLink.run(softwareId, "百度网盘", "BAIDU", "https://pan.baidu.com/", "demo", 20);
  }
  const defaultSettings = {
    site_name: "软件仓库",
    site_description: "干净、清晰的软件资源下载站",
    site_logo: "",
    site_seo_keywords: "软件,下载,应用,工具",
    footer_copyright: "",
    footer_icp: "",
    footer_links: "[]",
    contact_email: "",
    contact_github: "",
    feedback_url: "",
    donation_wechat: "",
    donation_alipay: "",
    homepage_sections: "[\"announcements\",\"carousel\",\"recommended\",\"updated\",\"categories\"]",
    homepage_show_announcements: "1",
    homepage_show_carousel: "1",
    homepage_show_recommended: "1",
    homepage_show_updated: "1",
    homepage_show_categories: "1",
    homepage_category_limit: "4",
    homepage_recommended_limit: "6",
    homepage_updated_limit: "6",
    default_download_note: "请从可信下载通道获取安装包，安装前请核对系统版本和文件来源。",
    download_disclaimer: "下载即表示你理解并同意：请遵守软件许可协议，本站不对第三方下载内容承担担保责任。",
    download_ticket_seconds: "300",
    record_download_metadata: "1",
    session_hours: "12",
    login_attempt_limit: "10",
    login_attempt_window_minutes: "15",
    backup_retention_count: "10",
    link_auto_disable: "1",
    link_failure_threshold: "3",
    link_check_interval_hours: "24"
  };
  const insertSetting = db.prepare("INSERT OR IGNORE INTO site_setting(setting_key,setting_value) VALUES(?,?)");
  for (const [key, value] of Object.entries(defaultSettings)) insertSetting.run(key, value);
  for (const path of [ADMIN_USERNAME_FILE, ADMIN_PASSWORD_FILE]) {
    if (path) await unlink(path).catch(() => {});
  }
}
await ensureSeed();

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
};

const readJson = async (req, maxBytes = 3 * 1024 * 1024) => {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxBytes) throw new Error("REQUEST_TOO_LARGE");
  }
  return body ? JSON.parse(body) : {};
};

const parseCookie = req => Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map(item => {
  const i = item.indexOf("=");
  return [item.slice(0, i).trim(), decodeURIComponent(item.slice(i + 1))];
}));

function getAdmin(req) {
  const token = parseCookie(req).softwarehub_session;
  if (!token) return null;
  const now = Date.now();
  const row = db.prepare("SELECT admin_id FROM session WHERE token_hash=? AND expires_at>?").get(tokenHash(token), now);
  return row?.admin_id || null;
}

function requireAdmin(req, res) {
  const id = getAdmin(req);
  if (!id) json(res, 401, { error: "UNAUTHORIZED" });
  return id;
}

const settings = () => Object.fromEntries(db.prepare("SELECT setting_key,setting_value FROM site_setting").all().map(r => [r.setting_key, r.setting_value]));
const settingNumber = (key, fallback, min, max) => Math.min(max, Math.max(min, Number(settings()[key] || fallback) || fallback));
function audit(req, adminId, action, targetType = "", targetId = "", detail = "") {
  db.prepare("INSERT INTO admin_audit_log(admin_id,action,target_type,target_id,detail,client_ip,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(adminId || null, action, targetType, String(targetId || ""), String(detail || "").slice(0, 500), clientAddress(req), Date.now());
}
function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
const safeSoftware = row => ({ ...row, platforms: parseJsonArray(row.platforms), screenshots: parseJsonArray(row.screenshots), tags: parseJsonArray(row.tags) });
function normalizeSchedule(value) { const time = Date.parse(String(value || "")); return Number.isFinite(time) ? new Date(time).toISOString() : ""; }
function applySchedules() {
  const now = Date.now();
  for (const row of db.prepare("SELECT id,publish_at,unpublish_at,unfeature_at FROM software").all()) {
    if (row.publish_at && Date.parse(row.publish_at) <= now) db.prepare("UPDATE software SET status='PUBLISHED',publish_at='' WHERE id=?").run(row.id);
    if (row.unpublish_at && Date.parse(row.unpublish_at) <= now) db.prepare("UPDATE software SET status='OFFLINE',unpublish_at='' WHERE id=?").run(row.id);
    if (row.unfeature_at && Date.parse(row.unfeature_at) <= now) db.prepare("UPDATE software SET featured=0,unfeature_at='' WHERE id=?").run(row.id);
  }
}
const allowedPlatforms = ["Windows", "macOS", "Android", "iOS", "Linux", "HarmonyOS", "Web", "ChromeOS", "飞牛 NAS"];
const allowedMaintenance = ["MAINTAINED", "BETA", "LIMITED", "DEPRECATED", "RISK"];
const limitedText = (value, length) => String(value || "").slice(0, length);
function sanitizePlatforms(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(item => allowedPlatforms.includes(item)))];
}
function normalizeTags(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(item => typeof item === "string").map(item => item.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
}
function parseCsv(text) {
  const rows=[]; let row=[]; let cell=""; let quoted=false;
  for(let i=0;i<String(text||"").length;i+=1){const char=String(text||"")[i];const next=String(text||"")[i+1];if(char==='"'&&quoted&&next==='"'){cell+='"';i+=1;continue}if(char==='"'){quoted=!quoted;continue}if(char===","&&!quoted){row.push(cell.trim());cell="";continue}if((char==="\n"||char==="\r")&&!quoted){if(char==="\r"&&next==="\n")i+=1;row.push(cell.trim());cell="";if(row.some(value=>value!==""))rows.push(row);row=[];continue}cell+=char}if(cell!==""||row.length){row.push(cell.trim());if(row.some(value=>value!==""))rows.push(row)}if(!rows.length)return[];const headers=rows.shift().map(value=>value.replace(/^\uFEFF/,""));return rows.map(values=>Object.fromEntries(headers.map((header,index)=>[header,values[index]||""])))}
function validateHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}
function isPrivateIpv4(value) {
  const octets = String(value || "").split(".").map(Number);
  if (octets.length !== 4 || octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    a === 100 && b >= 64 && b <= 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168 ||
    a === 192 && b === 0 && c === 0 ||
    a === 198 && (b === 18 || b === 19) ||
    a === 198 && b === 51 && c === 100 ||
    a === 203 && b === 0 && c === 113;
}
function mappedIpv4(value) {
  if (!value.startsWith("::ffff:")) return "";
  const suffix = value.slice(7);
  if (isIP(suffix) === 4) return suffix;
  const compact = suffix.replaceAll(":", "").padStart(8, "0");
  if (!/^[0-9a-f]{8}$/.test(compact)) return "";
  return [0, 2, 4, 6].map(index => Number.parseInt(compact.slice(index, index + 2), 16)).join(".");
}
function isPrivateAddress(address) {
  const value = String(address || "").toLowerCase().split("%")[0];
  if (isIP(value) === 4) return isPrivateIpv4(value);
  const mapped = mappedIpv4(value);
  if (mapped) return isPrivateIpv4(mapped);
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value) || value.startsWith("ff");
}
async function assertPublicTarget(url) {
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("不允许检测本地地址");
  const results = await lookup(url.hostname, { all: true });
  if (!results.length || results.some(item => isPrivateAddress(item.address))) throw new Error("不允许检测内网地址");
}
async function inspectDownloadLink(link) {
  const checkedAt = new Date().toISOString(); let status = "ERROR", message = "连接失败";
  try {
    const target = validateHttpUrl(link.target_url);
    if (!target) throw new Error("无效下载地址");
    await assertPublicTarget(target);
    let response = await fetch(target, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) });
    if ([405, 501].includes(response.status)) {
      response = await fetch(target, { method: "GET", headers: { Range: "bytes=0-0" }, redirect: "manual", signal: AbortSignal.timeout(8000) });
    }
    status = response.ok || response.status >= 300 && response.status < 400 ? "OK" : "HTTP_ERROR";
    message = `HTTP ${response.status}`;
  } catch (error) {
    message = String(error?.message || "连接失败").slice(0, 180);
  }
  const failures = status === "OK" ? 0 : Number(link.consecutive_failures || 0) + 1;
  const autoDisable = settings().link_auto_disable !== "0" && failures >= settingNumber("link_failure_threshold", 3, 1, 20);
  db.prepare("UPDATE download_link SET last_checked_at=?,last_check_status=?,last_check_message=?,consecutive_failures=?,status=CASE WHEN ? THEN 'DISABLED' ELSE status END WHERE id=?").run(checkedAt,status,message,failures,autoDisable?1:0,link.id);
  return {id:link.id,name:link.name,status,message,checkedAt,failures,autoDisabled:autoDisable};
}

let linkCheckTimer;
function pruneAnalytics() {
  const cutoff = Date.now() - 180 * 24 * 3600_000;
  db.prepare("DELETE FROM search_event WHERE created_at<?").run(cutoff);
  db.prepare("DELETE FROM page_view WHERE created_at<?").run(cutoff);
}
async function scheduledLinkCheck() {
  const interval = settingNumber("link_check_interval_hours", 24, 1, 720) * 3600_000;
  const cutoff = new Date(Date.now() - interval).toISOString();
  const links = db.prepare("SELECT * FROM download_link WHERE status<>'DISABLED' AND (last_checked_at='' OR last_checked_at<?) ORDER BY id LIMIT 100").all(cutoff);
  for (const link of links) await inspectDownloadLink(link);
}
function restartLinkCheckTimer() {
  clearInterval(linkCheckTimer);
  linkCheckTimer = setInterval(() => scheduledLinkCheck().catch(error => console.error("Scheduled link check failed", error)), settingNumber("link_check_interval_hours", 24, 1, 720) * 3600_000);
}
const rateBuckets = new Map();
function clientAddress(req) {
  return String(req.socket.remoteAddress || "").replace(/^::ffff:/, "") || "unknown";
}
function chinaDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const values = Object.fromEntries(parts.filter(item => item.type !== "literal").map(item => [item.type, item.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}
function chinaDayStart(year, month, day) {
  return Date.UTC(year, month - 1, day) - 8 * 3600_000;
}
function chinaDateLabel(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function clientKey(req) {
  return clientAddress(req);
}
function rateLimited(req, scope, limit, windowMs) {
  const now = Date.now();
  const key = `${scope}:${clientKey(req)}`;
  const recent = (rateBuckets.get(key) || []).filter(time => time > now - windowMs);
  if (recent.length >= limit) return true;
  recent.push(now);
  rateBuckets.set(key, recent);
  if (rateBuckets.size > 1000) {
    for (const [bucketKey, times] of rateBuckets) if (!times.some(time => time > now - windowMs)) rateBuckets.delete(bucketKey);
  }
  return false;
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
function validImage(data, extension) {
  const png = data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const webp = data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
  return extension === "png" ? png : extension === "jpg" ? jpeg : webp;
}

function routePattern(path, pattern) {
  const p = pattern.split("/").filter(Boolean);
  const a = path.split("/").filter(Boolean);
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

async function handleApi(req, res, url) {
  const path = url.pathname;
  if (req.method === "GET" && path === "/api/health") {
    return json(res, 200, { ok: true, database: "sqlite" });
  }
  if (req.method === "GET" && path === "/api/public/site") {
    return json(res, 200, settings());
  }
  if (req.method === "GET" && path === "/api/public/slides") {
    return json(res, 200, db.prepare("SELECT id,image_url,kicker,title,content,target_type,target_value FROM homepage_slide WHERE status=1 ORDER BY sort_order,id").all());
  }
  if (req.method === "GET" && (path === "/rss.xml" || path === "/feed.xml")) {
    const category = url.searchParams.get("category") || ""; const rows=db.prepare("SELECT s.name,s.slug,s.summary,s.description,s.updated_at,c.slug AS category_slug FROM software s LEFT JOIN category c ON c.id=s.category_id WHERE s.status='PUBLISHED' AND (?='' OR c.slug=?) ORDER BY s.updated_at DESC LIMIT 50").all(category,category); const base=`${url.protocol}//${req.headers.host}`; const escape=value=>String(value||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;"); const items=rows.map(row=>`<item><title>${escape(row.name)}</title><link>${base}/soft/${encodeURIComponent(row.slug)}</link><guid>${base}/soft/${encodeURIComponent(row.slug)}</guid><description>${escape(row.summary||row.description)}</description><pubDate>${new Date(row.updated_at).toUTCString()}</pubDate></item>`).join(""); res.writeHead(200,{"Content-Type":"application/rss+xml; charset=utf-8","Cache-Control":"public, max-age=900"}); return res.end(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escape(settings().site_name||"软件仓库")}</title><link>${base}/</link><description>${escape(settings().site_description)}</description>${items}</channel></rss>`);
  }
  if (req.method === "GET" && path === "/api/public/categories") {
    return json(res, 200, db.prepare("SELECT * FROM category WHERE status=1 ORDER BY sort_order,id").all());
  }
  if (req.method === "GET" && path === "/api/public/tags") {
    const tags = db.prepare("SELECT tags FROM software WHERE status='PUBLISHED'").all().flatMap(row=>parseJsonArray(row.tags)); return json(res,200,[...new Set(tags)].sort((a,b)=>a.localeCompare(b,"zh-CN")));
  }
  if (req.method === "GET" && path === "/api/public/announcements") {
    return json(res, 200, db.prepare("SELECT id,title,content,created_at FROM site_announcement WHERE status=1 ORDER BY sort_order,id DESC LIMIT 5").all());
  }
  if (req.method === "GET" && path === "/api/public/software") {
    applySchedules();
    const q = (url.searchParams.get("q") || "").trim();
    const category = url.searchParams.get("category") || "";
    const platform = url.searchParams.get("platform") || "";
    const tag = (url.searchParams.get("tag") || "").trim();
    const sort = ["updated", "downloads", "name"].includes(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "featured";
    const order = sort === "downloads" ? "s.download_count DESC,s.updated_at DESC" : sort === "name" ? "s.name COLLATE NOCASE ASC" : sort === "updated" ? "s.updated_at DESC,s.sort_order ASC" : "s.featured DESC,s.sort_order ASC,s.updated_at DESC";
    const rows = db.prepare(`SELECT s.*,c.name AS category_name,c.slug AS category_slug FROM software s LEFT JOIN category c ON c.id=s.category_id
      WHERE s.status='PUBLISHED' AND (?='' OR s.name LIKE ? OR s.summary LIKE ? OR s.description LIKE ? OR s.platforms LIKE ? OR s.tags LIKE ?) AND (?='' OR c.slug=?) AND (?='' OR s.platforms LIKE ?) AND (?='' OR s.tags LIKE ?) ORDER BY ${order}`)
      .all(q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, category, category, platform, `%${JSON.stringify(platform).slice(1, -1)}%`, tag, `%${JSON.stringify(tag).slice(1, -1)}%`);
    if (q && !rateLimited(req, "search-event", 60, 60_000)) db.prepare("INSERT INTO search_event(query,result_count,created_at) VALUES(?,?,?)").run(q.slice(0,120),rows.length,Date.now());
    return json(res, 200, rows.map(safeSoftware));
  }
  let m = routePattern(path, "/api/public/software/:slug");
  if (req.method === "GET" && m) {
    applySchedules();
    const row = db.prepare("SELECT s.*,c.name AS category_name FROM software s LEFT JOIN category c ON c.id=s.category_id WHERE s.slug=? AND s.status='PUBLISHED'").get(m.slug);
    if (!row) return json(res, 404, { error: "NOT_FOUND" });
    db.prepare("UPDATE software SET view_count=view_count+1 WHERE id=?").run(row.id);
    if (!rateLimited(req, "page-view", 120, 60_000)) db.prepare("INSERT INTO page_view(software_id,page_type,created_at) VALUES(?,?,?)").run(row.id,"SOFTWARE",Date.now());
    const channels = db.prepare("SELECT id,name,channel_type,require_purchase FROM download_link WHERE software_id=? AND status='ACTIVE' ORDER BY sort_order,id").all(row.id);
    const versions = db.prepare("SELECT id,version,file_size,changelog,created_at FROM software_version WHERE software_id=? AND status='ACTIVE' ORDER BY sort_order,id DESC").all(row.id).map(version => ({
      ...version,
      channels: db.prepare("SELECT id,name FROM version_download_link WHERE version_id=? AND status='ACTIVE' ORDER BY sort_order,id").all(version.id)
    }));
    return json(res, 200, { ...safeSoftware(row), channels, versions });
  }
  m = routePattern(path, "/api/public/download/:id/ticket");
  if (req.method === "POST" && m) {
    if (rateLimited(req, "ticket", 30, 60_000)) return json(res, 429, { error: "TOO_MANY_REQUESTS" });
    const link = db.prepare("SELECT dl.*,s.charge_type FROM download_link dl JOIN software s ON s.id=dl.software_id WHERE dl.id=? AND dl.status='ACTIVE' AND s.status='PUBLISHED'").get(Number(m.id));
    if (!link) return json(res, 404, { error: "NOT_FOUND" });
    if (link.require_purchase || link.charge_type === "PAID") return json(res, 402, { error: "PURCHASE_REQUIRED" });
    const token = randomBytes(24).toString("base64url");
    const now = Date.now();
    db.prepare("DELETE FROM download_ticket WHERE expires_at<=? OR used_at IS NOT NULL").run(now);
    const ticketSeconds = settingNumber("download_ticket_seconds", 300, 30, 3600);
    db.prepare("INSERT INTO download_ticket(token_hash,link_id,expires_at) VALUES(?,?,?)").run(tokenHash(token), link.id, now + ticketSeconds * 1000);
    return json(res, 200, { url: `/go/${token}`, expiresIn: ticketSeconds, extractCode: link.extract_code || "" });
  }
  m = routePattern(path, "/api/public/version-download/:id/ticket");
  if (req.method === "POST" && m) {
    if (rateLimited(req, "version-ticket", 30, 60_000)) return json(res, 429, { error: "TOO_MANY_REQUESTS" });
    const link = db.prepare(`SELECT vdl.* FROM version_download_link vdl
      JOIN software_version sv ON sv.id=vdl.version_id JOIN software s ON s.id=sv.software_id
      WHERE vdl.id=? AND vdl.status='ACTIVE' AND sv.status='ACTIVE' AND s.status='PUBLISHED'`).get(Number(m.id));
    if (!link) return json(res, 404, { error: "NOT_FOUND" });
    const token = randomBytes(24).toString("base64url");
    const now = Date.now();
    db.prepare("DELETE FROM version_download_ticket WHERE expires_at<=? OR used_at IS NOT NULL").run(now);
    const ticketSeconds = settingNumber("download_ticket_seconds", 300, 30, 3600);
    db.prepare("INSERT INTO version_download_ticket(token_hash,link_id,expires_at) VALUES(?,?,?)").run(tokenHash(token), link.id, now + ticketSeconds * 1000);
    return json(res, 200, { url: `/go-version/${token}`, expiresIn: ticketSeconds });
  }
  m = routePattern(path, "/go-version/:token");
  if (req.method === "GET" && m) {
    const now = Date.now();
    const hash = tokenHash(m.token);
    const ticket = db.prepare(`SELECT t.token_hash,t.link_id,vdl.target_url FROM version_download_ticket t
      JOIN version_download_link vdl ON vdl.id=t.link_id WHERE t.token_hash=? AND t.expires_at>? AND t.used_at IS NULL`).get(hash, now);
    if (!ticket) return json(res, 410, { error: "TICKET_EXPIRED" });
    const claimed = db.prepare("UPDATE version_download_ticket SET used_at=? WHERE token_hash=? AND expires_at>? AND used_at IS NULL").run(now, hash, now);
    if (claimed.changes !== 1) return json(res, 410, { error: "TICKET_EXPIRED" });
    res.writeHead(302, { Location: ticket.target_url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    return res.end();
  }
  m = routePattern(path, "/go/:token");
  if (req.method === "GET" && m) {
    const now = Date.now();
    const hash = tokenHash(m.token);
    const ticket = db.prepare(`SELECT t.token_hash,t.link_id,dl.target_url,dl.software_id FROM download_ticket t
      JOIN download_link dl ON dl.id=t.link_id WHERE t.token_hash=? AND t.expires_at>? AND t.used_at IS NULL`).get(hash, now);
    if (!ticket) return json(res, 410, { error: "TICKET_EXPIRED" });
    const claimed = db.prepare("UPDATE download_ticket SET used_at=? WHERE token_hash=? AND expires_at>? AND used_at IS NULL").run(now, hash, now);
    if (claimed.changes !== 1) return json(res, 410, { error: "TICKET_EXPIRED" });
    db.prepare("UPDATE software SET download_count=download_count+1 WHERE id=?").run(ticket.software_id);
    const recordMetadata = settings().record_download_metadata !== "0";
    db.prepare("INSERT INTO download_event(software_id,link_id,created_at,client_ip,user_agent) VALUES(?,?,?,?,?)")
      .run(ticket.software_id, ticket.link_id, now, recordMetadata ? clientAddress(req) : "", recordMetadata ? String(req.headers["user-agent"] || "").slice(0, 300) : "");
    res.writeHead(302, { Location: ticket.target_url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    return res.end();
  }
  if (req.method === "POST" && path === "/api/admin/login") {
    if (!sameOrigin(req)) return json(res, 403, { error: "ORIGIN_FORBIDDEN" });
    const loginLimit = settingNumber("login_attempt_limit", 10, 3, 100);
    const loginWindow = settingNumber("login_attempt_window_minutes", 15, 1, 1440);
    if (rateLimited(req, "login", loginLimit, loginWindow * 60_000)) return json(res, 429, { error: "TOO_MANY_REQUESTS" });
    const body = await readJson(req);
    const user = db.prepare("SELECT * FROM admin_user WHERE username=?").get(String(body.username || ""));
    if (!user || !verifyPassword(String(body.password || ""), user.password_hash)) return json(res, 401, { error: "INVALID_CREDENTIALS" });
    const token = randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM session WHERE expires_at<=?").run(Date.now());
    const sessionHours = settingNumber("session_hours", 12, 1, 720);
    const sessionSeconds = sessionHours * 3600;
    db.prepare("INSERT INTO session(token_hash,admin_id,expires_at) VALUES(?,?,?)").run(tokenHash(token), user.id, Date.now() + sessionSeconds * 1000);
    audit(req, user.id, "LOGIN", "admin_user", user.id, user.username);
    const secure = req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" ? "; Secure" : "";
    return json(res, 200, { ok: true }, { "Set-Cookie": `softwarehub_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionSeconds}${secure}` });
  }
  if (path.startsWith("/api/admin/") && !sameOrigin(req)) return json(res, 403, { error: "ORIGIN_FORBIDDEN" });
  if (req.method === "POST" && path === "/api/admin/logout") {
    const token = parseCookie(req).softwarehub_session;
    if (token) db.prepare("DELETE FROM session WHERE token_hash=?").run(tokenHash(token));
    return json(res, 200, { ok: true }, { "Set-Cookie": "softwarehub_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" });
  }
  if (req.method === "GET" && path === "/api/admin/me") {
    const adminId = getAdmin(req);
    if (!adminId) return json(res, 401, { error: "UNAUTHORIZED" });
    const admin = db.prepare("SELECT username FROM admin_user WHERE id=?").get(adminId);
    return json(res, 200, { username: admin?.username || "admin" });
  }
  if (req.method === "GET" && path === "/api/admin/software") {
    if (!requireAdmin(req, res)) return;
    applySchedules();
    return json(res, 200, db.prepare("SELECT s.*,c.name AS category_name FROM software s LEFT JOIN category c ON c.id=s.category_id ORDER BY s.sort_order ASC,s.updated_at DESC").all().map(safeSoftware));
  }
  if (req.method === "GET" && path === "/api/admin/tags") {
    if (!requireAdmin(req, res)) return;
    const tags = db.prepare("SELECT tags FROM software").all().flatMap(row=>parseJsonArray(row.tags)); return json(res,200,[...new Set(tags)].sort((a,b)=>a.localeCompare(b,"zh-CN")));
  }
  if (req.method === "GET" && path === "/api/admin/categories") {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, db.prepare("SELECT * FROM category ORDER BY sort_order,id").all());
  }
  if (req.method === "POST" && path === "/api/admin/categories") {
    const adminId = requireAdmin(req, res); if (!adminId) return;
    const b = await readJson(req);
    if (!b.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(b.slug || ""))) return json(res, 400, { error: "INVALID_CATEGORY" });
    const result = db.prepare("INSERT INTO category(name,slug,sort_order,status) VALUES(?,?,?,?)").run(String(b.name).trim(), String(b.slug).trim(), Number(b.sortOrder || 0), b.status === false ? 0 : 1);
    audit(req,adminId,"CREATE","category",result.lastInsertRowid,String(b.name).trim()); return json(res, 201, { id: Number(result.lastInsertRowid) });
  }
  m = routePattern(path, "/api/admin/categories/:id");
  if (req.method === "PUT" && m) {
    if (!requireAdmin(req, res)) return;
    const b = await readJson(req);
    if (!b.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(b.slug || ""))) return json(res, 400, { error: "INVALID_CATEGORY" });
    const result = db.prepare("UPDATE category SET name=?,slug=?,sort_order=?,status=? WHERE id=?").run(String(b.name).trim(), String(b.slug).trim(), Number(b.sortOrder || 0), b.status === false ? 0 : 1, Number(m.id));
    return result.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: "NOT_FOUND" });
  }
  if (req.method === "DELETE" && m) {
    if (!requireAdmin(req, res)) return;
    const used = db.prepare("SELECT COUNT(*) AS total FROM software WHERE category_id=?").get(Number(m.id));
    if (used.total) return json(res, 409, { error: "CATEGORY_IN_USE" });
    const result = db.prepare("DELETE FROM category WHERE id=?").run(Number(m.id));
    return result.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: "NOT_FOUND" });
  }
  if (req.method === "GET" && path === "/api/admin/statistics") {
    if (!requireAdmin(req, res)) return;
    const since = Date.now() - 30 * 24 * 3600_000;
    const overview = {
      software: db.prepare("SELECT COUNT(*) AS total FROM software").get().total,
      published: db.prepare("SELECT COUNT(*) AS total FROM software WHERE status='PUBLISHED'").get().total,
      downloads: db.prepare("SELECT COALESCE(SUM(download_count),0) AS total FROM software").get().total,
      downloads30d: db.prepare("SELECT COUNT(*) AS total FROM download_event WHERE created_at>=?").get(since).total
    };
    const popular = db.prepare(`SELECT s.id,s.name,s.slug,s.cover_image,s.download_count,COUNT(e.id) AS recent_downloads
      FROM software s LEFT JOIN download_event e ON e.software_id=s.id AND e.created_at>=?
      GROUP BY s.id ORDER BY recent_downloads DESC,s.download_count DESC,s.name LIMIT 8`).all(since);
    const recent = db.prepare("SELECT id,name,slug,cover_image,version,updated_at,status FROM software ORDER BY updated_at DESC,id DESC LIMIT 8").all();
    const channels = db.prepare(`SELECT dl.channel_type,COUNT(e.id) AS downloads FROM download_event e JOIN download_link dl ON dl.id=e.link_id
      WHERE e.created_at>=? GROUP BY dl.channel_type ORDER BY downloads DESC`).all(since);
    const chinaToday = chinaDateParts();
    const series = [];
    for (let index = 29; index >= 0; index -= 1) {
      const date = new Date(Date.UTC(chinaToday.year, chinaToday.month - 1, chinaToday.day - index));
      const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1, day = date.getUTCDate();
      const start = chinaDayStart(year, month, day);
      const end = start + 24 * 3600_000;
      series.push({ date: chinaDateLabel(year, month, day), downloads: db.prepare("SELECT COUNT(*) AS total FROM download_event WHERE created_at>=? AND created_at<?").get(start, end).total });
    }
    const downloads = db.prepare(`SELECT e.id,e.created_at,e.client_ip,e.user_agent,s.name AS software_name,s.slug AS software_slug,dl.name AS channel_name,dl.channel_type
      FROM download_event e JOIN software s ON s.id=e.software_id JOIN download_link dl ON dl.id=e.link_id ORDER BY e.created_at DESC,e.id DESC LIMIT 80`).all();
    const searches = db.prepare("SELECT query,COUNT(*) AS searches,SUM(CASE WHEN result_count=0 THEN 1 ELSE 0 END) AS no_results,MAX(created_at) AS last_at FROM search_event GROUP BY query ORDER BY searches DESC,last_at DESC LIMIT 50").all();
    const views = db.prepare("SELECT s.id,s.name,s.slug,COUNT(v.id) AS views FROM page_view v JOIN software s ON s.id=v.software_id WHERE v.created_at>=? GROUP BY s.id ORDER BY views DESC LIMIT 20").all(since);
    return json(res, 200, { overview, popular, recent, channels, series, downloads, searches, views });
  }
  if (req.method === "POST" && path === "/api/admin/software/import") {
    const adminId=requireAdmin(req,res);if(!adminId)return; const body=await readJson(req); const rawItems=Array.isArray(body.items)?body.items:typeof body.csv==="string"?parseCsv(body.csv):[]; const items=rawItems.map(item=>({...item,platforms:Array.isArray(item.platforms)?item.platforms:String(item.platforms||"").split(/[|,]/).map(x=>x.trim()).filter(Boolean),tags:Array.isArray(item.tags)?item.tags:String(item.tags||"").split(/[|,]/).map(x=>x.trim()).filter(Boolean)})); if(items.length>200)return json(res,413,{error:"TOO_MANY_ITEMS"}); const created=[]; try { db.exec("BEGIN IMMEDIATE"); for(const item of items){ if(!item.name||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(item.slug||"")))continue; const status=["DRAFT","PUBLISHED","OFFLINE"].includes(item.status)?item.status:"DRAFT"; const info=db.prepare("INSERT INTO software(name,slug,version,platforms,summary,description,status,featured,sort_order,tags,download_note) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(String(item.name).trim(),String(item.slug).trim(),String(item.version||""),JSON.stringify(sanitizePlatforms(item.platforms)),String(item.summary||""),String(item.description||""),status,item.featured?1:0,Number(item.sortOrder||0),JSON.stringify(normalizeTags(item.tags)),limitedText(item.downloadNote,1200)); const softwareId=Number(info.lastInsertRowid); if(Array.isArray(item.links))for(const link of item.links){const target=validateHttpUrl(link.targetUrl||link.target_url);if(target&&link.name)db.prepare("INSERT INTO download_link(software_id,name,channel_type,target_url,extract_code,sort_order,status) VALUES(?,?,?,?,?,?,?)").run(softwareId,String(link.name).slice(0,120),["OFFICIAL","DIRECT","BAIDU","QUARK","ALIYUN"].includes(link.channelType||link.channel_type)?(link.channelType||link.channel_type):"DIRECT",target.href,String(link.extractCode||link.extract_code||""),Number(link.sortOrder||link.sort_order||0),"ACTIVE")} created.push(softwareId); } db.exec("COMMIT"); } catch(error){try{db.exec("ROLLBACK")}catch{};return json(res,400,{error:"IMPORT_FAILED",detail:String(error.message||"").slice(0,160)})} audit(req,adminId,"IMPORT","software","",`导入 ${created.length} 个应用`); return json(res,200,{created});
  }
  if (req.method === "POST" && path === "/api/admin/software/bulk") {
    const adminId = requireAdmin(req, res); if (!adminId) return;
    const b = await readJson(req);
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
    if (!ids.length) return json(res, 400, { error: "NO_ITEMS" });
    if (b.categoryId !== undefined && b.categoryId !== null && (!Number.isInteger(Number(b.categoryId)) || !db.prepare("SELECT id FROM category WHERE id=?").get(Number(b.categoryId)))) return json(res, 400, { error: "INVALID_CATEGORY" });
    const marks = ids.map(() => "?").join(",");
    const fields = [];
    try {
      db.exec("BEGIN IMMEDIATE");
      if (["PUBLISHED", "DRAFT", "OFFLINE"].includes(b.status)) { db.prepare(`UPDATE software SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id IN (${marks})`).run(b.status, ...ids); fields.push("status"); }
      if (typeof b.featured === "boolean") { db.prepare(`UPDATE software SET featured=?,updated_at=CURRENT_TIMESTAMP WHERE id IN (${marks})`).run(b.featured ? 1 : 0, ...ids); fields.push("featured"); }
      if (b.categoryId !== undefined) { db.prepare(`UPDATE software SET category_id=?,updated_at=CURRENT_TIMESTAMP WHERE id IN (${marks})`).run(b.categoryId || null, ...ids); fields.push("category"); }
      if (b.delete === true) { db.prepare(`DELETE FROM software WHERE id IN (${marks})`).run(...ids); fields.push("delete"); }
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      console.error("Bulk software update failed", error);
      return json(res, 400, { error: "BULK_UPDATE_FAILED" });
    }
    audit(req, adminId, "BULK", "software", ids.join(","), fields.join(","));
    return json(res, 200, { ok: true, count: ids.length, fields });
  }
  if (req.method === "POST" && path === "/api/admin/software") {
    const adminId = requireAdmin(req, res); if (!adminId) return;
    const b = await readJson(req);
    if (!b.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(b.slug || ""))) return json(res, 400, { error: "INVALID_NAME_OR_SLUG" });
    const status = ["DRAFT", "PUBLISHED", "OFFLINE"].includes(b.status) ? b.status : "DRAFT";
    const chargeType = ["FREE", "PAID"].includes(b.chargeType) ? b.chargeType : "FREE";
    const maintenanceStatus = allowedMaintenance.includes(b.maintenanceStatus) ? b.maintenanceStatus : "MAINTAINED";
    const info = db.prepare(`INSERT INTO software(category_id,name,slug,version,platforms,file_size,summary,description,tutorial,changelog,cover_image,screenshots,charge_type,price_cents,status,featured,sort_order,seo_title,seo_description,seo_keywords,og_title,og_description,og_image,maintenance_status,maintenance_note,download_note,tags,publish_at,unpublish_at,unfeature_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
      .run(b.categoryId || null, b.name, b.slug, b.version || "", JSON.stringify(sanitizePlatforms(b.platforms)), b.fileSize || "", b.summary || "", b.description || "", b.tutorial || "", b.changelog || "", b.coverImage || "", JSON.stringify(b.screenshots || []), chargeType, Math.max(0, Number(b.priceCents || 0)), status, b.featured ? 1 : 0, Number(b.sortOrder || 0), b.seoTitle || "", b.seoDescription || "", b.seoKeywords || "", b.ogTitle || "", b.ogDescription || "", b.ogImage || "", maintenanceStatus, limitedText(b.maintenanceNote, 300), limitedText(b.downloadNote, 1200), JSON.stringify((Array.isArray(b.tags)?b.tags:[]).map(x=>limitedText(x,40)).filter(Boolean).slice(0,20)), normalizeSchedule(b.publishAt), normalizeSchedule(b.unpublishAt), normalizeSchedule(b.unfeatureAt));
    audit(req,adminId,"CREATE","software",info.lastInsertRowid,String(b.name).trim()); return json(res, 201, { id: Number(info.lastInsertRowid) });
  }
  m = routePattern(path, "/api/admin/software/:id/duplicate");
  if (req.method === "POST" && m) { const adminId=requireAdmin(req,res);if(!adminId)return; const source=db.prepare("SELECT * FROM software WHERE id=?").get(Number(m.id));if(!source)return json(res,404,{error:"NOT_FOUND"}); const slug=`${source.slug}-copy-${Date.now().toString(36).slice(-5)}`; const info=db.prepare("INSERT INTO software(category_id,name,slug,version,platforms,file_size,summary,description,tutorial,changelog,cover_image,screenshots,charge_type,price_cents,status,featured,sort_order,seo_title,seo_description,seo_keywords,og_title,og_description,og_image,maintenance_status,maintenance_note,download_note,tags,publish_at,unpublish_at,unfeature_at) SELECT category_id,name||' 副本',?,version,platforms,file_size,summary,description,tutorial,changelog,cover_image,screenshots,charge_type,price_cents,'DRAFT',0,sort_order,seo_title,seo_description,seo_keywords,og_title,og_description,og_image,maintenance_status,maintenance_note,download_note,tags,'','','' FROM software WHERE id=?").run(slug,source.id);audit(req,adminId,"DUPLICATE","software",info.lastInsertRowid,source.name);return json(res,201,{id:Number(info.lastInsertRowid),slug}); }
  m = routePattern(path, "/api/admin/software/:id");
  if (req.method === "PUT" && m) {
    const adminId = requireAdmin(req, res); if (!adminId) return;
    const b = await readJson(req);
    if (!b.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(b.slug || ""))) return json(res, 400, { error: "INVALID_NAME_OR_SLUG" });
    const status = ["DRAFT", "PUBLISHED", "OFFLINE"].includes(b.status) ? b.status : "DRAFT";
    const chargeType = ["FREE", "PAID"].includes(b.chargeType) ? b.chargeType : "FREE";
    const maintenanceStatus = allowedMaintenance.includes(b.maintenanceStatus) ? b.maintenanceStatus : "MAINTAINED";
    const result = db.prepare(`UPDATE software SET category_id=?,name=?,slug=?,version=?,platforms=?,file_size=?,summary=?,description=?,tutorial=?,changelog=?,cover_image=?,screenshots=?,charge_type=?,price_cents=?,status=?,featured=?,sort_order=?,seo_title=?,seo_description=?,seo_keywords=?,og_title=?,og_description=?,og_image=?,maintenance_status=?,maintenance_note=?,download_note=?,tags=?,publish_at=?,unpublish_at=?,unfeature_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(b.categoryId || null, b.name, b.slug, b.version || "", JSON.stringify(sanitizePlatforms(b.platforms)), b.fileSize || "", b.summary || "", b.description || "", b.tutorial || "", b.changelog || "", b.coverImage || "", JSON.stringify(b.screenshots || []), chargeType, Math.max(0, Number(b.priceCents || 0)), status, b.featured ? 1 : 0, Number(b.sortOrder || 0), b.seoTitle || "", b.seoDescription || "", b.seoKeywords || "", b.ogTitle || "", b.ogDescription || "", b.ogImage || "", maintenanceStatus, limitedText(b.maintenanceNote, 300), limitedText(b.downloadNote, 1200), JSON.stringify((Array.isArray(b.tags)?b.tags:[]).map(x=>limitedText(x,40)).filter(Boolean).slice(0,20)), normalizeSchedule(b.publishAt), normalizeSchedule(b.unpublishAt), normalizeSchedule(b.unfeatureAt), Number(m.id));
    if (!result.changes) return json(res, 404, { error: "NOT_FOUND" });
    audit(req,adminId,"UPDATE","software",m.id,String(b.name).trim()); return json(res, 200, { ok: true });
  }
  if (req.method === "DELETE" && m) {
    const adminId = requireAdmin(req, res); if (!adminId) return;
    const result = db.prepare("DELETE FROM software WHERE id=?").run(Number(m.id));
    if (!result.changes) return json(res, 404, { error: "NOT_FOUND" });
    audit(req,adminId,"DELETE","software",m.id); return json(res, 200, { ok: true });
  }
  m = routePattern(path, "/api/admin/software/:id/preview");
  if (req.method === "GET" && m) {
    if (!requireAdmin(req, res)) return;
    const row = db.prepare("SELECT s.*,c.name AS category_name,c.slug AS category_slug FROM software s LEFT JOIN category c ON c.id=s.category_id WHERE s.id=?").get(Number(m.id));
    if (!row) return json(res, 404, { error: "NOT_FOUND" });
    const channels = db.prepare("SELECT id,name,channel_type,require_purchase FROM download_link WHERE software_id=? AND status='ACTIVE' ORDER BY sort_order,id").all(row.id);
    const versions = db.prepare("SELECT id,version,file_size,changelog,created_at FROM software_version WHERE software_id=? AND status='ACTIVE' ORDER BY sort_order,id DESC").all(row.id).map(version => ({ ...version, channels: db.prepare("SELECT id,name FROM version_download_link WHERE version_id=? AND status='ACTIVE' ORDER BY sort_order,id").all(version.id) }));
    return json(res, 200, { ...safeSoftware(row), channels, versions, preview: true });
  }
  m = routePattern(path, "/api/admin/software/:id/links");
  if (req.method === "GET" && m) {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, db.prepare("SELECT * FROM download_link WHERE software_id=? ORDER BY sort_order,id").all(Number(m.id)));
  }
  m = routePattern(path, "/api/admin/software/:id/versions");
  if (req.method === "GET" && m) {
    if (!requireAdmin(req, res)) return;
    const versions = db.prepare("SELECT * FROM software_version WHERE software_id=? ORDER BY sort_order,id DESC").all(Number(m.id));
    return json(res, 200, versions.map(version => ({ ...version, links: db.prepare("SELECT * FROM version_download_link WHERE version_id=? ORDER BY sort_order,id").all(version.id) })));
  }
  if (req.method === "POST" && m) {
    if (!requireAdmin(req, res)) return;
    const b = await readJson(req);
    if (!String(b.version || "").trim()) return json(res, 400, { error: "INVALID_VERSION" });
    const status = ["ACTIVE", "DISABLED"].includes(b.status) ? b.status : "ACTIVE";
    const info = db.prepare("INSERT INTO software_version(software_id,version,file_size,changelog,status,sort_order) VALUES(?,?,?,?,?,?)")
      .run(Number(m.id), String(b.version).trim(), String(b.fileSize || ""), String(b.changelog || ""), status, Number(b.sortOrder || 0));
    return json(res, 201, { id: Number(info.lastInsertRowid) });
  }
  m = routePattern(path, "/api/admin/software/:softwareId/versions/:versionId");
  if (req.method === "PUT" && m) {
    if (!requireAdmin(req, res)) return;
    const b = await readJson(req);
    if (!String(b.version || "").trim()) return json(res, 400, { error: "INVALID_VERSION" });
    const status = ["ACTIVE", "DISABLED"].includes(b.status) ? b.status : "ACTIVE";
    const result = db.prepare("UPDATE software_version SET version=?,file_size=?,changelog=?,status=?,sort_order=? WHERE id=? AND software_id=?")
      .run(String(b.version).trim(), String(b.fileSize || ""), String(b.changelog || ""), status, Number(b.sortOrder || 0), Number(m.versionId), Number(m.softwareId));
    return result.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: "NOT_FOUND" });
  }
  if (req.method === "DELETE" && m) {
    if (!requireAdmin(req, res)) return;
    const result = db.prepare("DELETE FROM software_version WHERE id=? AND software_id=?").run(Number(m.versionId), Number(m.softwareId));
    return result.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: "NOT_FOUND" });
  }
  m = routePattern(path, "/api/admin/versions/:versionId/links");
  if (req.method === "POST" && m) {
    if (!requireAdmin(req, res)) return;
    const b = await readJson(req);
    const target = validateHttpUrl(b.targetUrl);
    if (!String(b.name || "").trim() || !target) return json(res, 400, { error: "INVALID_DOWNLOAD_LINK" });
    const info = db.prepare("INSERT INTO version_download_link(version_id,name,target_url,sort_order,status) VALUES(?,?,?,?,?)")
      .run(Number(m.versionId), String(b.name).trim(), target.href, Number(b.sortOrder || 0), ["ACTIVE", "DISABLED"].includes(b.status) ? b.status : "ACTIVE");
    return json(res, 201, { id: Number(info.lastInsertRowid) });
  }
  m = routePattern(path, "/api/admin/versions/:versionId/links/:linkId");
  if (req.method === "DELETE" && m) {
    if (!requireAdmin(req, res)) return;
    const result = db.prepare("DELETE FROM version_download_link WHERE id=? AND version_id=?").run(Number(m.linkId), Number(m.versionId));
    return result.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: "NOT_FOUND" });
  }
  m = routePattern(path, "/api/admin/software/:id/links");
  if (req.method === "POST" && m) {
    if (!requireAdmin(req, res)) return;
    const b = await readJson(req);
    if (!b.name || !b.targetUrl || !["OFFICIAL", "DIRECT", "BAIDU", "QUARK", "ALIYUN"].includes(b.channelType)) return json(res, 400, { error: "INVALID_DOWNLOAD_LINK" });
    const targetUrl = validateHttpUrl(b.targetUrl);
    if (!targetUrl) return json(res, 400, { error: "INVALID_DOWNLOAD_URL" });
    const status = ["ACTIVE", "DISABLED"].includes(b.status) ? b.status : "ACTIVE";
    const info = db.prepare("INSERT INTO download_link(software_id,name,channel_type,target_url,extract_code,require_purchase,sort_order,status) VALUES(?,?,?,?,?,?,?,?)")
      .run(Number(m.id), String(b.name).trim(), b.channelType, targetUrl.href, b.extractCode || "", b.requirePurchase ? 1 : 0, Number(b.sortOrder || 0), status);
    return json(res, 201, { id: Number(info.lastInsertRowid) });
  }
  m = routePattern(path, "/api/admin/software/:softwareId/links/:linkId");
  if (req.method === "PUT" && m) {
    if (!requireAdmin(req, res)) return;
    const b = await readJson(req);
    if (!b.name || !["OFFICIAL", "DIRECT", "BAIDU", "QUARK", "ALIYUN"].includes(b.channelType)) return json(res, 400, { error: "INVALID_DOWNLOAD_LINK" });
    const targetUrl = validateHttpUrl(b.targetUrl);
    if (!targetUrl) return json(res, 400, { error: "INVALID_DOWNLOAD_URL" });
    const status = ["ACTIVE", "DISABLED"].includes(b.status) ? b.status : "ACTIVE";
    const result = db.prepare("UPDATE download_link SET name=?,channel_type=?,target_url=?,extract_code=?,require_purchase=?,sort_order=?,status=? WHERE id=? AND software_id=?")
      .run(String(b.name).trim(), b.channelType, targetUrl.href, b.extractCode || "", b.requirePurchase ? 1 : 0, Number(b.sortOrder || 0), status, Number(m.linkId), Number(m.softwareId));
    return result.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: "NOT_FOUND" });
  }
  if (req.method === "DELETE" && m) {
    if (!requireAdmin(req, res)) return;
    const result = db.prepare("DELETE FROM download_link WHERE id=? AND software_id=?").run(Number(m.linkId), Number(m.softwareId));
    return result.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: "NOT_FOUND" });
  }
  m = routePattern(path, "/api/admin/software/:softwareId/links/:linkId/check");
  if (req.method === "POST" && m) {
    if (!requireAdmin(req, res)) return;
    const link = db.prepare("SELECT * FROM download_link WHERE id=? AND software_id=?").get(Number(m.linkId), Number(m.softwareId));
    if (!link) return json(res, 404, { error: "NOT_FOUND" });
    return json(res, 200, await inspectDownloadLink(link));
  }
  if (req.method === "POST" && path === "/api/admin/upload") {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req);
    const match = String(body.dataUrl || "").match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return json(res, 400, { error: "INVALID_IMAGE" });
    const data = Buffer.from(match[2], "base64");
    if (!data.length || data.length > 2 * 1024 * 1024) return json(res, 413, { error: "IMAGE_TOO_LARGE" });
    const extension = match[1] === "jpeg" ? "jpg" : match[1];
    if (!validImage(data, extension)) return json(res, 400, { error: "INVALID_IMAGE_CONTENT" });
    const fileName = `${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
    await writeFile(join(DATA_DIR, "uploads", fileName), data, { mode: 0o600 });
    return json(res, 201, { url: `/uploads/${fileName}` });
  }
  if (req.method === "GET" && path === "/api/admin/slides") {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, db.prepare("SELECT * FROM homepage_slide ORDER BY sort_order,id").all());
  }
  if (req.method === "POST" && path === "/api/admin/slides") {
    const adminId = requireAdmin(req, res); if (!adminId) return;
    const b = await readJson(req); const targetType = ["CATEGORY","URL","NONE"].includes(b.targetType) ? b.targetType : "NONE";
    if (!String(b.title || "").trim()) return json(res,400,{error:"INVALID_SLIDE"});
    if (targetType === "URL" && b.targetValue && !validateHttpUrl(b.targetValue)) return json(res,400,{error:"INVALID_TARGET"});
    const info = db.prepare("INSERT INTO homepage_slide(image_url,kicker,title,content,target_type,target_value,status,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(String(b.imageUrl||""),String(b.kicker||"").slice(0,80),String(b.title).trim().slice(0,120),String(b.content||"").slice(0,500),targetType,String(b.targetValue||"").slice(0,1000),b.status===false?0:1,Number(b.sortOrder||0));
    audit(req,adminId,"CREATE","homepage_slide",info.lastInsertRowid,String(b.title).trim()); return json(res,201,{id:Number(info.lastInsertRowid)});
  }
  m = routePattern(path, "/api/admin/slides/:id");
  if (req.method === "PUT" && m) {
    const adminId = requireAdmin(req, res); if (!adminId) return;
    const b = await readJson(req); const targetType = ["CATEGORY","URL","NONE"].includes(b.targetType) ? b.targetType : "NONE";
    if (!String(b.title || "").trim()) return json(res,400,{error:"INVALID_SLIDE"});
    if (targetType === "URL" && b.targetValue && !validateHttpUrl(b.targetValue)) return json(res,400,{error:"INVALID_TARGET"});
    const result=db.prepare("UPDATE homepage_slide SET image_url=?,kicker=?,title=?,content=?,target_type=?,target_value=?,status=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(b.imageUrl||""),String(b.kicker||"").slice(0,80),String(b.title).trim().slice(0,120),String(b.content||"").slice(0,500),targetType,String(b.targetValue||"").slice(0,1000),b.status===false?0:1,Number(b.sortOrder||0),Number(m.id));
    if(!result.changes)return json(res,404,{error:"NOT_FOUND"}); audit(req,adminId,"UPDATE","homepage_slide",m.id,String(b.title).trim()); return json(res,200,{ok:true});
  }
  if (req.method === "DELETE" && m) { const adminId=requireAdmin(req,res);if(!adminId)return;const result=db.prepare("DELETE FROM homepage_slide WHERE id=?").run(Number(m.id));if(!result.changes)return json(res,404,{error:"NOT_FOUND"});audit(req,adminId,"DELETE","homepage_slide",m.id);return json(res,200,{ok:true}); }
  if (req.method === "GET" && path === "/api/admin/announcements") {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, db.prepare("SELECT * FROM site_announcement ORDER BY sort_order,id DESC").all());
  }
  if (req.method === "POST" && path === "/api/admin/announcements") {
    if (!requireAdmin(req, res)) return;
    const b = await readJson(req);
    if (!String(b.title || "").trim()) return json(res, 400, { error: "INVALID_ANNOUNCEMENT" });
    const info = db.prepare("INSERT INTO site_announcement(title,content,status,sort_order,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)")
      .run(String(b.title).trim().slice(0, 120), String(b.content || "").slice(0, 1000), b.status === false ? 0 : 1, Number(b.sortOrder || 0));
    return json(res, 201, { id: Number(info.lastInsertRowid) });
  }
  m = routePattern(path, "/api/admin/announcements/:id");
  if (req.method === "PUT" && m) {
    if (!requireAdmin(req, res)) return;
    const b = await readJson(req);
    if (!String(b.title || "").trim()) return json(res, 400, { error: "INVALID_ANNOUNCEMENT" });
    const result = db.prepare("UPDATE site_announcement SET title=?,content=?,status=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(String(b.title).trim().slice(0, 120), String(b.content || "").slice(0, 1000), b.status === false ? 0 : 1, Number(b.sortOrder || 0), Number(m.id));
    return result.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: "NOT_FOUND" });
  }
  if (req.method === "DELETE" && m) {
    if (!requireAdmin(req, res)) return;
    const result = db.prepare("DELETE FROM site_announcement WHERE id=?").run(Number(m.id));
    return result.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: "NOT_FOUND" });
  }
  if (req.method === "GET" && path === "/api/admin/backup") {
    if (!requireAdmin(req, res)) return;
    const tables = ["category", "software", "download_link", "software_version", "version_download_link", "site_announcement", "homepage_slide", "site_setting", "download_event", "search_event", "page_view"];
    const data = Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
    return json(res, 200, { schema: "softwarehub-backup", version: 2, exportedAt: new Date().toISOString(), data });
  }
  if (req.method === "POST" && path === "/api/admin/links/check-all") {
    const adminId=requireAdmin(req,res);if(!adminId)return; const links=db.prepare("SELECT * FROM download_link WHERE status<>'DISABLED' ORDER BY id").all(); const results=[]; for(const link of links)results.push(await inspectDownloadLink(link)); audit(req,adminId,"CHECK","download_link","all",`巡检 ${results.length} 个链接`); return json(res,200,{results});
  }
  if (req.method === "POST" && path === "/api/admin/backup/archive") {
    const adminId = requireAdmin(req, res); if (!adminId) return;
    const tables = ["category", "software", "download_link", "software_version", "version_download_link", "site_announcement", "homepage_slide", "site_setting", "download_event", "search_event", "page_view"];
    const backup = { schema: "softwarehub-backup", version: 2, exportedAt: new Date().toISOString(), data: Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()])) };
    const name = `softwarehub-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
    await writeFile(join(DATA_DIR, "backups", name), JSON.stringify(backup), { mode: 0o600 });
    const retention = settingNumber("backup_retention_count", 10, 1, 100);
    const archives = readdirSync(join(DATA_DIR,"backups"),{withFileTypes:true}).filter(item=>item.isFile()&&item.name.endsWith(".json")).map(item=>({name:item.name,mtime:statSync(join(DATA_DIR,"backups",item.name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);
    await Promise.all(archives.slice(retention).map(item=>unlink(join(DATA_DIR,"backups",item.name))));
    audit(req,adminId,"CREATE","backup",name,"创建本地备份"); return json(res,200,{ok:true,name,kept:Math.min(archives.length,retention)});
  }
  if (req.method === "POST" && path === "/api/admin/restore") {
    if (!requireAdmin(req, res)) return;
    const backup = await readJson(req, 50 * 1024 * 1024);
    const data = backup?.data;
    const requiredTables = ["category", "software", "download_link", "software_version", "version_download_link", "site_announcement", "homepage_slide", "site_setting", "download_event"];
    if (backup?.schema !== "softwarehub-backup" || backup?.version !== 2 || !data || requiredTables.some(table => !Array.isArray(data[table]))) return json(res, 400, { error: "INVALID_BACKUP" });
    data.search_event = Array.isArray(data.search_event) ? data.search_event : [];
    data.page_view = Array.isArray(data.page_view) ? data.page_view : [];
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec("DELETE FROM version_download_ticket; DELETE FROM download_ticket; DELETE FROM search_event; DELETE FROM page_view; DELETE FROM download_event; DELETE FROM version_download_link; DELETE FROM software_version; DELETE FROM download_link; DELETE FROM site_announcement; DELETE FROM homepage_slide; DELETE FROM software; DELETE FROM category; DELETE FROM site_setting;");
      const insert = (table, row) => {
        const keys = Object.keys(row);
        const statement = db.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`);
        statement.run(...keys.map(key => row[key]));
      };
      for (const row of data.category) insert("category", row);
      for (const row of data.software) insert("software", row);
      for (const row of data.download_link) insert("download_link", row);
      for (const row of data.software_version) insert("software_version", row);
      for (const row of data.version_download_link) insert("version_download_link", row);
      for (const row of data.site_announcement) insert("site_announcement", row);
      for (const row of data.homepage_slide) insert("homepage_slide", row);
      for (const row of data.site_setting) insert("site_setting", row);
      for (const row of data.download_event) insert("download_event", row);
      for (const row of data.search_event || []) insert("search_event", row);
      for (const row of data.page_view || []) insert("page_view", row);
      db.exec("COMMIT");
      return json(res, 200, { ok: true });
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      console.error("Backup restore failed", error);
      return json(res, 400, { error: "RESTORE_FAILED" });
    }
  }
  if (req.method === "GET" && path === "/api/admin/settings") {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, settings());
  }
  if (req.method === "PUT" && path === "/api/admin/settings") {
    const adminId = requireAdmin(req, res); if (!adminId) return;
    const b = await readJson(req);
    const allowed = ["site_name","site_description","site_logo","site_seo_keywords","footer_copyright","footer_icp","footer_links","contact_email","contact_github","feedback_url","donation_wechat","donation_alipay","homepage_sections","homepage_show_announcements","homepage_show_carousel","homepage_show_recommended","homepage_show_updated","homepage_show_categories","homepage_category_limit","homepage_recommended_limit","homepage_updated_limit","default_download_note","download_disclaimer","download_ticket_seconds","record_download_metadata","session_hours","login_attempt_limit","login_attempt_window_minutes","backup_retention_count","link_auto_disable","link_failure_threshold","link_check_interval_hours"];
    const stmt = db.prepare("INSERT INTO site_setting(setting_key,setting_value) VALUES(?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value");
    for (const key of allowed) if (key in b) stmt.run(key, String(b[key] ?? "").slice(0, key.includes("note") || key.includes("disclaimer") ? 2000 : 1000));
    audit(req, adminId, "UPDATE", "site_setting", "", "更新站点配置");
    restartLinkCheckTimer();
    return json(res, 200, { ok: true });
  }
  if (req.method === "PUT" && path === "/api/admin/account") {
    const adminId = requireAdmin(req, res); if (!adminId) return;
    const b = await readJson(req);
    const currentPassword = String(b.currentPassword || "");
    const nextUsername = String(b.username || "").trim();
    const nextPassword = String(b.newPassword || "");
    const admin = db.prepare("SELECT * FROM admin_user WHERE id=?").get(adminId);
    if (!admin || !verifyPassword(currentPassword, admin.password_hash)) return json(res, 400, { error: "CURRENT_PASSWORD_INVALID" });
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(nextUsername) || nextPassword && (nextPassword.length < 8 || nextPassword.length > 128)) return json(res, 400, { error: "INVALID_ACCOUNT" });
    try { db.prepare("UPDATE admin_user SET username=?,password_hash=? WHERE id=?").run(nextUsername, nextPassword ? passwordHash(nextPassword) : admin.password_hash, adminId); }
    catch { return json(res, 409, { error: "USERNAME_TAKEN" }); }
    audit(req, adminId, "UPDATE", "admin_user", adminId, "修改管理员账户");
    return json(res, 200, { ok: true });
  }
  if (req.method === "GET" && path === "/api/admin/audit-logs") {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, db.prepare("SELECT l.*,u.username FROM admin_audit_log l LEFT JOIN admin_user u ON u.id=l.admin_id ORDER BY l.created_at DESC,l.id DESC LIMIT 200").all());
  }
  if (req.method === "GET" && path === "/api/admin/downloads.csv") {
    if (!requireAdmin(req, res)) return;
    const rows = db.prepare("SELECT e.created_at,s.name AS software_name,s.slug,dl.name AS channel_name,dl.channel_type,e.client_ip,e.user_agent FROM download_event e JOIN software s ON s.id=e.software_id JOIN download_link dl ON dl.id=e.link_id ORDER BY e.created_at DESC,e.id DESC").all();
    const quote = value => `\"${String(value ?? "").replaceAll("\"", "\"\"")}\"`;
    const csv = ["时间,软件,固定链接,通道,类型,来源IP,浏览器", ...rows.map(row => [new Date(row.created_at).toLocaleString("zh-CN", { hour12: false }),row.software_name,row.slug,row.channel_name,row.channel_type,row.client_ip,row.user_agent].map(quote).join(","))].join("\r\n");
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=softwarehub-downloads.csv", "Cache-Control": "no-store" }); return res.end(`\uFEFF${csv}`);
  }
  if (req.method === "GET" && path === "/api/admin/media") {
    if (!requireAdmin(req, res)) return;
    const referenced = new Set();
    for (const row of db.prepare("SELECT cover_image,screenshots,og_image FROM software").all()) for (const value of [row.cover_image,row.og_image,...parseJsonArray(row.screenshots)]) if (String(value).startsWith("/uploads/")) referenced.add(String(value).slice(9));
    for (const value of Object.values(settings())) if (String(value).startsWith("/uploads/")) referenced.add(String(value).slice(9));
    for (const row of db.prepare("SELECT image_url FROM homepage_slide").all()) if (String(row.image_url).startsWith("/uploads/")) referenced.add(String(row.image_url).slice(9));
    const items = readdirSync(join(DATA_DIR, "uploads"), { withFileTypes: true }).filter(item => item.isFile()).map(item => { const stat = statSync(join(DATA_DIR,"uploads",item.name)); return { name:item.name,url:`/uploads/${item.name}`,size:stat.size,modifiedAt:stat.mtime.toISOString(),referenced:referenced.has(item.name) }; }).sort((a,b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return json(res, 200, items);
  }
  m = routePattern(path, "/api/admin/media/:name");
  if (req.method === "DELETE" && m) {
    const adminId = requireAdmin(req, res); if (!adminId) return;
    const name = m.name; if (!/^[A-Za-z0-9.-]+$/.test(name)) return json(res,400,{error:"INVALID_PATH"});
    const file = join(DATA_DIR,"uploads",name); if (!existsSync(file)) return json(res,404,{error:"NOT_FOUND"});
    await unlink(file); audit(req,adminId,"DELETE","media",name,"删除上传图片"); return json(res,200,{ok:true});
  }
  return json(res, 404, { error: "API_NOT_FOUND" });
}

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon" };
function serveStatic(req, res, path) {
  if (!existsSync(WEB_ROOT)) return json(res, 503, { error: "FRONTEND_NOT_BUILT" });
  const clean = normalize(path).replace(/^(\.\.[/\\])+/, "");
  let file = join(WEB_ROOT, clean === "/" ? "index.html" : clean);
  if (!file.startsWith(WEB_ROOT)) return json(res, 403, { error: "FORBIDDEN" });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(WEB_ROOT, "index.html");
  const type = mime[extname(file)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable" });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/go/") || url.pathname.startsWith("/go-version/") || url.pathname === "/rss.xml" || url.pathname === "/feed.xml") return await handleApi(req, res, url);
    if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
      const name = url.pathname.slice("/uploads/".length);
      if (!/^[A-Za-z0-9.-]+$/.test(name)) return json(res, 400, { error: "INVALID_PATH" });
      const file = join(DATA_DIR, "uploads", name);
      if (!existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: "NOT_FOUND" });
      res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "public, max-age=86400" });
      return createReadStream(file).pipe(res);
    }
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    return json(res, error.message === "REQUEST_TOO_LARGE" ? 413 : 500, { error: "INTERNAL_ERROR" });
  }
});

function listen(host, allowIpv4Fallback = false) {
  const options = host.includes(":") ? { port: PORT, host, ipv6Only: IPV6_ONLY } : { port: PORT, host };
  const onListening = () => {
    server.off("error", onError);
    const displayHost = host.includes(":") ? `[${host}]` : host;
    console.log(`SoftwareHub listening on http://${displayHost}:${PORT} (ipv6Only=${IPV6_ONLY})`);
  };
  const onError = error => {
    server.off("listening", onListening);
    if (allowIpv4Fallback && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) {
      console.warn(`IPv6 listen failed (${error.code}); falling back to IPv4.`);
      listen("0.0.0.0");
      return;
    }
    throw error;
  };
  server.once("listening", onListening);
  server.once("error", onError);
  server.listen(options);
}

applySchedules();
pruneAnalytics();
listen(HOST, HOST === "::");
restartLinkCheckTimer();
setInterval(() => {
  applySchedules();
  pruneAnalytics();
}, 60_000);
setTimeout(() => scheduledLinkCheck().catch(error => console.error("Initial link check failed", error)), 15_000);
