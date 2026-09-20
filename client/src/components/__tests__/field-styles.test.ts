import { describe, expect, it } from "vitest";
import { fieldBaseClassName, fieldClassName, fieldCompactClassName, fieldTightClassName } from "@rin/ui";

function tokens(value: string): Set<string> {
    return new Set(value.split(/\s+/).filter(Boolean));
}

describe("field styles", () => {
    it("keeps the shared field styling in every variant", () => {
        for (const variant of [fieldClassName, fieldCompactClassName, fieldTightClassName]) {
            for (const token of tokens(fieldBaseClassName)) {
                expect(tokens(variant).has(token)).toBe(true);
            }
        }
    });

    it("does not repeat a padding or text size token inside one variant", () => {
        // Two competing `px-*` / `py-*` / `text-*` utilities in one string would
        // make the result depend on the order Tailwind emits them in.
        for (const variant of [fieldClassName, fieldCompactClassName, fieldTightClassName]) {
            const all = variant.split(/\s+/);
            for (const prefix of ["px-", "py-", "text-"]) {
                const matches = all.filter((token) => token.startsWith(prefix) && !token.includes(":"));
                expect(new Set(matches).size).toBe(matches.length);
            }
        }
    });

    it("sizes the default field with the roomiest padding", () => {
        const classes = tokens(fieldClassName);
        expect(classes.has("px-4")).toBe(true);
        expect(classes.has("py-3")).toBe(true);
        expect(classes.has("text-sm")).toBe(true);
    });

    it("sizes the compact field one step tighter", () => {
        const classes = tokens(fieldCompactClassName);
        expect(classes.has("px-4")).toBe(true);
        expect(classes.has("py-2.5")).toBe(true);
    });

    it("sizes the tight field for use inside a popover", () => {
        const classes = tokens(fieldTightClassName);
        expect(classes.has("px-3")).toBe(true);
        expect(classes.has("py-2")).toBe(true);
    });

    it("leaves placeholder and disabled styling to the default variant only", () => {
        // The compact and tight variants are used for selects and number inputs
        // that never show a placeholder, so inheriting it would be dead weight.
        expect(fieldClassName).toContain("placeholder:text-neutral-400");
        expect(fieldClassName).toContain("disabled:opacity-60");
        expect(fieldCompactClassName).not.toContain("placeholder:");
        expect(fieldTightClassName).not.toContain("placeholder:");
    });
});
