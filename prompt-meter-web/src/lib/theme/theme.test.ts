import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY, applyThemeToDocument, readStoredTheme } from "./ThemeProvider";

describe("Theme Management", () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const storage = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear()
  };

  const classList = {
    classes: new Set<string>(),
    add(cls: string) { this.classes.add(cls); },
    remove(cls: string) { this.classes.delete(cls); },
    contains(cls: string) { return this.classes.has(cls); }
  };
  const attrs = new Map<string, string>();
  const mockDocument = {
    documentElement: {
      classList,
      setAttribute(k: string, v: string) { attrs.set(k, v); },
      getAttribute(k: string) { return attrs.get(k) ?? null; },
      removeAttribute(k: string) { attrs.delete(k); },
      style: {} as Record<string, string>
    }
  };

  beforeAll(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: mockLocalStorage,
      writable: true,
      configurable: true
    });
    Object.defineProperty(globalThis, "document", {
      value: mockDocument,
      writable: true,
      configurable: true
    });
    Object.defineProperty(globalThis, "window", {
      value: {
        matchMedia: (query: string) => ({
          matches: query.includes("dark"),
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true
        })
      },
      writable: true,
      configurable: true
    });
  });

  afterAll(() => {
    globalThis.localStorage = originalLocalStorage;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  });

  beforeEach(() => {
    storage.clear();
    classList.classes.clear();
    attrs.clear();
    mockDocument.documentElement.style = {};
  });

  it("defaults to system theme when no preference stored", () => {
    expect(readStoredTheme()).toBe("system");
  });

  it("reads stored preference correctly", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readStoredTheme()).toBe("dark");

    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(readStoredTheme()).toBe("light");

    localStorage.setItem(THEME_STORAGE_KEY, "invalid-theme");
    expect(readStoredTheme()).toBe("system");
  });

  it("applies light theme to document", () => {
    const resolved = applyThemeToDocument("light");
    expect(resolved).toBe("light");
    expect(mockDocument.documentElement.classList.contains("light")).toBe(true);
    expect(mockDocument.documentElement.classList.contains("dark")).toBe(false);
    expect(mockDocument.documentElement.getAttribute("data-theme")).toBe("light");
    expect(mockDocument.documentElement.style.colorScheme).toBe("light");
  });

  it("applies dark theme to document", () => {
    const resolved = applyThemeToDocument("dark");
    expect(resolved).toBe("dark");
    expect(mockDocument.documentElement.classList.contains("dark")).toBe(true);
    expect(mockDocument.documentElement.classList.contains("light")).toBe(false);
    expect(mockDocument.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(mockDocument.documentElement.style.colorScheme).toBe("dark");
  });

  it("applies system theme matching media preference", () => {
    const resolved = applyThemeToDocument("system");
    expect(resolved).toBe("dark");
    expect(mockDocument.documentElement.classList.contains("dark")).toBe(true);
    expect(mockDocument.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
