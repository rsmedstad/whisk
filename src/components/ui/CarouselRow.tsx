import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "./Icon";

interface CarouselRowProps {
  children: React.ReactNode;
  category?: string;
}

const EDGE_SLACK = 4;

/**
 * Horizontal snap row. Cards should be ~40vw wide so part of the next card
 * peeks on phones. Adds an edge fade when more is hidden, and chevron buttons
 * on mouse devices (touch uses swipe).
 */
export function CarouselRow({ children, category }: CarouselRowProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > EDGE_SLACK);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE_SLACK);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [update, children]);

  const scrollByPage = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const fade = "pointer-events-none absolute inset-y-0 w-5 z-10 transition-opacity duration-200";
  const arrow =
    "hidden pointer-fine:flex absolute top-1/2 -translate-y-1/2 z-20 h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white/95 text-stone-600 shadow-md hover:bg-white hover:text-orange-600 dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-300 dark:hover:text-orange-400";

  return (
    <div className="relative overflow-hidden">
      <div
        ref={scrollerRef}
        data-carousel={category}
        className="flex gap-3 overflow-x-auto carousel-scroll snap-x snap-mandatory pb-1 px-4 scroll-pl-4"
      >
        {children}
      </div>
      <div
        aria-hidden
        className={`${fade} left-0 bg-gradient-to-r from-white/60 to-transparent dark:from-stone-950/60 ${canLeft ? "opacity-100" : "opacity-0"}`}
      />
      <div
        aria-hidden
        className={`${fade} right-0 bg-gradient-to-l from-white/60 to-transparent dark:from-stone-950/60 ${canRight ? "opacity-100" : "opacity-0"}`}
      />
      {canLeft && (
        <button type="button" onClick={() => scrollByPage(-1)} aria-label="Scroll left" className={`${arrow} left-2`}>
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}
      {canRight && (
        <button type="button" onClick={() => scrollByPage(1)} aria-label="Scroll right" className={`${arrow} right-2`}>
          <ChevronRight className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
