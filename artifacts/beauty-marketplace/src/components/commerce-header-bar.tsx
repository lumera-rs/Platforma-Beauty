import { useState, useEffect } from "react";
import { useGetCommerceHeaderBar, getGetCommerceHeaderBarQueryKey } from "@workspace/api-client-react";

export function CommerceHeaderBar() {
  const { data: config } = useGetCommerceHeaderBar({
    query: {
      queryKey: getGetCommerceHeaderBarQueryKey(),
    }
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (!config?.enabled || !config.messages || config.messages.length <= 1 || isPaused) return;
    
    // Check reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % config.messages.length);
    }, config.intervalSeconds * 1000);

    return () => clearInterval(interval);
  }, [config, isPaused]);

  if (!config?.enabled || !config.messages || config.messages.length === 0) return null;

  const currentMessage = config.messages[currentIndex];

  return (
    <div 
      className="w-full text-center py-2 px-4 transition-colors duration-500 text-sm font-medium"
      style={{ backgroundColor: currentMessage.backgroundColor, color: currentMessage.textColor }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      tabIndex={0}
      role="banner"
    >
      <div 
        key={currentIndex} // forces re-render/animation on index change
        className="animate-in fade-in slide-in-from-bottom-2 duration-500"
      >
        {/* If text contains a link, we could parse it, but for now we'll just render text or potentially dangerouslySetInnerHTML if it's rich text. The schema says string, so maybe just render it. */}
        {currentMessage.text}
      </div>
    </div>
  );
}
