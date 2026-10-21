/**
 * 分数段定义（月度考核 / 后评估共用同一套展示口径）
 *
 * 标签必须与前端 `components/charts/ScoreDistributionChart.tsx` 的 SCORE_BUCKET_META 完全一致，
 * 对不上前端只展示不下钻。边界：
 *   100 ≥100 / 95-99.99 / 90-94.99 / 80-89.99 / 60-79.99 / 60以下
 */
export const SCORE_BUCKET_LABELS = ['100', '95-99.99', '90-94.99', '80-89.99', '60-79.99', '60以下'] as const;

export type ScoreBucketLabel = (typeof SCORE_BUCKET_LABELS)[number];

export function bucketOf(score: number): ScoreBucketLabel {
  if (score >= 100) return '100';
  if (score >= 95) return '95-99.99';
  if (score >= 90) return '90-94.99';
  if (score >= 80) return '80-89.99';
  if (score >= 60) return '60-79.99';
  return '60以下';
}

/** 全部段位都返回（0 也要出现），前端柱状图才不会缺柱 */
export function emptyDistribution(): Array<{ bucket: ScoreBucketLabel; count: number }> {
  return SCORE_BUCKET_LABELS.map((bucket) => ({ bucket, count: 0 }));
}

export function buildDistribution(scores: number[]): Array<{ bucket: ScoreBucketLabel; count: number }> {
  const distribution = emptyDistribution();
  const index = new Map(distribution.map((item) => [item.bucket, item]));
  for (const score of scores) {
    const bucket = index.get(bucketOf(score));
    if (bucket) bucket.count += 1;
  }
  return distribution;
}
