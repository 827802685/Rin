import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TextArea, fieldClassName } from "@rin/ui";

describe("TextArea", () => {
    it("applies the shared field styling", () => {
        render(<TextArea placeholder="say something" />);

        expect(screen.getByPlaceholderText("say something").className).toContain(fieldClassName);
    });

    it("appends a caller supplied class name", () => {
        render(<TextArea placeholder="sized" className="min-h-36" />);
        const element = screen.getByPlaceholderText("sized");

        expect(element.className).toContain("min-h-36");
        expect(element.className).toContain("rounded-xl");
    });

    it("forwards native textarea props", () => {
        const onChange = vi.fn();
        render(<TextArea placeholder="controlled" value="hello" onChange={onChange} disabled />);

        const element = screen.getByPlaceholderText("controlled") as HTMLTextAreaElement;
        expect(element.value).toBe("hello");
        expect(element.disabled).toBe(true);
    });

    it("renders an empty class suffix without leaving a stray class", () => {
        render(<TextArea placeholder="plain" />);

        expect(screen.getByPlaceholderText("plain").className.trim().endsWith('""')).toBe(false);
    });
});
