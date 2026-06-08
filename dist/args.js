"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureCategory = exports.captureContent = exports.captureTitle = exports.codeIndexScopes = exports.codeIndexOutput = exports.codeSearchSymbol = exports.codeQuerySql = exports.queryTerm = exports.codeFilesMode = exports.codeStatusMode = exports.codeIndexMode = exports.noGitConfigMode = exports.reviewMigrationMode = exports.pruneCheckMode = exports.captureInboxMode = exports.refreshIndexMode = exports.glossaryMode = exports.lintMode = exports.migrateMode = exports.args = exports.commandArgs = exports.command = exports.rawArgs = void 0;
exports.argValue = argValue;
exports.argValues = argValues;
exports.rawArgs = process.argv.slice(2);
const knownCommands = new Set(["init", "install-skill"]);
exports.command = knownCommands.has(exports.rawArgs[0] ?? "") ? exports.rawArgs[0] : "init";
exports.commandArgs = exports.command === exports.rawArgs[0] ? exports.rawArgs.slice(1) : exports.rawArgs;
exports.args = new Set(exports.commandArgs);
exports.migrateMode = exports.args.has("--migrate") || exports.args.has("--adopt-existing");
exports.lintMode = exports.args.has("--lint");
exports.glossaryMode = exports.args.has("--glossary-init");
exports.refreshIndexMode = exports.args.has("--refresh-index");
exports.captureInboxMode = exports.args.has("--capture-inbox");
exports.pruneCheckMode = exports.args.has("--prune-check");
exports.reviewMigrationMode = exports.args.has("--review-migration") || exports.args.has("--semantic-migrate");
exports.noGitConfigMode = exports.args.has("--no-git-config");
exports.codeIndexMode = exports.args.has("--code-index") || exports.args.has("--code-evidence-index");
exports.codeStatusMode = exports.args.has("--code-status") || exports.args.has("--code-evidence-status");
exports.codeFilesMode = exports.args.has("--code-files") || exports.args.has("--code-evidence-files");
function argValue(name) {
    const prefix = `${name}=`;
    const inline = exports.commandArgs.find((arg) => arg.startsWith(prefix));
    if (inline)
        return inline.slice(prefix.length);
    const index = exports.commandArgs.indexOf(name);
    const next = index >= 0 ? exports.commandArgs[index + 1] : undefined;
    if (next && !next.startsWith("--")) {
        return next;
    }
    return "";
}
function argValues(name) {
    const prefix = `${name}=`;
    const values = [];
    for (let index = 0; index < exports.commandArgs.length; index += 1) {
        const arg = exports.commandArgs[index];
        if (!arg)
            continue;
        if (arg.startsWith(prefix)) {
            values.push(arg.slice(prefix.length));
        }
        else if (arg === name) {
            const next = exports.commandArgs[index + 1];
            if (next && !next.startsWith("--"))
                values.push(next);
        }
    }
    return values.flatMap((value) => value.split(",").map((part) => part.trim()).filter(Boolean));
}
exports.queryTerm = argValue("--query");
exports.codeQuerySql = argValue("--code-query") || argValue("--code-evidence-query");
exports.codeSearchSymbol = argValue("--code-search-symbol") || argValue("--code-evidence-symbol");
exports.codeIndexOutput = argValue("--code-index-out") || argValue("--code-evidence-out") || ".project-wiki/code-evidence.sqlite";
exports.codeIndexScopes = [...argValues("--code-scope"), ...argValues("--code-evidence-scope")];
exports.captureTitle = argValue("--title");
exports.captureContent = argValue("--content");
exports.captureCategory = argValue("--category") || "project-candidate";
