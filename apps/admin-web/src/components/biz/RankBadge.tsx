/**
 * 排名徽章（后评估成绩单与月度考核共用）
 *
 * 视觉口径：前三名用深浅绿，其余灰底；null 显示「-」。
 * 抽公共件前这段 JSX 只在 SupplierScorecard 里，月度考核那边只能另写一份，
 * 两边样式很容易漂移，所以统一到这里，调用方只传 rank。
 */
export default function RankBadge({ rank }: { rank: number | null | undefined }) {
  if (rank === null || rank === undefined) return <span style={{ color: '#999' }}>-</span>;
  const color = rank === 1 ? '#237804' : rank === 2 ? '#52c41a' : rank === 3 ? '#95de64' : '#d9d9d9';
  const textColor = rank <= 3 ? '#fff' : '#333';
  return (
    <span style={{
      display: 'inline-block', minWidth: 22, padding: '0 6px', borderRadius: 10,
      background: color, color: textColor, fontSize: 12, lineHeight: '18px',
    }}>{rank}</span>
  );
}
