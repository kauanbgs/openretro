import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { pt, es } from "../web/src/translations";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function browser(
  preferred = "es-MX",
  cached: string | null = null,
  query = "",
) {
  const storage = new Map(cached ? [["openretro-web-language", cached]] : []);
  const assign = vi.fn();
  const description = vi.fn();
  vi.stubGlobal("navigator", { languages: [preferred], language: preferred });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("location", {
    search: query,
    href: `https://example.org/${query}#faq`,
    assign,
  });
  vi.stubGlobal("document", {
    documentElement: { lang: "" },
    title: "",
    querySelector: () => ({ setAttribute: description }),
  });
  return { storage, assign, description };
}

describe("website languages", () => {
  it.each([
    ["es-MX", "es", "Descargar para Windows"],
    ["pt-PT", "pt-BR", "Baixar para Windows"],
    ["fr-FR", "en", "Download for Windows"],
  ])(
    "follows %s and translates metadata",
    async (preferred, expected, download) => {
      const { description } = browser(preferred);
      const i18n = await import("../web/src/i18n");
      expect(i18n.language).toBe(expected);
      expect(document.documentElement.lang).toBe(expected);
      expect(i18n.t("Download for Windows")).toBe(download);
      expect(document.title).toContain("OpenRetro");
      expect(description).toHaveBeenCalledOnce();
      expect(i18n.t(" Version {version}.", { version: "1.3.0" })).toContain(
        "1.3.0",
      );
    },
  );

  it("keeps a manual choice and can return to automatic", async () => {
    const { storage, assign } = browser("en-US", "es");
    const i18n = await import("../web/src/i18n");
    expect(i18n.language).toBe("es");
    i18n.setLanguage("pt-BR");
    expect(storage.get("openretro-web-language")).toBe("pt-BR");
    expect(assign).toHaveBeenLastCalledWith(
      "https://example.org/?lang=pt-BR#faq",
    );
    i18n.setLanguage("system");
    expect(storage.has("openretro-web-language")).toBe(false);
  });

  it("supports shared language links even if storage is blocked", async () => {
    browser("pt-BR", null, "?lang=es");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    const i18n = await import("../web/src/i18n");
    expect(i18n.language).toBe("es");
    expect(() => i18n.setLanguage("en")).not.toThrow();
  });

  it("translates every user-facing source string in both website languages", () => {
    for (const path of [
      "web/src/Website.tsx",
      "web/src/i18n.ts",
      "web/src/LanguagePicker.tsx",
    ]) {
      const file = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const check = (node: ts.Node) => {
        if (ts.isStringLiteral(node)) {
          for (const table of [pt, es]) {
            expect(table[node.text], node.text).toBeTruthy();
            expect(table[node.text].match(/\{\w+\}/g)?.sort() ?? []).toEqual(
              node.text.match(/\{\w+\}/g)?.sort() ?? [],
            );
          }
        } else if (ts.isConditionalExpression(node)) {
          check(node.whenTrue);
          check(node.whenFalse);
        }
      };
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(file) === "t" &&
          node.arguments[0]
        )
          check(node.arguments[0]);
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  });
});
