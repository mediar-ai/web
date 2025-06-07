import { useEffect, useRef, DependencyList } from 'react';

export function useDebouncedEffect(
  effect: () => void,
  deps: DependencyList,
  delay: number
) {
  const callback = useRef(effect);

  useEffect(() => {
    callback.current = effect;
  }, [effect]);

  useEffect(() => {
    const handler = setTimeout(() => {
      callback.current();
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [...deps, delay]);
} 