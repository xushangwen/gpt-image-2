import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const providers = new Set(["tuzi", "bltcy"]);
const provider = process.argv[2];

function redactEnv(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      if (/KEY=/.test(line)) return line.replace(/=.*/, "=[redacted]");
      return line;
    })
    .join("\n");
}

if (!provider || !providers.has(provider)) {
  console.error("用法：node scripts/switch-provider.mjs <tuzi|bltcy>");
  process.exit(1);
}

const source = resolve(`.env.local.${provider}`);
const target = resolve(".env.local");

if (!existsSync(source)) {
  console.error(`缺少 ${basename(source)}，请先创建对应的本地环境配置。`);
  process.exit(1);
}

copyFileSync(source, target);

console.log(`已切换到 ${provider} 配置：`);
console.log(redactEnv(readFileSync(target, "utf8")));
