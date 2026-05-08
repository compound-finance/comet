// Phase 4.3 — analyze a `soak-log.jsonl` file. Computes:
//   - total iterations, success / failure counts + landing rate
//   - p50 / p95 / p99 latency over successful iterations
//   - error breakdown by category (substring match on first 80 chars)
//   - longest streak of consecutive successes (hours-without-incident)
//
// Run: npx tsx scripts/marcus-stress/analyze-soak.ts [path/to/log.jsonl]
//      Default path: scripts/marcus-stress/soak-log.jsonl

import * as fs from 'fs';
import * as path from 'path';

interface SoakRecord {
  ts: string;
  iter: number;
  status: 'complete' | 'failed';
  latencyMs: number;
  error?: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[i];
}

function main() {
  const logPath = process.argv[2] ??
    path.join(__dirname, 'soak-log.jsonl');
  if (!fs.existsSync(logPath)) {
    console.error(`No log at ${logPath}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter(Boolean);
  const records: SoakRecord[] = lines.map(l => JSON.parse(l) as SoakRecord);

  if (records.length === 0) {
    console.log('Empty log.');
    return;
  }

  const total = records.length;
  const successes = records.filter(r => r.status === 'complete');
  const failures = records.filter(r => r.status === 'failed');
  const landingRate = (successes.length / total) * 100;

  console.log(`══════ Soak summary ══════`);
  console.log(`Log:              ${logPath}`);
  console.log(`Range:            ${records[0].ts} → ${records[records.length - 1].ts}`);
  console.log(`Total iterations: ${total}`);
  console.log(`Successes:        ${successes.length}`);
  console.log(`Failures:         ${failures.length}`);
  console.log(`Landing rate:     ${landingRate.toFixed(2)}%`);
  console.log('');

  if (successes.length > 0) {
    const lats = successes.map(r => r.latencyMs).sort((a, b) => a - b);
    console.log(`Latency (success only):`);
    console.log(`  p50:  ${(percentile(lats, 0.50) / 1000).toFixed(1)}s`);
    console.log(`  p95:  ${(percentile(lats, 0.95) / 1000).toFixed(1)}s`);
    console.log(`  p99:  ${(percentile(lats, 0.99) / 1000).toFixed(1)}s`);
    console.log(`  max:  ${(lats[lats.length - 1] / 1000).toFixed(1)}s`);
    console.log('');
  }

  if (failures.length > 0) {
    const errCounts = new Map<string, number>();
    for (const f of failures) {
      const key = (f.error ?? 'unknown').slice(0, 80);
      errCounts.set(key, (errCounts.get(key) ?? 0) + 1);
    }
    console.log(`Error breakdown:`);
    const sorted = [...errCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [err, cnt] of sorted) {
      console.log(`  ${cnt.toString().padStart(4)}× ${err}`);
    }
    console.log('');
  }

  // Longest success streak (in iterations + hours).
  let longestStreak = 0;
  let currentStreak = 0;
  let streakStartIter = 0;
  let bestStart = 0;
  let bestEnd = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.status === 'complete') {
      if (currentStreak === 0) streakStartIter = i;
      currentStreak += 1;
      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
        bestStart = streakStartIter;
        bestEnd = i;
      }
    } else {
      currentStreak = 0;
    }
  }
  if (longestStreak > 0) {
    const startTs = new Date(records[bestStart].ts).getTime();
    const endTs = new Date(records[bestEnd].ts).getTime();
    const hours = (endTs - startTs) / 3600 / 1000;
    console.log(`Longest success streak: ${longestStreak} iterations (~${hours.toFixed(1)}h)`);
  }
}

main();
