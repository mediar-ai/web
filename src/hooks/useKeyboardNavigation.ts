import { useEffect, useState, useCallback } from 'react';

interface UseKeyboardNavigationProps {
  itemCount: number;
  onSelect?: (index: number) => void;
  onEnter?: (index: number) => void;
  isActive?: boolean;
}

export function useKeyboardNavigation({
  itemCount,
  onSelect,
  onEnter,
  isActive = true,
}: UseKeyboardNavigationProps) {
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const selectNext = useCallback(() => {
    setSelectedIndex((prev) => {
      const next = prev < itemCount - 1 ? prev + 1 : 0;
      onSelect?.(next);
      return next;
    });
  }, [itemCount, onSelect]);

  const selectPrevious = useCallback(() => {
    setSelectedIndex((prev) => {
      const next = prev > 0 ? prev - 1 : itemCount - 1;
      onSelect?.(next);
      return next;
    });
  }, [itemCount, onSelect]);

  const handleEnter = useCallback(() => {
    if (selectedIndex >= 0 && selectedIndex < itemCount) {
      onEnter?.(selectedIndex);
    }
  }, [selectedIndex, itemCount, onEnter]);

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true'
      ) {
        return;
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          selectNext();
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          selectPrevious();
          break;
        case 'Enter':
          e.preventDefault();
          handleEnter();
          break;
        case 'Escape':
          e.preventDefault();
          setSelectedIndex(-1);
          onSelect?.(-1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, selectNext, selectPrevious, handleEnter, onSelect]);

  return {
    selectedIndex,
    setSelectedIndex,
    selectNext,
    selectPrevious,
  };
}