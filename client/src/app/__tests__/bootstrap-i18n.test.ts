// 锁住两件事：① 浏览器上报的语言必须先收敛到真实存在的语言包目录，否则请求会被
// 兜底成 index.html（200 + HTML），i18next 解析失败后整页显示 article.title 这类 key；
// ② SUPPORTED_LNGS 必须与 client/public/locales 下的目录一一对应，加语言时别漏。
import { expect, it, describe } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_LNGS, normalizeLng } from "../bootstrap";

describe("normalizeLng", () => {
  it("把裸 zh 收敛到 zh-CN（手机浏览器最常见的上报形式）", () => {
    expect(normalizeLng("zh")).toBe("zh-CN");
    expect(normalizeLng("zh-CN")).toBe("zh-CN");
    expect(normalizeLng("zh_CN")).toBe("zh-CN");
    expect(normalizeLng("zh-Hans")).toBe("zh-CN");
    expect(normalizeLng("zh-Hans-CN")).toBe("zh-CN");
  });

  it("繁体按地区和 Hant 标注识别", () => {
    expect(normalizeLng("zh-TW")).toBe("zh-TW");
    expect(normalizeLng("zh-HK")).toBe("zh-TW");
    expect(normalizeLng("zh-MO")).toBe("zh-TW");
    expect(normalizeLng("zh-Hant")).toBe("zh-TW");
    expect(normalizeLng("zh-Hant-TW")).toBe("zh-TW");
  });

  it("其他语言映射到存在的目录，未知语言落到 en", () => {
    expect(normalizeLng("en")).toBe("en");
    expect(normalizeLng("en-US")).toBe("en");
    expect(normalizeLng("ja-JP")).toBe("ja");
    expect(normalizeLng("fr")).toBe("en");
    expect(normalizeLng("")).toBe("en");
    expect(normalizeLng(undefined as unknown as string)).toBe("en");
  });

  it("返回值恒为 SUPPORTED_LNGS 成员，不会产出不存在的路径", () => {
    for (const raw of ["zh", "zh-TW", "zh-hant-hk", "en-GB", "ja", "ko-KR", "pt-BR", "xx"]) {
      expect(SUPPORTED_LNGS).toContain(normalizeLng(raw));
    }
  });
});

describe("SUPPORTED_LNGS", () => {
  it("与 client/public/locales 下的目录完全一致", () => {
    // vitest 的 cwd 是 client/（jsdom 下 import.meta.url 不是 file: 方案）
    const dir = join(process.cwd(), "public", "locales");
    const onDisk = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect([...SUPPORTED_LNGS].sort()).toEqual(onDisk);
  });
});
