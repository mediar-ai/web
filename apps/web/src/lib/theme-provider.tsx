"use client"

import * as React from "react"

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  attribute?: string
  enableSystem?: boolean
  disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
}

const ThemeProviderContext = React.createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "mediar-theme",
  attribute = "class",
  enableSystem = true,
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = React.useState<Theme>(() => {
    // Ensure we only access localStorage on the client
    if (typeof window !== 'undefined') {
      try {
        return (localStorage.getItem(storageKey) as Theme) || defaultTheme
      } catch {
        return defaultTheme
      }
    }
    return defaultTheme
  })

  React.useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove("light", "dark")

    if (disableTransitionOnChange) {
      root.classList.add("[&_*]:!transition-none")
      window.requestAnimationFrame(() => {
        root.classList.remove("[&_*]:!transition-none")
      })
    }

    if (theme === "system" && enableSystem) {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"

      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme, attribute, enableSystem, disableTransitionOnChange])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      try {
        localStorage.setItem(storageKey, theme)
      } catch {
        console.warn('Failed to save theme preference to localStorage')
      }
      setTheme(theme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = React.useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}