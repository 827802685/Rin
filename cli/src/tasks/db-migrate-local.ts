import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fixTopField, getMigrationFileVersion, getMigrationVersion, isInfoExist, shouldSkipMigration, updateMigrationVersion } from "../lib/db-migration";

// 用当前 bun 可执行文件走 `x wrangler`，而不是依赖 PATH 上的 `bunx`：
// 精简安装的 bun（如官方 baseline 包）只带 bun.exe，没有 bunx 垫片，
// 直接调 `bunx` 会让本地迁移整条链路报 "不是内部或外部命令"。
export function buildLocalMigrateCommand(bunExec: string, dbName: string, filePath: string) {
  return {
    command: bunExec,
    args: ["x", "wrangler", "d1", "execute", dbName, "--local", "--file", filePath],
  };
}

export async function runLocalDbMigrate(dbName = "rin") {
  const sqlDir = path.join(process.cwd(), "server", "sql");

  const type = "local";
  const migrationVersion = await getMigrationVersion(type, dbName);
  const infoExists = await isInfoExist(type, dbName);
  const sqlFiles = fs
    .readdirSync(sqlDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .filter((file) => {
      const version = getMigrationFileVersion(file);
      return version !== null && version > migrationVersion;
    })
    .sort((left, right) => {
      return (getMigrationFileVersion(left) || 0) - (getMigrationFileVersion(right) || 0);
    });

  console.log("migration_version:", migrationVersion, "Migration SQL List: ", sqlFiles);

  let appliedLastVersion: number | null = null;

  for (const file of sqlFiles) {
    const filePath = path.join(sqlDir, file);

    if (await shouldSkipMigration(file, type, dbName)) {
      const version = getMigrationFileVersion(file);
      if (version !== null) {
        appliedLastVersion = version;
      }
      continue;
    }

    try {
      const { command, args } = buildLocalMigrateCommand(process.execPath, dbName, filePath);
      execFileSync(command, args, { stdio: "inherit" });
      console.log(`Executed ${file}`);
      appliedLastVersion = getMigrationFileVersion(file);
    } catch (error) {
      console.error(`Failed to execute ${file}: ${error}`);
      process.exit(1);
    }
  }

  if (sqlFiles.length === 0) {
    console.log("No migration needed.");
  }

  const lastVersion = appliedLastVersion ?? getMigrationFileVersion(sqlFiles[sqlFiles.length - 1] || "");
  if (lastVersion !== null && lastVersion > migrationVersion) {
    await updateMigrationVersion(type, dbName, lastVersion);
  }

  await fixTopField(type, dbName, infoExists);
}
