import { useMemo, useState } from 'react';
import { useElementWidth } from './useElementWidth';

/**
 * 分数段定义：标签 / 颜色 / 下钻区间。
 *
 * 标签必须与后端 DISTRIBUTION_BUCKETS 的输出完全一致（'100'、'95-99.99' …），
 * 对不上时该段只展示、不支持下钻，避免前端猜区间把数据筛错。
 * 分数列是 DECIMAL(6,2)，两位小数，所以 99.99 这样的上界不会漏掉 99.995。
 */
export interface BucketMeta {
  label: string;
  color: string;
  /** 下钻区间；null = 该段不支持下钻 */
  range: { min: number; max: number } | null;
}

export const SCORE_BUCKET_META: BucketMeta[] = [
  { label: '100', color: '#237804', range: { min: 100, max: 150 } },
  { label: '95-99.99', color: '#52C41A', range: { min: 95, max: 99.99 } },
  { label: '90-94.99', color: '#13C2C2', range: { min: 90, max: 94.99 } },
  { label: '80-89.99', color: '#FAAD14', range: { min: 80, max: 89.99 } },
  { label: '60-79.99', color: '#FA8C16', range: { min: 60, max: 79.99 } },
  { label: '60以下', color: '#F5222D', range: { min: 0, max: 59.99 } },
];

export interface DistributionBucket {
  label: string;
  count: number;
  color: string;
  range: { min: number; max: number } | null;
}

export interface ScoreDistributionChartProps {
  buckets: DistributionBucket[];
  total: number;
  mode: 'bar' | 'pie';
  /** 当前选中的段位（用于高亮） */
  selectedLabel?: string | null;
  /** 点击某段；再次点击同一段传 null（取消下钻） */
  onSelect?: (bucket: DistributionBucket) => void;
  height?: number;
}

interface HoverState {
  index: number;
  x: number;
  y: number;
}

const PAD = { top: 30, right: 12, bottom: 38, left: 54 };

/** x 轴紧凑标签：'95-99.99' → '95-99'，'60以下' → '<60'；完整标签在图例与悬停提示里 */
function axisLabel(label: string): string {
  if (label === '60以下') return '<60';
  const dash = label.indexOf('-');
  if (dash > 0) return `${label.slice(0, dash)}-${label.slice(dash + 1).split('.')[0]}`;
  return label;
}

/**
 * 扇形坐标：0° 指向正上方，按顺时针递增。
 * 注意别用 cos/sin 的常规写法——SVG 的 y 轴向下，
 * 这里用 sin 走 x、-cos 走 y，才是「从 12 点顺时针」的正确约定。
 */
function pointAt(cx: number, cy: number, radius: number, angle: number): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [cx + radius * Math.sin(rad), cy - radius * Math.cos(rad)];
}

