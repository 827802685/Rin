import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "bun:test";

const repoRoot = path.join(process.cwd(), "..");

interface PackageInfo {
    name: string;
    dir: string;
    files: string[];
    manifest: Record<string, unknown> | null;
}

function readPackages(): PackageInfo[] {
    const packagesDir = path.join(repoRoot, "packages");
    if (!fs.existsSync(packagesDir)) {
        return [];
    }

    return fs
        .readdirSync(packagesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const dir = path.join(packagesDir, entry.name);
            const files = collectSources(path.join(dir, "src"));
            const manifestPath = path.join(dir, "package.json");
            const manifest = fs.existsSync(manifestPath)
                ? (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>)
                : null;
            return { name: entry.name, dir, files, manifest };
        });
}

function collectSources(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...collectSources(full));
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
            found.push(full);
        }
    }
    return found;
}

const packages = readPackages();

/**
 * AGENTS.md lists "moving files into packages/ while still importing app
 * internals from them" as an anti-pattern. These checks keep the shared
 * packages honest: they may depend on each other, never on the applications.
 */
describe("workspace package boundaries", () => {
    it("finds the shared packages", () => {
        expect(packages.length).toBeGreaterThan(0);
    });

    it.each(packages.map((pkg) => [pkg.name, pkg] as const))(
        "%s does not import application internals",
        (_name, pkg) => {
            const offenders: string[] = [];

            for (const file of pkg.files) {
                const source = fs.readFileSync(file, "utf8");
                for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
                    const specifier = match[1] as string;
                    const reachesIntoApp =
                        specifier.includes("client/src") ||
                        specifier.includes("server/src") ||
                        specifier === "@rin/client" ||
                        specifier === "@rin/server" ||
                        /\.\.\/\.\.\/(client|server)\//.test(specifier);

                    if (reachesIntoApp) {
                        offenders.push(`${path.relative(repoRoot, file)} -> ${specifier}`);
                    }
                }
            }

            expect(offenders).toEqual([]);
        },
    );

    it.each(packages.map((pkg) => [pkg.name, pkg] as const))(
        "%s is a real workspace package",
        (_name, pkg) => {
            expect(pkg.manifest).not.toBeNull();
            if (!pkg.manifest) {
                return;
            }

            expect(pkg.manifest.name).toBeString();
            expect(pkg.manifest.exports).toBeDefined();
            const scripts = (pkg.manifest.scripts ?? {}) as Record<string, string>;
            expect(scripts.typecheck).toBeString();
        },
    );
});
