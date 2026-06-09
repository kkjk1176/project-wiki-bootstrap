import * as crypto from "node:crypto";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { codeFilesMode, codeIndexOutput, codeIndexScopes, codeIndexMode, codeQuerySql, codeReportMode, codeSearchSymbol, codeStatusMode } from "./args";
import { abs, mkdirp, normalizePath, root } from "./workspace";

type SqliteValue = string | number | null;

interface SqliteStatement {
  all(...params: SqliteValue[]): Record<string, unknown>[];
  run(...params: SqliteValue[]): void;
}

interface SqliteDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

type SqliteDatabaseConstructor = new (filename: string) => SqliteDatabase;

interface CodeFile {
  bytes: number;
  hash: string;
  language: string;
  lines: number;
  path: string;
  profile: string;
  text: string;
}

interface IndexStatements {
  deleteConfig: SqliteStatement;
  deleteEdge: SqliteStatement;
  deleteFile: SqliteStatement;
  deleteFileFts: SqliteStatement;
  deleteImport: SqliteStatement;
  deleteRoute: SqliteStatement;
  deleteSymbol: SqliteStatement;
  deleteSymbolFts: SqliteStatement;
  insertConfig: SqliteStatement;
  insertEdge: SqliteStatement;
  insertFile: SqliteStatement;
  insertFileFts: SqliteStatement;
  insertImport: SqliteStatement;
  insertMeta: SqliteStatement;
  insertRoute: SqliteStatement;
  insertSymbol: SqliteStatement;
  insertSymbolFts: SqliteStatement;
}

interface CodeIndexStaleness {
  added: number;
  changed: number;
  deleted: number;
  stale: boolean;
}

interface OwnerSummary {
  bytes: number;
  configs: number;
  file_count: number;
  imports: number;
  languages: string;
  lines: number;
  owner: string;
  routes: number;
  symbols: number;
}

const ignoredDirectories = new Set([
  ".git",
  ".codex",
  ".claude",
  ".project-wiki",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "vendor",
  "tmp",
  "temp",
]);

const languageByExtension: Record<string, string> = {
  ".c": "c",
  ".cc": "cpp",
  ".cjs": "javascript",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".cts": "typescript",
  ".go": "go",
  ".java": "java",
  ".js": "javascript",
  ".jsx": "javascript",
  ".kt": "kotlin",
  ".mjs": "javascript",
  ".mts": "typescript",
  ".php": "php",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".swift": "swift",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".vue": "vue",
};

const codeEvidenceDirectory = ".project-wiki";
const codeIndexSchemaVersion = "3";
const configExtensions = new Set([".json", ".yaml", ".yml", ".toml"]);
const maxIndexedBytes = 1024 * 1024;
const httpMethods = new Set(["all", "delete", "get", "patch", "post", "put"]);

function loadDatabaseSync(): SqliteDatabaseConstructor {
  const previousListeners = process.listeners("warning");
  const suppressExperimentalSqliteWarning = (warning: Error): void => {
    if (warning.name !== "ExperimentalWarning" || !warning.message.includes("SQLite")) {
      for (const listener of previousListeners) listener.call(process, warning);
    }
  };
  try {
    process.removeAllListeners("warning");
    process.on("warning", suppressExperimentalSqliteWarning);
    const sqlite = require("node:sqlite") as { DatabaseSync: SqliteDatabaseConstructor };
    return sqlite.DatabaseSync;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`code evidence index requires Node.js with node:sqlite support; current Node is ${process.version}. Error: ${message}`);
  } finally {
    process.removeAllListeners("warning");
    for (const listener of previousListeners) process.on("warning", listener);
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function normalizeProjectRelative(input: string, label: string): string {
  const raw = input.trim() || ".";
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    fail(`${label} must stay inside the project root: ${input}`);
  }
  return normalizePath(path.relative(rootResolved, resolved)) || ".";
}

function codeEvidenceDatabasePath(): { absolutePath: string; relativePath: string } {
  const raw = codeIndexOutput.trim() || `${codeEvidenceDirectory}/code-evidence.sqlite`;
  const absolutePath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const evidenceRoot = path.resolve(root, codeEvidenceDirectory);
  if (absolutePath === evidenceRoot || !absolutePath.startsWith(`${evidenceRoot}${path.sep}`)) {
    fail(`--code-index-out must stay inside ${codeEvidenceDirectory}/`);
  }
  return {
    absolutePath,
    relativePath: normalizePath(path.relative(root, absolutePath)),
  };
}

function fileLanguage(relativePath: string): string {
  if (path.basename(relativePath) === ".env.example") return "config";
  const extension = path.extname(relativePath).toLowerCase();
  return languageByExtension[extension] ?? (configExtensions.has(extension) ? "config" : "");
}

function isBlockedEnvFile(relativePath: string): boolean {
  const base = path.basename(relativePath);
  return base.startsWith(".env") && base !== ".env.example";
}

