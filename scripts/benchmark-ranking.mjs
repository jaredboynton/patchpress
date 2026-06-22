// Combined quality + speed index for compaction benchmark lanes (bench-combined.v1).
// See docs/benchmark.md "Combined ranking formula".

export const RANKING_V1 = {
  schema: "bench-combined.v1",
  quality: {
    detWeight: 0.65,
    judgeWeight: 0.35,
    gateFailMultiplier: 0.88,
  },
  blend: {
    qualityWeight: 0.6,
    speedWeight: 0.4,
  },
  speed: {
    targetWallSeconds: 15,
  },
};

export function qualityIndex({ deterministicScore, judgeScore, gatePass }) {
  if (!Number.isFinite(deterministicScore) || !Number.isFinite(judgeScore)) return null;
  let quality =
    RANKING_V1.quality.detWeight * deterministicScore + RANKING_V1.quality.judgeWeight * (judgeScore * 10);
  if (gatePass === false) quality *= RANKING_V1.quality.gateFailMultiplier;
  return round1(quality);
}

export function speedIndex(wallSeconds) {
  if (!Number.isFinite(wallSeconds) || wallSeconds <= 0) return null;
  return round1(Math.min(100, (RANKING_V1.speed.targetWallSeconds / wallSeconds) * 100));
}

export function combinedIndex(quality, speed) {
  if (!Number.isFinite(quality) || !Number.isFinite(speed)) return null;
  return round1(
    RANKING_V1.blend.qualityWeight * quality + RANKING_V1.blend.speedWeight * speed,
  );
}

export function rankRows(rows) {
  const sortable = rows.filter((row) => Number.isFinite(row.combined));
  sortable.sort((a, b) => {
    if (b.combined !== a.combined) return b.combined - a.combined;
    if (b.quality !== a.quality) return b.quality - a.quality;
    if (a.wallSeconds !== b.wallSeconds) return a.wallSeconds - b.wallSeconds;
    return String(a.laneId).localeCompare(String(b.laneId));
  });
  let rank = 0;
  for (const row of sortable) row.rank = ++rank;
  for (const row of rows) {
    if (!Number.isFinite(row.combined)) row.rank = null;
  }
  return rows;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
