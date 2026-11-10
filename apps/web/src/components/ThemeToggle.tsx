import { useEffect, useState } from "react";

const themeKey = "film-shelf-theme";

function applyTheme(dark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.content = getComputedStyle(root).getPropertyValue("--page-background").trim();
  }
}

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    function syncTheme() {
      let nextDark: boolean;
      try {
        nextDark = localStorage.getItem(themeKey) === "dark";
      } catch {
        return;
      }
      applyTheme(nextDark);
      setDark(nextDark);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === themeKey || event.key === null) syncTheme();
    }

    window.addEventListener("storage", handleStorage);
    syncTheme();
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  function toggleTheme() {
    const nextDark = !dark;
    applyTheme(nextDark);
    setDark(nextDark);
    try {
      localStorage.setItem(themeKey, nextDark ? "dark" : "light");
    } catch {
      // The page can still switch themes if browser storage is unavailable.
    }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="夜间主题"
      aria-pressed={dark}
      title={dark ? "切换到日间主题" : "切换到夜间主题"}
      onClick={toggleTheme}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dark
          ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" /></>
          : <path d="M20.9 13.4A9 9 0 0 1 10.6 3.1 9 9 0 1 0 20.9 13.4Z" />}
      </svg>
    </button>
  );
}
