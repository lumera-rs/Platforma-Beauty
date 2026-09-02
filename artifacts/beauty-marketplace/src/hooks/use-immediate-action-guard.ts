import { useCallback, useRef, useState } from "react";

/**
 * Prevents a second invocation in the same event turn, before React has had
 * time to render a pending state. The Set in the ref is the actual lock;
 * state only exists to update disabled controls for feedback and accessibility.
 */
export function useImmediateActionGuard() {
  const activeRef = useRef(new Set<string>());
  const [active, setActive] = useState<Set<string>>(new Set());

  const begin = useCallback((key: string) => {
    if (activeRef.current.has(key)) return false;
    activeRef.current.add(key);
    setActive((previous) => new Set(previous).add(key));
    return true;
  }, []);

  const end = useCallback((key: string) => {
    activeRef.current.delete(key);
    setActive((previous) => {
      if (!previous.has(key)) return previous;
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
  }, []);

  const isActive = useCallback((key: string) => active.has(key), [active]);

  return { begin, end, isActive };
}