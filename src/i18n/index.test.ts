import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function browser(preferred: string[], cached: string | null = null) {
  const storage = new Map(cached ? [["openretro-language", cached]] : []);
  const reload = vi.fn();
  vi.stubGlobal("document", { documentElement: { lang: "" } });
  vi.stubGlobal("navigator", { languages: preferred, language: "en-US" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("location", { reload });
  return { storage, reload };
}

describe("interface language", () => {
  it.each(["pt", "pt-BR", "pt-PT", "PT-AO"])(
    "starts in Portuguese for %s",
    async (preferred) => {
      browser([preferred]);
      const i18n = await import("./index");
      expect(i18n.language).toBe("pt-BR");
      expect(document.documentElement.lang).toBe("pt-BR");
    },
  );

  it.each(["en-US", "es-ES", "fr-FR", "ja-JP", ""])(
    "starts in English for %s even if Portuguese is a secondary preference",
    async (preferred) => {
      browser([preferred, "pt-BR"]);
      const i18n = await import("./index");
      expect(i18n.language).toBe("en");
      expect(i18n.t("Idioma da interface")).toBe("Interface language");
      expect(i18n.locale()).toBe("en-US");
    },
  );

  it("uses navigator.language when the preference list is unavailable", async () => {
    browser([]);
    vi.stubGlobal("navigator", { language: "pt-PT" });
    expect((await import("./index")).systemLanguage()).toBe("pt-BR");
  });

  it("keeps a manual choice across launches", async () => {
    const { storage, reload } = browser(["es-ES"], "pt-BR");
    const i18n = await import("./index");
    expect(i18n.language).toBe("pt-BR");
    expect(i18n.adoptLanguage("pt-BR")).toBe(false);
    expect(storage.get("openretro-language")).toBe("pt-BR");
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([undefined, "system"])(
    "clears a previous choice when following the system (%s)",
    async (saved) => {
      const { storage, reload } = browser(["de-DE"], "pt-BR");
      const i18n = await import("./index");
      expect(i18n.adoptLanguage(saved)).toBe(true);
      expect(storage.has("openretro-language")).toBe(false);
      expect(reload).toHaveBeenCalledOnce();
      vi.resetModules();
      expect((await import("./index")).language).toBe("en");
    },
  );
});
