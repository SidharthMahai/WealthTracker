"use client";

import { useEffect } from "react";

export function ThemeInit() {
  useEffect(() => {
    const storageKey = "investment-theme";

    let theme: "light" | "dark" = "light";
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "light" || stored === "dark") {
        theme = stored;
      } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        theme = "dark";
      }
    } catch (_error) {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    document.documentElement.dataset.theme = theme;
  }, []);

  return null;
}
