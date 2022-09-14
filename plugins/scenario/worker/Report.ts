import { Result } from './Parent';
import { diff as showDiff } from 'jest-diff';
import * as fs from 'fs/promises';

export interface ConsoleFormatOptions { }
export interface JsonFormatOptions {
  output?: string;
}

export type FormatConfig = {
  console?: ConsoleFormatOptions;
  json?: JsonFormatOptions;
}

export function pluralize(n, singular, plural = null) {
  if (n === 1) {
    return `${n} ${singular}`;
  } else {
    return `${n} ${plural || singular}`;
  }
}

async function showReportConsole(results: Result[], _consoleOptions: ConsoleFormatOptions, _startTime: number, _endTime: number) {
  const statsPer: object = {}, getStats = (base) => {
    return statsPer[base] = statsPer[base] || {
      skipCount: 0,
      testCount: 0,
      totalTime: 0,
      succCount: 0,
      errCount: 0,
    };
  };
  const errors: {
    base: string;
    scenario: string;
    error: Error;
    trace?: string;
    diff?: { actual: any, expected: any };
  }[] = [];

  for (const { base, scenario, elapsed, error, trace, diff, skipped } of results) {
    const stats = getStats(base);
    if (skipped) {
      stats.skipCount++;
    } else {
      stats.testCount++;
      stats.totalTime += elapsed;
      if (error) {
        stats.errCount++;
        errors.push({ base, scenario, error, trace, diff });
      } else {
        stats.succCount++;
      }
    }
  }

  for (const { base, scenario, error, trace, diff } of errors) {
    console.error(`[${base}] ❌ ${scenario}: Error ${trace || error.message}`);
    if (diff) {
      console.error(showDiff(diff.expected, diff.actual));
    }
  }

  console.log('\n\n');
  for (const [base, stats] of Object.entries(statsPer)) {
    const prefix = stats.errCount === 0 ? '✅' : '❌';
    const avgTime = stats.testCount > 0 ? stats.totalTime / stats.testCount : 0;
    const succText = pluralize(stats.succCount, 'success', 'successes');
    const errText = pluralize(stats.errCount, 'error', 'errors');
    const skipText = pluralize(stats.skipCount, 'skipped');
    const avgText = `[avg time: ${avgTime.toFixed(0)}ms]`;
    const totalText = `[total time: ${stats.totalTime.toFixed(0)}ms]`;
    console.log(`${prefix} Results: ${succText}, ${errText}, ${skipText} ${avgText} ${totalText} [${base}]`);
  }
  console.log('\n');
}

interface JsonTestResult {
  title: string;
  fullTitle: string;
  file: string;
  gasUsed: number;
  numSolutionSets: number;
  duration: number;
  currentRetry: number;
  err: any;
}

interface JsonSuiteResult {
  stats: {
    suites: number;
    tests: number;
    passes: number;
    pending: number;
    failures: number;
    start: string;
    end: string;
    duration: number;
  };
  tests: JsonTestResult[];
  pending: JsonTestResult[];
  failures: JsonTestResult[];
  passes: JsonTestResult[];
}

async function showJsonReport(results: Result[], jsonOptions: JsonFormatOptions, startTime: number, endTime: number) {
  // TODO: Accept options, etc.
  let suites = new Set();
  let passes: JsonTestResult[] = [];
  let pending: JsonTestResult[] = [];
  let failures: JsonTestResult[] = [];
  let tests: JsonTestResult[] = results.map((result) => {
    let suite = result.file; // TODO: Is this how we should do suites?
    suites.add(suite);

    let test = {
      title: result.scenario,
      fullTitle: `${result.base} ${result.scenario}`,
      file: result.file,
      gasUsed: result.gasUsed ?? 0,
      numSolutionSets: result.numSolutionSets ?? 0,
      duration: result.elapsed || 0,
      currentRetry: 0,
      err: result.error ? result.error.message : {} // Not sure
    };

    if (result.error) {
      failures.push(test);
    } else if (result.skipped) {
      pending.push(test);
    } else {
      passes.push(test);
    }

    return test;
  });

  let suiteResult: JsonSuiteResult = {
    stats: {
      suites: suites.size,
      tests: tests.length,
      passes: passes.length,
      pending: pending.length,
      failures: failures.length,
      start: new Date(startTime).toISOString(),
      end: new Date(endTime).toISOString(),
      duration: endTime - startTime,
    },
    tests,
    pending,
    failures,
    passes,
  };

  let result = JSON.stringify(suiteResult, null, 4);

  if (jsonOptions.output) {
    await fs.writeFile(jsonOptions.output, result);
  } else {
    console.log(result);
  }
}

export async function showReport(results: Result[], format: FormatConfig, startTime: number, endTime: number) {
  if (format.console) {
    await showReportConsole(results, format.console, startTime, endTime);
  }
  if (format.json) {
    await showJsonReport(results, format.json, startTime, endTime);
  }
}
