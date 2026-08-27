"use client";

import {Moon, Sun} from "lucide-react";

const STORAGE_KEY = "delphi-theme";

/**
 * Holds no React state on purpose. Which icon shows is decided by the `.dark`
 * class through Tailwind's dark variant, so the server and the client always
 * render the same markup — a `useState` seeded from `localStorage` would render
 * one icon on the server and possibly the other on the client, which is a
 * hydration mismatch and a visible flip on every load.
 */
export function ThemeToggle() {
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // A browser with site data blocked still gets the toggle; it just will
      // not remember the choice. That is a better outcome than throwing here.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="theme-toggle"
      // Static wording, valid in both states: the label must not claim a
      // direction the SSR pass cannot know.
      aria-label="Toggle colour theme"
      className="grid size-8 place-items-center rounded-md border border-border bg-bg-raised text-text-muted transition-colors hover:bg-bg-sunken hover:text-text"
    >
      <Sun size={15} className="hidden dark:block" aria-hidden />
      <Moon size={15} className="block dark:hidden" aria-hidden />
    </button>
  );
}