/** 扇形路径：圆心 → 起点 → 顺时针圆弧到终点 → 闭合回圆心 */
function arcPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const [x1, y1] = pointAt(cx, cy, radius, startAngle);
  const [x2, y2] = pointAt(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

/**
 * 分数分布图（纯 SVG，无图表库）。
 * 两种形态：柱状（看绝对条数与分布规律）、饼图（看占比）。
 * 支持悬停提示与点击下钻；下钻区间由调用方通过 bucket.range 决定。
 */
export default function ScoreDistributionChart({
  buckets,
  total,
  mode,
  selectedLabel,
  onSelect,
  height = 240,
}: ScoreDistributionChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>(720);
  const [hover, setHover] = useState<HoverState | null>(null);

  const maxCount = useMemo(() => Math.max(...buckets.map((item) => item.count), 1), [buckets]);
  const hovered = hover ? buckets[hover.index] : null;

  const handleMove = (index: number) => (event: React.MouseEvent<SVGGElement>) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setHover({ index, x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const handleClick = (bucket: DistributionBucket) => {
    if (!bucket.range) return;
    onSelect?.(bucket);
  };

  const barChart = (
    <svg width={width} height={height} role="img" aria-label="分数分布柱状图">
      <title>分数分布柱状图</title>
      {Array.from({ length: 5 }, (_, index) => {
        const value = (maxCount / 4) * index;
        const y = PAD.top + (height - PAD.top - PAD.bottom) - (value / maxCount) * (height - PAD.top - PAD.bottom);
        return (
          <g key={`grid-${index}`}>
            <line x1={PAD.left} y1={y} x2={width - PAD.right} y2={y} stroke="#f0f0f0" strokeWidth={1} />
            <text x={PAD.left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#8c8c8c">
              {Math.round(value).toLocaleString('zh-CN')}
            </text>
          </g>
        );
      })}
      <line x1={PAD.left} y1={height - PAD.bottom} x2={width - PAD.right} y2={height - PAD.bottom} stroke="#d9d9d9" />
      {buckets.map((bucket, index) => {
        const plotWidth = width - PAD.left - PAD.right;
        const plotHeight = height - PAD.top - PAD.bottom;
        const step = plotWidth / Math.max(buckets.length, 1);
        const barWidth = Math.min(52, step * 0.52);
        const x = PAD.left + index * step + (step - barWidth) / 2;
        const barHeight = (bucket.count / maxCount) * plotHeight;
        const y = PAD.top + plotHeight - barHeight;
        const selected = selectedLabel === bucket.label;
        const dimmed = selectedLabel != null && !selected;
        const percent = total > 0 ? (bucket.count / total) * 100 : 0;
        return (
          <g
            key={bucket.label}
            onMouseMove={handleMove(index)}
            onMouseLeave={() => setHover(null)}
            onClick={() => handleClick(bucket)}
            style={{ cursor: bucket.range ? 'pointer' : 'default' }}
          >
            <rect x={x - 6} y={PAD.top} width={barWidth + 12} height={plotHeight} fill="transparent" />
            {bucket.count > 0 ? (
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, 2)}
                rx={3}
                fill={bucket.color}
                opacity={dimmed ? 0.35 : 1}
                stroke={selected ? '#262626' : 'none'}
                strokeWidth={selected ? 1.5 : 0}
              />
            ) : (
              <rect x={x} y={PAD.top + plotHeight - 2} width={barWidth} height={2} fill="#e8e8e8" />
            )}
            <text
              x={x + barWidth / 2}
              y={y - 14}
              textAnchor="middle"
              fontSize={12}
              fontWeight={600}
              fill="#262626"
              opacity={dimmed ? 0.45 : 1}
            >
              {bucket.count.toLocaleString('zh-CN')}
            </text>
            <text
              x={x + barWidth / 2}
              y={y - 3}
              textAnchor="middle"
              fontSize={10}
              fill="#8c8c8c"
              opacity={dimmed ? 0.45 : 1}
            >
              {percent.toFixed(1)}%
            </text>
            <text
              x={x + barWidth / 2}
              y={height - PAD.bottom + 16}
              textAnchor="middle"
              fontSize={11}
              fill={selected ? '#262626' : '#595959'}
              fontWeight={selected ? 600 : 400}
            >
              {axisLabel(bucket.label)}
            </text>
          </g>
        );
      })}
    </svg>
  );

  const pieChart = (() => {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.max(40, Math.min(width, height) / 2 - 16);
    let cursor = 0;
    const segments = buckets
      .filter((bucket) => bucket.count > 0)
      .map((bucket) => {
        const angle = (bucket.count / total) * 360;
        const segment = { bucket, start: cursor, end: cursor + angle };
        cursor += angle;
        return segment;
      });
    return (
      <svg width={width} height={height} role="img" aria-label="分数分布饼图">
        <title>分数分布饼图</title>
        {segments.map(({ bucket, start, end }) => {
          const selected = selectedLabel === bucket.label;
          const dimmed = selectedLabel != null && !selected;
          const r = selected ? radius + 4 : radius;
          const percent = total > 0 ? (bucket.count / total) * 100 : 0;
          const [labelX, labelY] = pointAt(cx, cy, radius * 0.66, (start + end) / 2);
          return (
            <g
              key={bucket.label}
              onMouseMove={handleMove(buckets.findIndex((item) => item.label === bucket.label))}
              onMouseLeave={() => setHover(null)}
              onClick={() => handleClick(bucket)}
              style={{ cursor: bucket.range ? 'pointer' : 'default' }}
            >
              <path
                d={arcPath(cx, cy, r, start, end)}
                fill={bucket.color}
                stroke="#fff"
                strokeWidth={2}
                opacity={dimmed ? 0.35 : 1}
              />
              {percent >= 8 && (
                <text x={labelX} y={labelY + 4} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={600}>
                  {percent.toFixed(1)}%
                </text>
              )}
            </g>
          );
        })}
        {/* 中心数字：先铺一层白底，避免被扇区分隔线穿过 */}
        <circle cx={cx} cy={cy} r={40} fill="#fff" />
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={20} fontWeight={700} fill="#262626">
          {total.toLocaleString('zh-CN')}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize={11} fill="#8c8c8c">
          条记录
        </text>
      </svg>
    );
  })();

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {mode === 'pie' ? pieChart : barChart}
      {hover && hovered && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(Math.max(hover.x + 12, 8), Math.max(width - 150, 8)),
            top: Math.max(hover.y - 58, 4),
            background: 'rgba(0,0,0,0.78)',
            color: '#fff',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 12,
            lineHeight: 18,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 5,
          }}
        >
          <div>{hovered.label} 分</div>
          <div>
            {hovered.count.toLocaleString('zh-CN')} 条 · 占比{' '}
            {(total > 0 ? (hovered.count / total) * 100 : 0).toFixed(1)}%
          </div>
          {hovered.range ? <div style={{ opacity: 0.75 }}>点击按该分数段筛选明细</div> : null}
        </div>
      )}
    </div>
  );
}
