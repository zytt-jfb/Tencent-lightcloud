import { useEffect, useRef, useState } from 'react';

/**
 * 观察容器实际宽度，供 SVG 图表按真实像素绘制。
 *
 * 为什么不用 viewBox + preserveAspectRatio 缩放：那样文字会跟着一起放大，
 * 卡片变宽时字号失真。拿到真实宽度后所有坐标按 px 计算，字号恒定。
 */
export function useElementWidth<T extends HTMLElement>(fallback = 640): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const next = element.clientWidth;
      if (next > 0) setWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    };
    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
