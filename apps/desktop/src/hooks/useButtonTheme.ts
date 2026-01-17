import { useEffect, useState } from 'react';

export type ButtonTheme = 'classic' | 'inverted';

export function useButtonTheme() {
  const [theme, setTheme] = useState<ButtonTheme>(() => {
    // Read from localStorage on mount
    const saved = localStorage.getItem('theme');
    return (saved as ButtonTheme) || 'classic'; // Default to classic (light theme)
  });

  useEffect(() => {
    // Remove old theme classes and add new one (preserves other classes like 'solid-background')
    document.documentElement.classList.remove('theme-classic', 'theme-inverted');
    document.documentElement.classList.add(theme === 'classic' ? 'theme-classic' : 'theme-inverted');
    // Save to localStorage
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'classic' ? 'inverted' : 'classic');
  };

  const setClassic = () => setTheme('classic');
  const setInverted = () => setTheme('inverted');

  return {
    theme,
    toggleTheme,
    setClassic,
    setInverted,
    isClassic: theme === 'classic',
    isInverted: theme === 'inverted',
  };
}
