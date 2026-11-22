export const MAX_TEAM_DAILY_REST = 50;
export const WEEKDAY_STAFFING_TARGET = 81;
export const WEEKDAY_STAFFING_FLOOR = 80;
export const WEEKEND_STAFFING_TARGET = 96;

export function calculateRestQuotas(
  teams: { id: string; riderCount: number }[],
  days: { key: string; isWeekend: boolean }[],
  usedLimits: Record<string, number>,
) {
  const riderCount = teams.reduce((total, team) => total + team.riderCount, 0);
  const limits: Record<string, number> = {};
  const dayTotals = days.map(() => 0);
  const remaining = teams.map((team) => {
    const used = days.reduce((total, day, index) => {
      const count = usedLimits[`${team.id}:${day.key}`] ?? 0;
      limits[`${team.id}:${day.key}`] = count;
      dayTotals[index] += count;
      return total + count;
    }, 0);
    return Math.max(0, team.riderCount - used);
  });
  const targets = days.map((day) => day.isWeekend ? WEEKEND_STAFFING_TARGET : WEEKDAY_STAFFING_TARGET);
  const targetCaps = targets.map((rate) => Math.floor(riderCount * (100 - rate) / 100));

  function fill(caps: number[]) {
    function place(teamIndex: number, visited: Set<number>): boolean {
      const team = teams[teamIndex];
      const candidates = days.map((day, index) => ({
        index,
        key: `${team.id}:${day.key}`,
        // Prefer days farther from their target, then teams under their proportional share.
        gap: targetCaps[index] - dayTotals[index],
        share: (dayTotals[index] + 1) * team.riderCount - limits[`${team.id}:${day.key}`] * riderCount,
      })).filter(({ index, key }) =>
        !visited.has(index) && limits[key] < Math.min(team.riderCount, MAX_TEAM_DAILY_REST),
      ).sort((a, b) => b.gap - a.gap || b.share - a.share);

      for (const { index, key } of candidates) {
        if (visited.has(index) || dayTotals[index] >= caps[index]) continue;
        limits[key] += 1;
        dayTotals[index] += 1;
        return true;
      }

      // Make room by moving a generated quota to another day when direct placement fails.
      for (const { index, key } of candidates) {
        if (visited.has(index) || dayTotals[index] > caps[index]) continue;
        visited.add(index);
        for (const [otherIndex, otherTeam] of teams.entries()) {
          if (otherIndex === teamIndex) continue;
          const otherKey = `${otherTeam.id}:${days[index].key}`;
          if (limits[otherKey] <= (usedLimits[otherKey] ?? 0) || !place(otherIndex, visited)) continue;
          limits[otherKey] -= 1;
          limits[key] += 1;
          return true;
        }
      }
      return false;
    }

    // On each day, give the next slot to the team furthest below its share.
    while (true) {
      const candidates = days.map((_, index) => index).filter((index) =>
        dayTotals[index] < caps[index],
      ).sort((a, b) => (targetCaps[b] - dayTotals[b]) - (targetCaps[a] - dayTotals[a]));
      let placed = false;
      for (const index of candidates) {
        const day = days[index];
        const teamIndexes = teams.map((_, teamIndex) => teamIndex).filter((teamIndex) => {
          const team = teams[teamIndex];
          return remaining[teamIndex] > 0 &&
            limits[`${team.id}:${day.key}`] < Math.min(team.riderCount, MAX_TEAM_DAILY_REST);
        }).sort((a, b) => {
          const deficit = (teamIndex: number) => (dayTotals[index] + 1) * teams[teamIndex].riderCount
            - limits[`${teams[teamIndex].id}:${day.key}`] * riderCount;
          return deficit(b) - deficit(a) || remaining[b] - remaining[a];
        });
        const teamIndex = teamIndexes[0];
        if (teamIndex === undefined) continue;
        limits[`${teams[teamIndex].id}:${day.key}`] += 1;
        dayTotals[index] += 1;
        remaining[teamIndex] -= 1;
        placed = true;
        break;
      }
      if (placed) continue;
      const teamIndex = remaining.findIndex((count, index) => count > 0 && place(index, new Set()));
      if (teamIndex === -1) break;
      remaining[teamIndex] -= 1;
    }
  }

  fill(targetCaps);
  fill(days.map((day, index) => day.isWeekend
    ? targetCaps[index]
    : Math.floor(riderCount * (100 - WEEKDAY_STAFFING_FLOOR) / 100)));

  return limits;
}
