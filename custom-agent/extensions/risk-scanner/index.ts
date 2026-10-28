import { readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * The risk scanner: the capability a project risk officer needs.
 *
 * It only reads. It walks the project, looks for a fixed set of risk signals, and
 * reports each one with its file, its line and the text that triggered it. The
 * officer grades the findings; this tool only gathers the evidence.
 */

const MAX_FILES = 4000;
const MAX_FINDINGS = 120;
/** How many hits of one kind the report lists. The rest are counted, not listed. */
const MAX_FINDINGS_PER_KIND = 8;
const LARGE_FILE_BYTES = 1024 * 1024;
const TEXT_SCAN_BYTES = 2 * 1024 * 1024;

const SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build", "out", "coverage",
  ".venv", "venv", "__pycache__", "target", "vendor", ".turbo", ".cache", "test-results",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".yaml", ".yml", ".toml",
  ".env", ".md", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".py", ".go", ".rs", ".java", ".kt",
  ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".cs", ".swift", ".html", ".css", ".scss", ".sql",
  ".xml", ".ini", ".conf", ".cfg", ".properties", ".txt", ".tf", ".hcl", ".gradle",
]);

const LOCK_FILES = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "npm-shrinkwrap.json", "bun.lockb", "composer.lock",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tar", ".7z", ".rar",
  ".mp3", ".mp4", ".mov", ".avi", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".exe", ".dll", ".so", ".dylib",
  ".wasm", ".class", ".jar", ".pyc", ".bin", ".db", ".sqlite",
]);

const SECRET_PATTERN = /(api[_-]?key|secret[_-]?key|secret|password|passwd|pwd|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/gi;
const PLACEHOLDER_PATTERN = /^(x{3,}|\*{3,}|\.{3,}|changeme|placeholder|example|your[-_ ]|todo|<|\$\{|process\.env|env\.|none|null|undefined|test|dummy|abc123|secret|xxx)/i;
const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX|BUG)\b/;
const DEBUGGER_PATTERN = /(^|[^\w.])debugger\s*;?/;

const KIND_HINTS: Record<string, string> = {
  secret: "P0 候选：确认这是不是真的凭据，是就当泄露处理",
  dependency: "P1 候选：版本没有锁定，构建不可复现",
  debug: "P1 候选：遗留的调试断点",
  todo: "P2 候选：未收尾的工作项",
  large: "P2 候选：仓库里的大文件",
};

interface Finding {
  kind: string;
  file: string;
  line: number | null;
  text: string;
}

function isTextFile(path: string, size: number): boolean {
  const name = basename(path).toLowerCase();
  if (LOCK_FILES.has(name)) return false;
  if (name === "dockerfile" || name.startsWith(".env")) return true;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  const extension = name.slice(dot);
  if (BINARY_EXTENSIONS.has(extension)) return false;
  if (!TEXT_EXTENSIONS.has(extension)) return false;
  return size <= TEXT_SCAN_BYTES;
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (files.length >= MAX_FILES || depth > 12) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const path = join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          if (SKIP_DIRECTORIES.has(entry.name)) continue;
          walk(path, depth + 1);
        } else if (entry.isFile()) {
          files.push(path);
        }
      } catch {
        // A file that cannot be read is skipped: one unreadable path is not a
        // reason to end the scan.
      }
    }
  };
  walk(root, 0);
  return files;
}

function scanDependencies(path: string, root: string, findings: Finding[]): void {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return;
  }
  if (typeof manifest !== "object" || manifest === null) return;
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  for (const section of sections) {
    const deps = (manifest as Record<string, unknown>)[section];
    if (typeof deps !== "object" || deps === null) continue;
    for (const [name, range] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof range !== "string") continue;
      if (!/^(\*|latest|file:|git|git\+|https?:)/i.test(range)) continue;
      findings.push({
        kind: "dependency",
        file: relative(root, path) || basename(path),
        line: null,
        text: `${section}.${name} = "${range}"`,
      });
    }
  }
}

