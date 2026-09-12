import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "bun:test";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import * as schema from "../schema";

const SQL_DIR = path.join(process.cwd(), "sql");

interface MigrationColumn {
    table: string;
    column: string;
}

function stripComments(sql: string): string {
    return sql.replace(/--[^\n]*/g, "");
}

function unquote(identifier: string): string {
    return identifier.replace(/[`"[\]]/g, "");
}

function readMigrationFiles(): string {
    return fs
        .readdirSync(SQL_DIR)
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map((name) => fs.readFileSync(path.join(SQL_DIR, name), "utf8"))
        .join("\n");
}

/**
 * Collects every column a migration creates, either as part of a
 * `CREATE TABLE` body or through a later `ALTER TABLE ... ADD COLUMN`.
 */
function collectCreatedColumns(sql: string): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    const add = (table: string, column: string) => {
        if (!result.has(table)) {
            result.set(table, new Set());
        }
        result.get(table)?.add(column);
    };

    const createTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[\]]?(\w+)[`"[\]]?\s*\(([\s\S]*?)\n\);/gi;
    for (const match of stripComments(sql).matchAll(createTable)) {
        const table = match[1] as string;
        const body = match[2] as string;

        // Split on top level commas, then take the first token of each line.
        for (const definition of body.split(/,(?![^()]*\))/)) {
            const candidate = definition.trim().split(/\s+/)[0];
            if (!candidate) {
                continue;
            }

            const name = unquote(candidate);
            if (/^(primary|unique|foreign|constraint|check)$/i.test(name)) {
                continue;
            }

            add(table, name);
        }
    }

    const addColumn = /ALTER\s+TABLE\s+[`"[\]]?(\w+)[`"[\]]?\s+ADD\s+(?:COLUMN\s+)?[`"[\]]?(\w+)[`"[\]]?/gi;
    for (const match of stripComments(sql).matchAll(addColumn)) {
        add(match[1] as string, match[2] as string);
    }

    // SQLite cannot change column constraints in place, so migrations recreate a
    // table under a temporary name and rename it afterwards. Carry the columns
    // of the temporary table over to its final name.
    const renameTable = /ALTER\s+TABLE\s+[`"[\]]?(\w+)[`"[\]]?\s+RENAME\s+TO\s+[`"[\]]?(\w+)[`"[\]]?/gi;
    for (const match of stripComments(sql).matchAll(renameTable)) {
        const from = match[1] as string;
        const to = match[2] as string;
        for (const column of result.get(from) ?? []) {
            add(to, column);
        }
    }

    return result;
}

function schemaTables(): Table[] {
    return Object.values(schema).filter((value) => is(value, Table)) as Table[];
}

describe("database migrations", () => {
    const created = collectCreatedColumns(readMigrationFiles());

    it("finds every schema table in the migrations", () => {
        const missing = schemaTables()
            .map((table) => getTableName(table))
            .filter((name) => !created.has(name));

        expect(missing).toEqual([]);
    });

    it("creates a column in SQL for every column declared in the schema", () => {
        const missing: string[] = [];

        for (const table of schemaTables()) {
            const tableName = getTableName(table);
            const migrated = created.get(tableName);

            for (const column of Object.values(getTableColumns(table))) {
                if (!migrated?.has(column.name)) {
                    missing.push(`${tableName}.${column.name}`);
                }
            }
        }

        // `feeds.top` shipped in schema.ts while no migration ever created it,
        // which broke pinning on every freshly migrated database.
        expect(missing).toEqual([]);
    });
});
