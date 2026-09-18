import { cp, mkdir, chmod, copyFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fpk = join(root, "fpk");
const outputs = join(root, "outputs");
const fnpack = process.env.FNPACK_PATH || join(root, "tools", process.platform === "win32" ? "fnpack.exe" : "fnpack");
const manifestText = await readFile(join(fpk, "manifest"), "utf8");
const appName = manifestText.match(/^appname=(.+)$/m)?.[1]?.trim();
const manifestVersion = manifestText.match(/^version=(.+)$/m)?.[1]?.trim();
const packageMeta = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (!appName) throw new Error("manifest 缺少 appname");
if (!manifestVersion || manifestVersion !== packageMeta.version) throw new Error(`版本不一致：package.json=${packageMeta.version}，manifest=${manifestVersion || "缺失"}`);
const packageName = `${appName}.fpk`;
const outputPackage = join(outputs, packageName);
const rootPackage = join(root, packageName);

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolvePromise() : reject(new Error(`${command} 执行失败，退出码 ${code}`)));
  });
}

if (!existsSync(fnpack)) throw new Error(`未找到 fnpack：${fnpack}`);

await run(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: root });
await mkdir(outputs, { recursive: true });
const stagingRoot = join(tmpdir(), `softwarehub-fpk-source-${process.pid}-${Date.now()}`);
const stagingFpk = join(stagingRoot, "fpk");
const stagingRuntime = join(stagingFpk, "app", "runtime");
const stagingOutput = join(tmpdir(), `softwarehub-pack-${process.pid}-${Date.now()}`);
await cp(fpk, stagingFpk, { recursive: true });
await mkdir(stagingRuntime, { recursive: true });
await copyFile(join(root, "server.mjs"), join(stagingRuntime, "server.mjs"));
await cp(join(root, "dist"), join(stagingRuntime, "dist"), { recursive: true, force: true });
await mkdir(stagingOutput, { recursive: true });

for (const name of ["main", "install_init", "install_callback", "upgrade_init", "upgrade_callback", "uninstall_init", "uninstall_callback", "config_init", "config_callback"]) {
  await chmod(join(stagingFpk, "cmd", name), 0o755);
}

await run(fnpack, ["build", "--directory", stagingFpk], { cwd: stagingOutput });
const stagedPackage = join(stagingOutput, packageName);
await copyFile(stagedPackage, outputPackage);
await copyFile(stagedPackage, rootPackage);
console.log(`FPK 已生成：${outputPackage}`);
