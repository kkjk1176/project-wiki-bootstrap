export type SqliteValue = string | number | null;

export interface SqliteStatement {
  all(...params: SqliteValue[]): Record<string, unknown>[];
  run(...params: SqliteValue[]): void;
}

export interface SqliteDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

type SqliteDatabaseConstructor = new (filename: string) => SqliteDatabase;

export const codeEvidenceNodeRuntimeRequirement = "Node.js 22.13+ or 24+; node:sqlite was added in Node.js 22.5.0 and became available without --experimental-sqlite in Node.js 22.13.0";

export function loadDatabaseSync(fail: (message: string) => never): SqliteDatabaseConstructor {
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
    return fail(`code evidence index requires Node.js 22.13+ because it uses node:sqlite without experimental flags; current Node is ${process.version}. Runtime policy: ${codeEvidenceNodeRuntimeRequirement}. Error: ${message}`);
  } finally {
    process.removeAllListeners("warning");
    for (const listener of previousListeners) process.on("warning", listener);
  }
}

export function openDatabase(databasePath: string, fail: (message: string) => never): SqliteDatabase {
  const DatabaseSync = loadDatabaseSync(fail);
  return new DatabaseSync(databasePath);
}
