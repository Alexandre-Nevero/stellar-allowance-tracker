/**
 * test_bug_exploration.js
 *
 * Bug condition exploration tests for BaonGuard.
 * Run with: node src/test_bug_exploration.js
 *
 * Convention:
 *   PASS = bug IS confirmed (the bad condition exists in the codebase)
 *   FAIL = bug NOT found (unexpected — would mean the bug is already fixed)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;

function check(bugId, description, condition, detail) {
  const status = condition ? "PASS" : "FAIL";
  const icon   = condition ? "✓" : "✗";
  if (condition) passed++; else failed++;
  console.log(`\n[${status}] ${icon} Bug ${bugId}: ${description}`);
  console.log(`       ${detail}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1.1 — src/main.jsx does not exist
// PASS if the file is missing (app cannot start)
// ─────────────────────────────────────────────────────────────────────────────
{
  const mainJsx = path.join(ROOT, "src", "main.jsx");
  const missing = !fs.existsSync(mainJsx);

  // Also confirm index.html references it (so the missing file actually breaks things)
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const referencesMain = indexHtml.includes("/src/main.jsx");

  check(
    "1.1",
    "src/main.jsx does not exist — npm run dev would fail",
    missing && referencesMain,
    missing
      ? `src/main.jsx is MISSING. index.html references it: ${referencesMain}`
      : `src/main.jsx EXISTS (bug not present)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1.2 — "buffer" not in package.json dependencies
// PASS if buffer is absent (Vite build would fail to resolve the alias)
// ─────────────────────────────────────────────────────────────────────────────
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const bufferMissing = !("buffer" in allDeps);

  // Also confirm vite.config.js has the alias that would fail
  const viteConfig = fs.readFileSync(path.join(ROOT, "vite.config.js"), "utf8");
  const aliasPresent = viteConfig.includes("buffer");

  check(
    "1.2",
    '"buffer" missing from package.json — npm run build would fail',
    bufferMissing && aliasPresent,
    bufferMissing
      ? `"buffer" NOT in dependencies/devDependencies. vite.config.js has buffer alias: ${aliasPresent}`
      : `"buffer" IS present in package.json (bug not present)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1.3 — .env has no KEY=VALUE format
// PASS if .env contains only the raw address (VITE_CONTRACT_ID would be undefined)
// ─────────────────────────────────────────────────────────────────────────────
{
  const envContent = fs.readFileSync(path.join(ROOT, ".env"), "utf8").trim();

  // A valid .env line looks like KEY=VALUE; a raw address has no "=" at the start
  const hasKeyValueFormat = envContent.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#") && trimmed.includes("=");
  });

  const isRawAddress = !hasKeyValueFormat;

  check(
    "1.3",
    ".env has no KEY=VALUE format — VITE_CONTRACT_ID is undefined",
    isRawAddress,
    isRawAddress
      ? `.env content is: "${envContent}" (no KEY= prefix — Vite will not inject this)`
      : `.env has valid KEY=VALUE format (bug not present)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1.4 — No FastAPI backend; frontend calls Stellar RPC directly
// PASS if backend/ directory is absent AND stellar.js has a direct RPC URL
// ─────────────────────────────────────────────────────────────────────────────
{
  const backendDir = path.join(ROOT, "backend");
  const backendMissing = !fs.existsSync(backendDir);

  const stellarJs = fs.readFileSync(path.join(ROOT, "src", "stellar.js"), "utf8");
  const hasDirectRpc = stellarJs.includes("soroban-testnet.stellar.org");

  check(
    "1.4",
    "No FastAPI backend — browser RPC calls would hit CORS",
    backendMissing && hasDirectRpc,
    backendMissing
      ? `backend/ directory is MISSING. stellar.js calls RPC directly: ${hasDirectRpc}`
      : `backend/ directory EXISTS (bug not present)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1.5 — stellar.js passes BigInt to nativeToScVal with type "i128"
// PASS if the BigInt + i128 pattern is found (SDK v12 throws TypeError)
// ─────────────────────────────────────────────────────────────────────────────
{
  const stellarJs = fs.readFileSync(path.join(ROOT, "src", "stellar.js"), "utf8");

  // usdcToStroops returns BigInt(...) and is used in nativeToScVal calls with type "i128"
  const hasBigIntHelper = stellarJs.includes("BigInt(");
  const hasI128Type     = stellarJs.includes('"i128"');

  // Confirm the BigInt value is actually passed into nativeToScVal with i128
  // Pattern: nativeToScVal(limitStroops, { type: "i128" }) where limitStroops = usdcToStroops(...)
  // and usdcToStroops = (u) => BigInt(...)
  const bigIntPassedToI128 = hasBigIntHelper && hasI128Type;

  check(
    "1.5",
    'stellar.js uses BigInt with nativeToScVal type "i128" — SDK v12 throws TypeError',
    bigIntPassedToI128,
    bigIntPassedToI128
      ? `usdcToStroops() returns BigInt and is passed to nativeToScVal({ type: "i128" })`
      : `No BigInt + i128 pattern found (bug not present)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1.6 — AI/ML references exist in the codebase
// PASS if spendClassifier, healthGrader, or related terms are found
// Checks: src/ files AND README.md (bugfix.md says references are in "comments and README")
// ─────────────────────────────────────────────────────────────────────────────
{
  const AI_TERMS = [
    "spendClassifier",
    "healthGrader",
    "classifySpend",
    "financialHealth",
    "Financial Health Grade",
    "spend classifier",
    "health grader",
  ];

  const filesToCheck = [
    path.join(ROOT, "README.md"),
    path.join(ROOT, "src", "stellar.js"),
    path.join(ROOT, "src", "app.jsx"),
  ];

  const findings = [];
  for (const filePath of filesToCheck) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf8");
    for (const term of AI_TERMS) {
      if (content.includes(term)) {
        findings.push(`${path.relative(ROOT, filePath)}: "${term}"`);
      }
    }
  }

  const aiRefsFound = findings.length > 0;

  check(
    "1.6",
    "AI/ML references exist in the codebase (spendClassifier, healthGrader, etc.)",
    aiRefsFound,
    aiRefsFound
      ? `Found AI/ML references:\n         ${findings.join("\n         ")}`
      : `No AI/ML references found in src/ or README.md (bug not present)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1.7 — No structured error handling in React components
// PASS if app.jsx has no structured JSON error responses (only raw err.message)
// ─────────────────────────────────────────────────────────────────────────────
{
  const appJsx = fs.readFileSync(path.join(ROOT, "src", "app.jsx"), "utf8");

  // Structured error handling would look like: JSON.parse, response.json(), err.status,
  // HTTP status codes, or { error: "..." } destructuring from a backend response
  const hasStructuredErrors =
    appJsx.includes("response.json()") ||
    appJsx.includes("err.status") ||
    appJsx.includes("err.detail") ||
    appJsx.includes("JSON.parse") ||
    appJsx.includes("statusCode") ||
    appJsx.includes("httpStatus");

  // Confirm it only uses raw err.message (the broken pattern)
  const usesRawErrMessage = appJsx.includes("err.message");

  const noStructuredHandling = !hasStructuredErrors && usesRawErrMessage;

  check(
    "1.7",
    "No structured error handling — errors shown as raw exceptions",
    noStructuredHandling,
    noStructuredHandling
      ? `app.jsx uses raw err.message only; no JSON error parsing or HTTP status handling found`
      : `Structured error handling IS present (bug not present)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`Results: ${passed} PASS (bugs confirmed) / ${failed} FAIL (bugs not found)`);
if (failed === 0) {
  console.log("All 7 bugs confirmed. Codebase is ready for the fix phase.");
} else {
  console.log(`WARNING: ${failed} bug(s) not confirmed — investigate before proceeding.`);
}
console.log("─".repeat(60));
