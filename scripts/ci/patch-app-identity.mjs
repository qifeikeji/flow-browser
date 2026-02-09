import fs from "node:fs";
import path from "node:path";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function sanitizeSlug(input) {
  const slug = String(input).trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(
      `APP_SLUG must match /^[a-z0-9][a-z0-9-]*$/ (lowercase, digits, hyphen). Got: ${JSON.stringify(input)}`
    );
  }
  return slug;
}

function replaceOrThrow(content, re, replacement, what) {
  if (!re.test(content)) {
    throw new Error(`Pattern not found for ${what}: ${re}`);
  }
  return content.replace(re, replacement);
}

function writeIfChanged(absPath, next) {
  const prev = fs.readFileSync(absPath, "utf-8");
  if (prev === next) return { file: absPath, changed: false };
  fs.writeFileSync(absPath, next, "utf-8");
  return { file: absPath, changed: true };
}

function patchPackageJson(repoRoot, { packageName, productName }) {
  const absPath = path.join(repoRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(absPath, "utf-8"));

  pkg.name = packageName;
  pkg.productName = productName;

  const next = JSON.stringify(pkg, null, 2) + "\n";
  return writeIfChanged(absPath, next);
}

function ensureLinuxExecutableName(builderTs, executableName) {
  const hasLinuxExec = /linux:\s*\{[\s\S]*?\bexecutableName:\s*["'`]/m.test(builderTs);
  if (hasLinuxExec) {
    return builderTs.replace(
      /(linux:\s*\{[\s\S]*?\bexecutableName:\s*)(["'`])([^"'`]+)(\2)/m,
      (_m, p1, quote, _old, p4) => `${p1}${quote}${executableName}${p4}`
    );
  }

  return replaceOrThrow(
    builderTs,
    /(linux:\s*\{\s*\n)/m,
    `$1    executableName: "${executableName}",\n`,
    "electron-builder linux.executableName insertion"
  );
}

function patchElectronBuilderTs(repoRoot, { appId, productName, executableName }) {
  const absPath = path.join(repoRoot, "electron-builder.ts");
  let content = fs.readFileSync(absPath, "utf-8");

  content = replaceOrThrow(content, /(\bappId:\s*)(["'`])([^"'`]+)(\2)/, `$1"${appId}"$4`, "electron-builder appId");
  content = replaceOrThrow(
    content,
    /(\bproductName:\s*)(["'`])([^"'`]+)(\2)/,
    `$1"${productName}"$4`,
    "electron-builder productName"
  );

  // Keep Windows executableName aligned too (harmless even if you only build Linux)
  if (/\bwin:\s*\{[\s\S]*?\bexecutableName:\s*["'`]/m.test(content)) {
    content = content.replace(
      /(\bwin:\s*\{[\s\S]*?\bexecutableName:\s*)(["'`])([^"'`]+)(\2)/m,
      (_m, p1, quote, _old, p4) => `${p1}${quote}${executableName}${p4}`
    );
  }

  content = ensureLinuxExecutableName(content, executableName);
  return writeIfChanged(absPath, content);
}

function patchDefaultBrowserController(repoRoot, desktopFile) {
  const absPath = path.join(repoRoot, "src/main/controllers/default-browser-controller/index.ts");
  let content = fs.readFileSync(absPath, "utf-8");

  content = replaceOrThrow(
    content,
    /xdg-settings set default-web-browser\s+[^\s"']+/,
    `xdg-settings set default-web-browser ${desktopFile}`,
    "linux default browser desktop file"
  );

  return writeIfChanged(absPath, content);
}

function patchMainHeader(repoRoot, productName) {
  const absPath = path.join(repoRoot, "src/main/index.ts");
  let content = fs.readFileSync(absPath, "utf-8");

  if (content.includes("--- Flow Browser ---")) {
    content = content.replaceAll("--- Flow Browser ---", `--- ${productName} ---`);
  }

  return writeIfChanged(absPath, content);
}

function main() {
  const repoRoot = process.cwd();

  const appSlug = sanitizeSlug(requireEnv("APP_SLUG"));
  const productName = requireEnv("APP_PRODUCT_NAME").trim();
  if (!productName) throw new Error("APP_PRODUCT_NAME cannot be empty");

  const appId = String(process.env.APP_ID ?? `dev.sun.${appSlug}`).trim();
  const packageName = String(process.env.APP_PACKAGE_NAME ?? `${appSlug}-browser`).trim();
  const desktopFile = String(process.env.DESKTOP_FILE ?? `${appSlug}.desktop`).trim();

  const results = [];
  results.push(patchPackageJson(repoRoot, { packageName, productName }));
  results.push(patchElectronBuilderTs(repoRoot, { appId, productName, executableName: appSlug }));
  results.push(patchDefaultBrowserController(repoRoot, desktopFile));
  results.push(patchMainHeader(repoRoot, productName));

  const changed = results.filter((r) => r.changed);
  console.log("[patch-app-identity] done");
  for (const r of results) {
    console.log(`- ${path.relative(repoRoot, r.file)}: ${r.changed ? "patched" : "unchanged"}`);
  }
  console.log(`[patch-app-identity] changed ${changed.length}/${results.length} files`);
}

main();


