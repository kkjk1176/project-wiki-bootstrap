export const rawArgs: string[] = process.argv.slice(2);
const knownCommands: Set<string> = new Set(["init", "install-skill"]);
export const command: "init" | "install-skill" = knownCommands.has(rawArgs[0] ?? "") ? rawArgs[0] as "init" | "install-skill" : "init";
export const commandArgs: string[] = command === rawArgs[0] ? rawArgs.slice(1) : rawArgs;
export const args: Set<string> = new Set(commandArgs);

export const migrateMode = args.has("--migrate") || args.has("--adopt-existing");
export const lintMode = args.has("--lint");
export const glossaryMode = args.has("--glossary-init");
export const refreshIndexMode = args.has("--refresh-index");
export const captureInboxMode = args.has("--capture-inbox");
export const pruneCheckMode = args.has("--prune-check");
export const reviewMigrationMode = args.has("--review-migration") || args.has("--semantic-migrate");
export const noGitConfigMode = args.has("--no-git-config");
export const codeIndexMode = args.has("--code-index") || args.has("--code-evidence-index");
export const codeStatusMode = args.has("--code-status") || args.has("--code-evidence-status");
export const codeFilesMode = args.has("--code-files") || args.has("--code-evidence-files");

export function argValue(name: string): string {
  const prefix = `${name}=`;
  const inline = commandArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = commandArgs.indexOf(name);
  const next = index >= 0 ? commandArgs[index + 1] : undefined;
  if (next && !next.startsWith("--")) {
    return next;
  }
  return "";
}

export function argValues(name: string): string[] {
  const prefix = `${name}=`;
  const values: string[] = [];
  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (!arg) continue;
    if (arg.startsWith(prefix)) {
      values.push(arg.slice(prefix.length));
    } else if (arg === name) {
      const next = commandArgs[index + 1];
      if (next && !next.startsWith("--")) values.push(next);
    }
  }
  return values.flatMap((value) => value.split(",").map((part) => part.trim()).filter(Boolean));
}

export const queryTerm = argValue("--query");
export const codeQuerySql = argValue("--code-query") || argValue("--code-evidence-query");
export const codeSearchSymbol = argValue("--code-search-symbol") || argValue("--code-evidence-symbol");
export const codeIndexOutput = argValue("--code-index-out") || argValue("--code-evidence-out") || ".project-wiki/code-evidence.sqlite";
export const codeIndexScopes = [...argValues("--code-scope"), ...argValues("--code-evidence-scope")];
export const captureTitle = argValue("--title");
export const captureContent = argValue("--content");
export const captureCategory = argValue("--category") || "project-candidate";