function isBlockedSensitiveConfigFile(relativePath: string): boolean {
  if (fileLanguage(relativePath) !== "config") return false;
  const base = path.basename(relativePath).toLowerCase();
  if (base === ".env.example") return false;
  return /(^|[._-])(secret|secrets|credential|credentials|token|tokens|private|key|keys)([._-]|$)/i.test(base);
}

function isJavaScriptLike(relativePath: string): boolean {
  return [".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"].includes(path.extname(relativePath).toLowerCase());
}

function extractionProfile(relativePath: string): string {
  if (isJavaScriptLike(relativePath)) return "typescript-ast";
  if (fileLanguage(relativePath) === "python") return "python-light";
  if (fileLanguage(relativePath) === "go") return "go-light";
  if (fileLanguage(relativePath) === "config") return "config";
  return "inventory-only";
}

function shouldIndexFile(relativePath: string): boolean {
  if (isBlockedEnvFile(relativePath)) return false;
  if (isBlockedSensitiveConfigFile(relativePath)) return false;
  const language = fileLanguage(relativePath);
  if (language) return true;
  const base = path.basename(relativePath);
  return ["Dockerfile", "Makefile", "package.json", "tsconfig.json"].includes(base);
}

function walkCodeFiles(relativePath: string, files: string[] = []): string[] {
  const target = abs(relativePath);
  if (!fs.existsSync(target)) return files;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (stat.size <= maxIndexedBytes && shouldIndexFile(relativePath)) files.push(relativePath);
    return files.sort();
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = normalizePath(path.join(relativePath, entry.name));
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) walkCodeFiles(child, files);
    } else if (entry.isFile() && shouldIndexFile(child)) {
      const childStat = fs.statSync(abs(child));
      if (childStat.size <= maxIndexedBytes) files.push(child);
    }
  }
  return files.sort();
}

function gitTrackedAndUnignoredFiles(scopes: string[]): string[] | null {
  try {
    const output = childProcess.execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...scopes], {
      cwd: root,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.toString("utf8").split("\0").filter(Boolean).map((file) => normalizeProjectRelative(file, "git-indexed file"));
  } catch {
    return null;
  }
}

function discoverCodeFiles(scopes: string[]): string[] {
  const gitFiles = gitTrackedAndUnignoredFiles(scopes);
  const candidates = gitFiles ?? scopes.flatMap((scope) => walkCodeFiles(scope));
  return Array.from(new Set(candidates))
    .filter((file) => fs.existsSync(abs(file)))
    .filter((file) => fs.statSync(abs(file)).isFile())
    .filter((file) => shouldIndexFile(file))
    .filter((file) => fs.statSync(abs(file)).size <= maxIndexedBytes)
    .sort();
}

function readCodeFile(relativePath: string): CodeFile {
  const text = fs.readFileSync(abs(relativePath), "utf8");
  return {
    bytes: Buffer.byteLength(text),
    hash: crypto.createHash("sha256").update(text).digest("hex"),
    language: fileLanguage(relativePath) || "config",
    lines: text.length === 0 ? 0 : text.split(/\r?\n/).length,
    path: relativePath,
    profile: extractionProfile(relativePath),
    text,
  };
}

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

