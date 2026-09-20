import { describe, expect, it } from "bun:test";
import { buildLocalMigrateCommand } from "./db-migrate-local";

describe("buildLocalMigrateCommand", () => {
  it("uses the running bun executable instead of relying on a bunx shim", () => {
    const { command, args } = buildLocalMigrateCommand("/usr/local/bin/bun", "rin", "/sql/0000.sql");

    expect(command).toBe("/usr/local/bin/bun");
    expect(args.join(" ")).not.toContain("bunx");
  });

  it("runs wrangler through bun x with the local migration flags", () => {
    const { args } = buildLocalMigrateCommand("bun", "rin", "/sql/0000.sql");

    expect(args).toEqual(["x", "wrangler", "d1", "execute", "rin", "--local", "--file", "/sql/0000.sql"]);
  });

  it("keeps a migration path containing spaces as one argument", () => {
    const filePath = "C:/Users/Some User/rin/server/sql/0000.sql";
    const { args } = buildLocalMigrateCommand("bun", "rin", filePath);

    expect(args[args.length - 1]).toBe(filePath);
    expect(args).toHaveLength(8);
  });

  it("targets the database name it was given", () => {
    const { args } = buildLocalMigrateCommand("bun", "rin-preview", "/sql/0000.sql");

    expect(args).toContain("rin-preview");
    expect(args[args.indexOf("--file") - 2]).toBe("rin-preview");
  });
});