function scanText(path: string, root: string, findings: Finding[], kinds: Set<string> | null): void {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return;
  }
  const lines = content.split(/\r?\n/);
  const file = relative(root, path) || basename(path);
  lines.forEach((line, index) => {
    if (findings.length >= MAX_FINDINGS) return;
    if (!kinds || kinds.has("secret")) {
      SECRET_PATTERN.lastIndex = 0;
      const match = SECRET_PATTERN.exec(line);
      if (match && !PLACEHOLDER_PATTERN.test(match[2].trim())) {
        findings.push({
          kind: "secret",
          file,
          line: index + 1,
          text: `${match[1]} = ${match[2].slice(0, 6)}…${match[2].slice(-2)}（已截断）`,
        });
      }
    }
    if (!kinds || kinds.has("todo")) {
      if (TODO_PATTERN.test(line)) {
        findings.push({ kind: "todo", file, line: index + 1, text: line.trim().slice(0, 160) });
      }
    }
    if (!kinds || kinds.has("debug")) {
      if (DEBUGGER_PATTERN.test(line)) {
        findings.push({ kind: "debug", file, line: index + 1, text: line.trim().slice(0, 160) });
      }
    }
  });
}

function scan(root: string, kinds: Set<string> | null): Finding[] {
  const findings: Finding[] = [];
  for (const path of listFiles(root)) {
    if (findings.length >= MAX_FINDINGS) break;
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      continue;
    }
    const name = basename(path).toLowerCase();
    const file = relative(root, path) || name;
    if ((!kinds || kinds.has("large")) && size > LARGE_FILE_BYTES && !LOCK_FILES.has(name)) {
      const dot = name.lastIndexOf(".");
      const extension = dot < 0 ? "" : name.slice(dot);
      if (!BINARY_EXTENSIONS.has(extension)) {
        findings.push({
          kind: "large",
          file,
          line: null,
          text: `${(size / 1024 / 1024).toFixed(1)} MB`,
        });
        continue;
      }
    }
    if (name === "package.json") {
      scanDependencies(path, root, findings);
      continue;
    }
    if (!isTextFile(path, size)) continue;
    scanText(path, root, findings, kinds);
  }
  return findings;
}

function report(findings: Finding[], root: string): string {
  if (findings.length === 0) {
    return `没有命中任何风险信号（扫描根目录：${root}）。\n\n注意：没有命中不等于没有风险。`;
  }
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = groups.get(finding.kind) ?? [];
    list.push(finding);
    groups.set(finding.kind, list);
  }
  const lines: string[] = [`扫描根目录：${root}，命中 ${findings.length} 条信号。`, ""];
  for (const [kind, list] of groups) {
    const shown = list.slice(0, MAX_FINDINGS_PER_KIND);
    const hidden = list.length - shown.length;
    lines.push(`## ${kind}（${list.length}）`);
    if (KIND_HINTS[kind]) lines.push(`建议定级参考：${KIND_HINTS[kind]}`);
    for (const finding of shown) {
      const where = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      lines.push(`- ${where} — ${finding.text}`);
    }
    if (hidden > 0) {
      lines.push(`- …同类还有 ${hidden} 条未列出（用 grep 按类型自己找，别在这里翻）`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export default function riskScannerExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "risk_scan",
    label: "Risk scan",
    description:
      "Scan the project for risk signals: hardcoded credentials, unlocked dependency versions, leftover debugger statements, TODO/FIXME markers and large files. Returns each hit with its file, line and the text that triggered it. It only reads; it never changes a file.",
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "Directory to scan, relative to the session's working directory. Defaults to the working directory." })),
      kinds: Type.Optional(Type.Array(Type.String({
        description: "Only these kinds: secret, dependency, debug, todo, large. Defaults to all of them.",
      }))),
    }),
    execute: async (_toolCallId, args: { root?: string; kinds?: string[] }, _signal, _onUpdate, ctx?: ExtensionContext) => {
      const cwd = ctx?.cwd ?? process.cwd();
      const root = resolve(cwd, args.root ?? ".");
      const kinds = args.kinds?.length ? new Set(args.kinds.map((kind) => kind.trim().toLowerCase())) : null;
      const findings = scan(root, kinds);
      const byKind: Record<string, number> = {};
      for (const finding of findings) byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
      return {
        content: [{ type: "text" as const, text: report(findings, root) }],
        details: { root, count: findings.length, byKind, findings },
      };
    },
  });
}
