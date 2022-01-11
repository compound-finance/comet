import { Result } from './Parent';
import { diff as showDiff } from 'jest-diff';

export type Format = 'console' | 'json';

function pluralize(n, singular, plural = null) {
  if (n === 1) {
    return `${n} ${singular}`;
  } else {
    return `${n} ${plural || singular}`;
  }
}

export function loadFormat(str: string): Format {
  if (str === 'console') {
    return 'console';
  } else if (str === 'json') {
    return 'json';
  } {
    throw new Error(`Unknown report format: ${str}`);
  }
}

function showReportConsole(results: Result[], startTime: number, endTime: number) {
  let testCount = 0;
  let succCount = 0;
  let errCount = 0;
  let skipCount = 0;
  let totalTime = 0;
  let errors: {
    base: string;
    scenario: string;
    error: Error;
    trace?: string;
    diff?: { actual: any; expected: any };
  }[] = [];

  for (let { base, scenario, elapsed, error, trace, diff, skipped } of results) {
    if (skipped) {
      skipCount++;
    } else {
      testCount++;
      totalTime += elapsed;
      if (error) {
        errCount++;
        errors.push({ base, scenario, error, trace, diff });
      } else {
        succCount++;
      }
    }
  }

  for (let { base, scenario, error, trace, diff } of errors) {
    console.error(`❌ ${scenario}@${base}: Error ${trace || error.message}`);
    if (diff) {
      console.error(showDiff(diff.expected, diff.actual));
    }
  }

  let prefix = errCount === 0 ? '✅' : '❌';
  let avgTime = testCount > 0 ? totalTime / testCount : 0;
  let succText = pluralize(succCount, 'success', 'successes');
  let errText = pluralize(errCount, 'error', 'errors');
  let skipText = pluralize(skipCount, 'skipped');
  let avgText = `[avg time: ${avgTime.toFixed(0)}ms]`;

  console.log(`\n\n${prefix} Results: ${succText}, ${errText}, ${skipText} ${avgText}\n`);
}

interface Test {
  title: string,
  fullTitle: string,
  file: string,
  duration: number,
  currentRetry: number,
  err: any
};

function showJsonReport(results: Result[], startTime: number, endTime: number) {
  // TODO: Accept options, etc.
  let suites = new Set();
  let passes: Test[] = [];
  let pending: Test[] = [];
  let failures: Test[] = [];
  let tests: Test[] = results.map((result) => {
    let suite = result.file; // TODO: Is this how we should do suites?
    suites.add(suite);

    let test = {
      title: result.scenario,
      fullTitle: `${result.base} ${result.scenario}`,
      file: result.file,
      duration: result.elapsed || 0,
      currentRetry: 0,
      err: result.error ?? {}
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

  console.log(JSON.stringify({
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
  }, null, 2));
}

export function showReport(results: Result[], formats: Format[], startTime: number, endTime: number) {
  formats.forEach((format) => {
    if (format === 'console') {
      showReportConsole(results, startTime, endTime);
    } else if (format === 'json') {
      showJsonReport(results, startTime, endTime);
    }
  });
}