function scriptKindForPath(relativePath: string): ts.ScriptKind {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if ([".ts", ".mts", ".cts"].includes(extension)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function setupDatabase(database: SqliteDatabase): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE files (
      path TEXT PRIMARY KEY,
      language TEXT NOT NULL,
      profile TEXT NOT NULL,
      kind TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      lines INTEGER NOT NULL,
      hash TEXT NOT NULL
    );
    CREATE TABLE symbols (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      signature TEXT NOT NULL
    );
    CREATE TABLE imports (
      id INTEGER PRIMARY KEY,
      from_file TEXT NOT NULL,
      to_ref TEXT NOT NULL,
      imported TEXT NOT NULL,
      line INTEGER NOT NULL,
      raw TEXT NOT NULL
    );
    CREATE TABLE routes (
      id INTEGER PRIMARY KEY,
      method TEXT NOT NULL,
      route TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      handler TEXT NOT NULL
    );
    CREATE TABLE configs (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL
    );
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      evidence TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE files_fts USING fts5(path, language, profile, content);
    CREATE VIRTUAL TABLE symbols_fts USING fts5(name, kind, file_path, signature);
    CREATE INDEX idx_symbols_file ON symbols(file_path);
    CREATE INDEX idx_symbols_name ON symbols(name);
    CREATE INDEX idx_imports_from ON imports(from_file);
    CREATE INDEX idx_routes_path ON routes(route);
    CREATE INDEX idx_configs_file ON configs(file_path);
    CREATE INDEX idx_edges_source ON edges(source_kind, source);
    CREATE INDEX idx_edges_target ON edges(target_kind, target);
    CREATE INDEX idx_edges_kind ON edges(kind);
  `);
}

function createIndexStatements(database: SqliteDatabase): IndexStatements {
  return {
    deleteConfig: database.prepare("DELETE FROM configs WHERE file_path = ?"),
    deleteEdge: database.prepare("DELETE FROM edges WHERE file_path = ?"),
    deleteFile: database.prepare("DELETE FROM files WHERE path = ?"),
    deleteFileFts: database.prepare("DELETE FROM files_fts WHERE path = ?"),
    deleteImport: database.prepare("DELETE FROM imports WHERE from_file = ?"),
    deleteRoute: database.prepare("DELETE FROM routes WHERE file_path = ?"),
    deleteSymbol: database.prepare("DELETE FROM symbols WHERE file_path = ?"),
    deleteSymbolFts: database.prepare("DELETE FROM symbols_fts WHERE file_path = ?"),
    insertConfig: database.prepare("INSERT INTO configs (key, value, file_path, line) VALUES (?, ?, ?, ?)"),
    insertEdge: database.prepare("INSERT INTO edges (kind, source_kind, source, target_kind, target, file_path, line, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    insertFile: database.prepare("INSERT INTO files (path, language, profile, kind, bytes, lines, hash) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    insertFileFts: database.prepare("INSERT INTO files_fts (path, language, profile, content) VALUES (?, ?, ?, ?)"),
    insertImport: database.prepare("INSERT INTO imports (from_file, to_ref, imported, line, raw) VALUES (?, ?, ?, ?, ?)"),
    insertMeta: database.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)"),
    insertRoute: database.prepare("INSERT INTO routes (method, route, file_path, line, handler) VALUES (?, ?, ?, ?, ?)"),
    insertSymbol: database.prepare("INSERT INTO symbols (name, kind, file_path, line, signature) VALUES (?, ?, ?, ?, ?)"),
    insertSymbolFts: database.prepare("INSERT INTO symbols_fts (name, kind, file_path, signature) VALUES (?, ?, ?, ?)"),
  };
}

function removeIndexedFile(filePath: string, statements: IndexStatements): void {
  statements.deleteConfig.run(filePath);
  statements.deleteEdge.run(filePath);
  statements.deleteImport.run(filePath);
  statements.deleteRoute.run(filePath);
  statements.deleteSymbol.run(filePath);
  statements.deleteSymbolFts.run(filePath);
  statements.deleteFileFts.run(filePath);
  statements.deleteFile.run(filePath);
}

function indexCodeFile(file: CodeFile, statements: IndexStatements): void {
  statements.insertFile.run(file.path, file.language, file.profile, file.language === "config" ? "config" : "source", file.bytes, file.lines, file.hash);
  statements.insertFileFts.run(file.path, file.language, file.profile, file.text);
  if (file.profile === "typescript-ast") indexJavaScriptLike(file, statements);
  else if (file.profile === "python-light") indexPythonLight(file, statements);
  else if (file.profile === "go-light") indexGoLight(file, statements);
  if (file.language === "config") indexConfigs(file, statements.insertConfig);
}

function writeIndexMetadata(scopes: string[], statements: IndexStatements): void {
  statements.insertMeta.run("schema_version", codeIndexSchemaVersion);
  statements.insertMeta.run("updated_at", new Date().toISOString());
  statements.insertMeta.run("root", root);
  statements.insertMeta.run("scopes", scopes.join(", "));
  statements.insertMeta.run("scopes_json", JSON.stringify(scopes));
  statements.insertMeta.run("terminology", "code evidence index");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

function printRows(rows: Record<string, unknown>[]): void {
  console.log(JSON.stringify(rows, null, 2));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function tsLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function nodeName(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isPrivateIdentifier(node)) return node.text;
  return oneLine(node.getText(sourceFile));
}

function propertyNameText(name: ts.PropertyName | ts.BindingName | undefined, sourceFile: ts.SourceFile): string {
  if (!name) return "";
  return nodeName(name, sourceFile);
}

function callTarget(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return oneLine(expression.getText(sourceFile));
  if (ts.isElementAccessExpression(expression)) return oneLine(expression.getText(sourceFile));
  return oneLine(expression.getText(sourceFile));
}

function insertSymbol(statements: IndexStatements, name: string, kind: string, file: CodeFile, line: number, signature: string): void {
  if (!name) return;
  statements.insertSymbol.run(name, kind, file.path, line, signature);
  statements.insertSymbolFts.run(name, kind, file.path, signature);
}

function insertEdge(statements: IndexStatements, kind: string, sourceKind: string, source: string, targetKind: string, target: string, file: CodeFile, line: number, evidence: string): void {
  if (!target) return;
  statements.insertEdge.run(kind, sourceKind, source, targetKind, target, file.path, line, evidence);
}

function importBindingText(importClause: ts.ImportClause | undefined, sourceFile: ts.SourceFile): string {
  if (!importClause) return "";
  const names: string[] = [];
  if (importClause.name) names.push(importClause.name.text);
  const namedBindings = importClause.namedBindings;
  if (namedBindings && ts.isNamespaceImport(namedBindings)) names.push(`* as ${namedBindings.name.text}`);
  if (namedBindings && ts.isNamedImports(namedBindings)) {
    for (const element of namedBindings.elements) names.push(element.name.text);
  }
  return names.join(", ") || oneLine(importClause.getText(sourceFile));
}

function stringArg(node: ts.Expression | undefined): string {
  if (!node) return "";
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : "";
}

function handlerArg(node: ts.Expression | undefined, sourceFile: ts.SourceFile): string {
  if (!node) return "";
  return callTarget(node, sourceFile);
}

function routeFromCall(node: ts.CallExpression, sourceFile: ts.SourceFile): { handler: string; method: string; route: string } | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  const method = node.expression.name.text.toLowerCase();
  if (!httpMethods.has(method)) return null;
  const receiver = node.expression.expression;
  if (!ts.isIdentifier(receiver) || !["app", "router", "server"].includes(receiver.text)) return null;
  const route = stringArg(node.arguments[0]);
  if (!route) return null;
  return {
    handler: handlerArg(node.arguments[1], sourceFile),
    method: method.toUpperCase(),
    route,
  };
}

function routeFromDecorator(node: ts.MethodDeclaration, sourceFile: ts.SourceFile): { method: string; route: string }[] {
  const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
  const routes: { method: string; route: string }[] = [];
  for (const decorator of decorators) {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression)) continue;
    const callee = expression.expression;
    if (!ts.isIdentifier(callee)) continue;
    const method = callee.text.toLowerCase();
    if (!httpMethods.has(method)) continue;
    routes.push({ method: method.toUpperCase(), route: stringArg(expression.arguments[0]) || "/" });
  }
  return routes;
}

function signatureFor(node: ts.Node, sourceFile: ts.SourceFile): string {
  return oneLine(node.getText(sourceFile));
}

function indexJavaScriptLike(file: CodeFile, statements: IndexStatements): void {
  const sourceFile = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, scriptKindForPath(file.path));

  function visit(node: ts.Node, context: string): void {
    let nextContext = context;
    if (ts.isFunctionDeclaration(node)) {
      const name = node.name?.text ?? "";
      insertSymbol(statements, name, "function", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      if (name) nextContext = name;
    } else if (ts.isClassDeclaration(node)) {
      const name = node.name?.text ?? "";
      insertSymbol(statements, name, "class", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      if (name) nextContext = name;
    } else if (ts.isInterfaceDeclaration(node)) {
      insertSymbol(statements, node.name.text, "interface", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
    } else if (ts.isTypeAliasDeclaration(node)) {
      insertSymbol(statements, node.name.text, "type", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
    } else if (ts.isEnumDeclaration(node)) {
      insertSymbol(statements, node.name.text, "enum", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
    } else if (ts.isMethodDeclaration(node)) {
      const name = propertyNameText(node.name, sourceFile);
      insertSymbol(statements, name, "method", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      for (const route of routeFromDecorator(node, sourceFile)) {
        statements.insertRoute.run(route.method, route.route, file.path, tsLine(sourceFile, node), name);
        insertEdge(statements, "route_to_handler", "route", `${route.method} ${route.route}`, "symbol", name, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      }
      if (name) nextContext = name;
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const symbolKind = node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? "function" : "variable";
      insertSymbol(statements, node.name.text, symbolKind, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      if (symbolKind === "function") nextContext = node.name.text;
    } else if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const imported = importBindingText(node.importClause, sourceFile);
      statements.insertImport.run(file.path, node.moduleSpecifier.text, imported, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      insertEdge(statements, "import", "file", file.path, "module", node.moduleSpecifier.text, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const exported = node.exportClause ? oneLine(node.exportClause.getText(sourceFile)) : "";
      statements.insertImport.run(file.path, node.moduleSpecifier.text, exported, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      insertEdge(statements, "export", "file", file.path, "module", node.moduleSpecifier.text, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
    } else if (ts.isCallExpression(node)) {
      const route = routeFromCall(node, sourceFile);
      if (route) {
        statements.insertRoute.run(route.method, route.route, file.path, tsLine(sourceFile, node), route.handler);
        insertEdge(statements, "route_to_handler", "route", `${route.method} ${route.route}`, "symbol", route.handler, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const moduleName = stringArg(node.arguments[0]);
        if (moduleName) {
          statements.insertImport.run(file.path, moduleName, "", tsLine(sourceFile, node), signatureFor(node, sourceFile));
          insertEdge(statements, "import", "file", file.path, "module", moduleName, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
        }
      } else {
        insertEdge(statements, "call", context ? "symbol" : "file", context || file.path, "symbol", callTarget(node.expression, sourceFile), file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      }
    }
    ts.forEachChild(node, (child) => visit(child, nextContext));
  }

  visit(sourceFile, "");
}

function insertMatches(file: CodeFile, regex: RegExp, insert: (match: RegExpExecArray, line: number) => void): void {
  for (const match of file.text.matchAll(regex)) {
    insert(match, lineNumber(file.text, match.index ?? 0));
  }
}

function indexPythonLight(file: CodeFile, statements: IndexStatements): void {
  const symbolPatterns: Array<[RegExp, string, (match: RegExpExecArray) => string]> = [
    [/^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, "function", (match) => `def ${match[1] ?? ""}(${match[2] ?? ""})`],
    [/^\s*class\s+([A-Za-z_]\w*)/gm, "class", (match) => `class ${match[1] ?? ""}`],
  ];
  for (const [regex, kind, signature] of symbolPatterns) {
    insertMatches(file, regex, (match, line) => insertSymbol(statements, match[1] ?? "", kind, file, line, signature(match)));
  }
  const importPatterns: Array<[RegExp, (match: RegExpExecArray) => [string, string]]> = [
    [/^\s*from\s+([A-Za-z0-9_.$]+)\s+import\s+(.+)$/gm, (match) => [match[1] ?? "", match[2] ?? ""]],
    [/^\s*import\s+([A-Za-z0-9_.$,\s]+)$/gm, (match) => [match[1] ?? "", ""]],
  ];
  for (const [regex, fields] of importPatterns) {
    insertMatches(file, regex, (match, line) => {
      const [toRef, imported] = fields(match);
      statements.insertImport.run(file.path, toRef, imported.trim(), line, match[0].trim());
      insertEdge(statements, "import", "file", file.path, "module", toRef, file, line, match[0].trim());
    });
  }
}

function insertGoImport(file: CodeFile, statements: IndexStatements, toRef: string, imported: string, line: number, raw: string): void {
  if (!toRef) return;
  statements.insertImport.run(file.path, toRef, imported, line, raw);
  insertEdge(statements, "import", "file", file.path, "module", toRef, file, line, raw);
}

function indexGoLight(file: CodeFile, statements: IndexStatements): void {
  const symbolPatterns: Array<[RegExp, string, (match: RegExpExecArray) => string, (match: RegExpExecArray) => string]> = [
    [/^\s*func\s*\(\s*[^)]*\)\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, "method", (match) => match[1] ?? "", (match) => `func (...) ${match[1] ?? ""}(${match[2] ?? ""})`],
    [/^\s*func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, "function", (match) => match[1] ?? "", (match) => `func ${match[1] ?? ""}(${match[2] ?? ""})`],
    [/^\s*type\s+([A-Za-z_]\w*)\s+(struct|interface)?/gm, "type", (match) => match[1] ?? "", (match) => `type ${match[1] ?? ""} ${match[2] ?? ""}`.trim()],
    [/^\s*const\s+([A-Za-z_]\w*)\b/gm, "constant", (match) => match[1] ?? "", (match) => `const ${match[1] ?? ""}`],
    [/^\s*var\s+([A-Za-z_]\w*)\b/gm, "variable", (match) => match[1] ?? "", (match) => `var ${match[1] ?? ""}`],
  ];
  for (const [regex, kind, name, signature] of symbolPatterns) {
    insertMatches(file, regex, (match, line) => insertSymbol(statements, name(match), kind, file, line, signature(match)));
  }

  insertMatches(file, /^\s*import\s+(?:(?:([A-Za-z_]\w*|[_.])\s+)?\"([^\"]+)\"|`([^`]+)`)/gm, (match, line) => {
    const imported = match[1] ?? "";
    const toRef = match[2] ?? match[3] ?? "";
    insertGoImport(file, statements, toRef, imported, line, match[0].trim());
  });

  insertMatches(file, /^\s*import\s*\(([\s\S]*?)^\s*\)/gm, (blockMatch) => {
    const block = blockMatch[1] ?? "";
    const blockStart = blockMatch.index ?? 0;
    for (const lineMatch of block.matchAll(/^\s*(?:([A-Za-z_]\w*|[_.])\s+)?\"([^\"]+)\"/gm)) {
      const imported = lineMatch[1] ?? "";
      const toRef = lineMatch[2] ?? "";
      const line = lineNumber(file.text, blockStart + (lineMatch.index ?? 0));
      insertGoImport(file, statements, toRef, imported, line, lineMatch[0].trim());
    }
  });
}

function indexConfigs(file: CodeFile, insertConfig: SqliteStatement): void {
  if (path.basename(file.path) === "package.json") {
    try {
      const parsed = JSON.parse(file.text) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      for (const [name, value] of Object.entries(parsed.scripts ?? {})) insertConfig.run(`script:${name}`, value, file.path, 1);
      for (const [name, value] of Object.entries(parsed.dependencies ?? {})) insertConfig.run(`dependency:${name}`, value, file.path, 1);
      for (const [name, value] of Object.entries(parsed.devDependencies ?? {})) insertConfig.run(`devDependency:${name}`, value, file.path, 1);
    } catch {
      insertConfig.run("parse-error", "package.json is not valid JSON", file.path, 1);
    }
    return;
  }
  insertMatches(file, /^\s*([A-Za-z0-9_.-]+)\s*[:=]\s*(.+)$/gm, (match, line) => {
    insertConfig.run(match[1] ?? "", (match[2] ?? "").trim(), file.path, line);
  });
}

function codeScopes(): string[] {
  const scopes = codeIndexScopes.length > 0 ? codeIndexScopes : ["."];
  return scopes.map((scope) => normalizeProjectRelative(scope, "--code-scope"));
}

function openDatabase(databasePath: string): SqliteDatabase {
  const DatabaseSync = loadDatabaseSync();
  return new DatabaseSync(databasePath);
}

function isReadOnlySql(sql: string): boolean {
  const trimmed = sql.trim().toLowerCase();
  if (!/^(select|with)\b/.test(trimmed) || /;\s*\S/.test(trimmed)) return false;
  return !/\b(attach|alter|create|delete|detach|drop|insert|pragma|reindex|replace|update|vacuum)\b/.test(trimmed);
}

function requireExistingIndex(): void {
  const databasePath = codeEvidenceDatabasePath();
  if (!fs.existsSync(databasePath.absolutePath)) {
    console.error(`missing code evidence index: ${databasePath.relativePath}; run --code-index first`);
    process.exit(1);
  }
}

function readMetaValue(database: SqliteDatabase, key: string): string {
  const rows = database.prepare("SELECT value FROM meta WHERE key = ?").all(key);
  const value = rows[0]?.value;
  return typeof value === "string" ? value : "";
}

function indexedScopes(database: SqliteDatabase): string[] {
  const scopesJson = readMetaValue(database, "scopes_json");
  if (scopesJson) {
    try {
      const parsed = JSON.parse(scopesJson);
      if (Array.isArray(parsed) && parsed.every((scope) => typeof scope === "string")) return parsed;
    } catch {
      // Fall back to the legacy comma-separated scope metadata below.
    }
  }
  return readMetaValue(database, "scopes")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function scopesMatch(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((scope, index) => scope === right[index]);
}

function canIncrementallyUpdate(database: SqliteDatabase, scopes: string[]): boolean {
  return readMetaValue(database, "schema_version") === codeIndexSchemaVersion && scopesMatch(indexedScopes(database), scopes);
}

function removeDatabaseFiles(databasePath: string): void {
  for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

function codeIndexStaleness(database: SqliteDatabase): CodeIndexStaleness {
  const scopes = indexedScopes(database);
  const current = new Map(discoverCodeFiles(scopes.length > 0 ? scopes : ["."]).map((file) => {
    const codeFile = readCodeFile(file);
    return [codeFile.path, codeFile.hash] as const;
  }));
  const indexed = new Map(database.prepare("SELECT path, hash FROM files").all().map((row) => [String(row.path), String(row.hash)] as const));

  let changed = 0;
  let deleted = 0;
  for (const [filePath, hash] of indexed) {
    const currentHash = current.get(filePath);
    if (!currentHash) deleted += 1;
    else if (currentHash !== hash) changed += 1;
  }

  let added = 0;
  for (const filePath of current.keys()) {
    if (!indexed.has(filePath)) added += 1;
  }

  return {
    added,
    changed,
    deleted,
    stale: added > 0 || changed > 0 || deleted > 0,
  };
}

function warnIfCodeIndexStale(database: SqliteDatabase): void {
  const staleness = codeIndexStaleness(database);
  if (!staleness.stale) return;
  console.error(`code evidence index may be stale: ${staleness.changed} changed, ${staleness.added} added, ${staleness.deleted} deleted; rerun --code-index`);
}

function ownerKey(filePath: string): string {
  const parts = normalizePath(filePath).split("/").filter(Boolean);
  if (parts.length === 0) return ".";
  if (["apps", "libs", "packages", "services"].includes(parts[0] ?? "") && parts[1]) return `${parts[0]}/${parts[1]}`;
  return parts[0] ?? ".";
}

type OwnerNumericField = "bytes" | "configs" | "file_count" | "imports" | "lines" | "routes" | "symbols";

function incrementOwnerField(owners: Map<string, OwnerSummary>, filePath: string, field: OwnerNumericField, increment = 1): void {
  const key = ownerKey(filePath);
  const current = owners.get(key) ?? {
    bytes: 0,
    configs: 0,
    file_count: 0,
    imports: 0,
    languages: "",
    lines: 0,
    owner: key,
    routes: 0,
    symbols: 0,
  };
  current[field] += increment;
  owners.set(key, current);
}

function codeReport(database: SqliteDatabase): Record<string, unknown> {
  const databasePath = codeEvidenceDatabasePath();
  const staleness = codeIndexStaleness(database);
  const coverageRows = database.prepare(`
    SELECT 'files' AS table_name, count(*) AS rows FROM files
    UNION ALL SELECT 'symbols', count(*) FROM symbols
    UNION ALL SELECT 'imports', count(*) FROM imports
    UNION ALL SELECT 'routes', count(*) FROM routes
    UNION ALL SELECT 'configs', count(*) FROM configs
    UNION ALL SELECT 'edges', count(*) FROM edges
  `).all();
  const files = database.prepare("SELECT path, language, profile, lines, bytes FROM files ORDER BY path").all();
  const owners = new Map<string, OwnerSummary>();
  const ownerLanguages = new Map<string, Set<string>>();
  for (const row of files) {
    const filePath = String(row.path);
    const key = ownerKey(filePath);
    incrementOwnerField(owners, filePath, "file_count");
    incrementOwnerField(owners, filePath, "lines", Number(row.lines ?? 0));
    incrementOwnerField(owners, filePath, "bytes", Number(row.bytes ?? 0));
    const languages = ownerLanguages.get(key) ?? new Set<string>();
    languages.add(String(row.language));
    ownerLanguages.set(key, languages);
  }
  for (const row of database.prepare("SELECT file_path, count(*) AS count FROM symbols GROUP BY file_path").all()) incrementOwnerField(owners, String(row.file_path), "symbols", Number(row.count ?? 0));
  for (const row of database.prepare("SELECT file_path, count(*) AS count FROM routes GROUP BY file_path").all()) incrementOwnerField(owners, String(row.file_path), "routes", Number(row.count ?? 0));
  for (const row of database.prepare("SELECT from_file, count(*) AS count FROM imports GROUP BY from_file").all()) incrementOwnerField(owners, String(row.from_file), "imports", Number(row.count ?? 0));
  for (const row of database.prepare("SELECT file_path, count(*) AS count FROM configs GROUP BY file_path").all()) incrementOwnerField(owners, String(row.file_path), "configs", Number(row.count ?? 0));
  const ownershipSummary = Array.from(owners.values()).map((owner) => ({
    ...owner,
    languages: Array.from(ownerLanguages.get(String(owner.owner)) ?? []).sort().join(", "),
  })).sort((left, right) => right.file_count - left.file_count || left.owner.localeCompare(right.owner)).slice(0, 25);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    database: databasePath.relativePath,
    scopes: indexedScopes(database),
    stale: {
      files: staleness.added + staleness.changed + staleness.deleted,
      changed: staleness.changed,
      added: staleness.added,
      deleted: staleness.deleted,
    },
    report_sections: ["evidence_coverage", "ownership_summary", "language_profile_summary", "route_inventory", "dependency_hotspots", "config_inventory", "edge_summary"],
    evidence_coverage: Object.fromEntries(coverageRows.map((row) => [String(row.table_name), Number(row.rows ?? 0)])),
    ownership_summary: ownershipSummary,
    language_profile_summary: database.prepare("SELECT language, profile, count(*) AS files, sum(lines) AS lines, sum(bytes) AS bytes FROM files GROUP BY language, profile ORDER BY files DESC, language").all(),
    route_inventory: database.prepare("SELECT method, route, file_path, line, handler FROM routes ORDER BY file_path, line LIMIT 100").all(),
    dependency_hotspots: {
      imports: database.prepare("SELECT to_ref, count(DISTINCT from_file) AS importing_files, count(*) AS reference_count FROM imports GROUP BY to_ref ORDER BY importing_files DESC, reference_count DESC, to_ref LIMIT 50").all(),
      package_dependencies: database.prepare("SELECT substr(key, 12) AS package, value AS version, file_path FROM configs WHERE key LIKE 'dependency:%' ORDER BY file_path, package LIMIT 100").all(),
    },
    config_inventory: database.prepare("SELECT key, value, file_path, line FROM configs WHERE key LIKE 'script:%' OR key LIKE 'dependency:%' OR key LIKE 'devDependency:%' ORDER BY file_path, key LIMIT 150").all(),
    edge_summary: {
      by_kind: database.prepare("SELECT kind, count(*) AS edges FROM edges GROUP BY kind ORDER BY edges DESC, kind").all(),
      fanout: database.prepare("SELECT source_kind, source, kind, count(DISTINCT target) AS targets, file_path FROM edges GROUP BY source_kind, source, kind, file_path ORDER BY targets DESC, source LIMIT 50").all(),
    },
  };
}

function prepareOutputPath(): void {
  const databasePath = codeEvidenceDatabasePath();
  mkdirp(path.dirname(databasePath.relativePath));
  mkdirp(codeEvidenceDirectory);
  fs.writeFileSync(abs(`${codeEvidenceDirectory}/.gitignore`), "*\n!.gitignore\n");
}

export function runCodeIndexMode(): void {
  prepareOutputPath();
  const databasePath = codeEvidenceDatabasePath();
  const scopes = codeScopes();
  const existingIndex = fs.existsSync(databasePath.absolutePath);
  let incremental = false;
  if (existingIndex) {
    const existingDatabase = openDatabase(databasePath.absolutePath);
    try {
      incremental = canIncrementallyUpdate(existingDatabase, scopes);
    } finally {
      existingDatabase.close();
    }
  }
  if (!incremental) removeDatabaseFiles(databasePath.absolutePath);
  const database = openDatabase(databasePath.absolutePath);
  try {
    if (!incremental) setupDatabase(database);
    const statements = createIndexStatements(database);
    const currentFiles = discoverCodeFiles(scopes).map(readCodeFile);
    const currentByPath = new Map(currentFiles.map((file) => [file.path, file] as const));
    const indexed = incremental ? new Map(database.prepare("SELECT path, hash FROM files").all().map((row) => [String(row.path), String(row.hash)] as const)) : new Map<string, string>();
    const deletedPaths = incremental ? Array.from(indexed.keys()).filter((filePath) => !currentByPath.has(filePath)) : [];
    const reindexedFiles = incremental
      ? currentFiles.filter((file) => indexed.get(file.path) !== file.hash)
      : currentFiles;
    const unchangedFiles = incremental ? currentFiles.length - reindexedFiles.length : 0;

    database.exec("BEGIN");
    if (!incremental) statements.insertMeta.run("created_at", new Date().toISOString());
    writeIndexMetadata(scopes, statements);
    for (const filePath of deletedPaths) removeIndexedFile(filePath, statements);
    for (const file of reindexedFiles) {
      if (incremental && indexed.has(file.path)) removeIndexedFile(file.path, statements);
      indexCodeFile(file, statements);
    }
    database.exec("COMMIT");
    console.log("Project wiki code evidence index complete.");
    console.log(`database: ${databasePath.relativePath}`);
    console.log(`mode: ${incremental ? "incremental" : "full"}`);
    console.log(`scopes: ${scopes.join(", ")}`);
    console.log(`files: ${currentFiles.length}`);
    console.log(`reindexed_files: ${reindexedFiles.length}`);
    console.log(`deleted_files: ${deletedPaths.length}`);
    console.log(`unchanged_files: ${unchangedFiles}`);
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Ignore rollback failures after setup errors.
    }
    throw error;
  } finally {
    database.close();
  }
}

export function runCodeQueryMode(): void {
  if (!codeQuerySql.trim()) {
    console.error("missing SQL: use --code-query \"select ...\"");
    process.exit(1);
  }
  requireExistingIndex();
  if (!isReadOnlySql(codeQuerySql)) {
    console.error("code queries must be read-only SQL starting with SELECT or WITH");
    process.exit(1);
  }
  const database = openDatabase(codeEvidenceDatabasePath().absolutePath);
  try {
    database.exec("PRAGMA query_only = ON");
    warnIfCodeIndexStale(database);
    printRows(database.prepare(codeQuerySql).all());
  } finally {
    database.close();
  }
}

export function runCodeReportMode(): void {
  requireExistingIndex();
  const database = openDatabase(codeEvidenceDatabasePath().absolutePath);
  try {
    warnIfCodeIndexStale(database);
    printJson(codeReport(database));
  } finally {
    database.close();
  }
}

export function runCodeStatusMode(): void {
  requireExistingIndex();
  const database = openDatabase(codeEvidenceDatabasePath().absolutePath);
  try {
    const rows = database.prepare(`
      SELECT 'files' AS metric, count(*) AS value FROM files
      UNION ALL SELECT 'symbols', count(*) FROM symbols
      UNION ALL SELECT 'imports', count(*) FROM imports
      UNION ALL SELECT 'routes', count(*) FROM routes
      UNION ALL SELECT 'edges', count(*) FROM edges
      UNION ALL SELECT 'configs', count(*) FROM configs
    `).all();
    const staleness = codeIndexStaleness(database);
    rows.push(
      { metric: "stale_files", value: staleness.added + staleness.changed + staleness.deleted },
      { metric: "stale_changed_files", value: staleness.changed },
      { metric: "stale_added_files", value: staleness.added },
      { metric: "stale_deleted_files", value: staleness.deleted },
    );
    printRows(rows);
  } finally {
    database.close();
  }
}

export function runCodeFilesMode(): void {
  requireExistingIndex();
  const database = openDatabase(codeEvidenceDatabasePath().absolutePath);
  try {
    warnIfCodeIndexStale(database);
    printRows(database.prepare("SELECT path, language, profile, kind, lines, bytes FROM files ORDER BY path").all());
  } finally {
    database.close();
  }
}

export function runCodeSearchSymbolMode(): void {
  if (!codeSearchSymbol.trim()) {
    console.error("missing symbol search term: use --code-search-symbol \"term\"");
    process.exit(1);
  }
  requireExistingIndex();
  const database = openDatabase(codeEvidenceDatabasePath().absolutePath);
  try {
    warnIfCodeIndexStale(database);
    const like = `%${codeSearchSymbol}%`;
    printRows(database.prepare("SELECT name, kind, file_path, line, signature FROM symbols WHERE name LIKE ? OR signature LIKE ? ORDER BY file_path, line LIMIT 50").all(like, like));
  } finally {
    database.close();
  }
}

export function isCodeEvidenceMode(): boolean {
  return codeIndexMode || Boolean(codeQuerySql) || codeReportMode || codeStatusMode || codeFilesMode || Boolean(codeSearchSymbol);
}
