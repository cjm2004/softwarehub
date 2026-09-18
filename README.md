# SoftwareHub for fnOS

面向飞牛 NAS（fnOS）的自托管软件资源发布与下载管理站。项目采用 Vue 3 + Node.js + SQLite，提供前台软件目录、受保护的短时下载跳转和高可配置管理后台，并可打包为 fnOS FPK 应用。

## 主要功能

- 软件、分类、版本历史、下载通道、公告与首页轮播管理
- Logo、截图、SEO、Open Graph、维护状态与下载说明
- 首页区块、页头页脚、联系信息、赞助二维码和下载规则配置
- 下载趋势、来源、通道统计、搜索词与页面访问统计、CSV 导出和 JSON 备份恢复
- 标签管理与分类页筛选，支持首页区块、页脚链接和轮播顺序可视化调整
- 定时发布、定时下架、定时取消推荐，下载链接手动/自动巡检与连续失败自动暂停
- 应用复制、批量发布/下架/推荐/删除，以及 CSV/JSON 批量导入
- 全站与分类 RSS 更新订阅
- 管理员会话、登录限流、账户修改和操作审计
- 媒体引用检查与未引用文件清理
- IPv4 / IPv6 双栈监听及 fnOS FPK 升级安装

## 开发环境

- Node.js 22
- Vue 3
- Vite
- Node.js 内置 SQLite (`node:sqlite`)

```bash
npm install
npm run dev:server
npm run dev
```

默认服务端端口为 `31880`，前端开发服务器会将 `/api`、`/go` 和 `/uploads` 请求代理至服务端。

## 测试与构建

```bash
npm test
npm run build
npm run package:fpk
```

FPK 打包需要项目 `tools/` 目录中的 fnOS 官方 `fnpack` 工具。打包结果输出到：

- `com.softwarehub.fnos.fpk`
- `outputs/com.softwarehub.fnos.fpk`

## 配置与数据

运行数据默认保存在 `.data/`，fnOS 安装后由应用数据目录持久化。管理员初始账号由安装流程注入；首次启动后可在后台修改账号和密码。

重要配置均可在管理后台完成，包括首页内容、站点品牌、下载策略、安全策略、备份和媒体维护。

## 安全说明

- 管理会话使用 HttpOnly、SameSite=Strict Cookie。
- 下载地址通过一次性短时票据跳转。
- 上传图片会校验格式、文件头和大小。
- 下载链接检测会拒绝本机及内网目标，降低 SSRF 风险。
- 请勿提交 `.data/`、真实凭据、上传文件和打包产物。

## 发布

GitHub Release 附带可直接在 fnOS 应用中心覆盖安装的 `.fpk` 文件。升级前建议在后台导出 JSON 备份。
