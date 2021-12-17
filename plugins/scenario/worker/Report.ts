import { Result } from './Parent';

export type Format = "console";

function pluralize(n, singular, plural = null) {
  if (n === 1) {
    return `${n} ${singular}`;
  } else {
    return `${n} ${plural || singular}`;
  }
}

export function loadFormat(str: string): Format {
  if (str === "console") {
    return "console";
  } else {
    throw new Error(`Unknown report format: ${str}`);
  }
}

function showReportConsole(results: Result[]) {
  let testCount = 0;
  let succCount = 0;
  let errCount = 0;
  let skipCount = 0;
  let totalTime = 0;
  let errors: Map<string, Error> = new Map();

  for (let {scenario, elapsed, error, skipped} of results) {
    if (skipped) {
      skipCount++;
    } else {
      testCount++;
      totalTime += elapsed;
      if (error) {
        errCount++;
        errors[scenario] = error;
      } else {
        succCount++;
      }
    }
  }

  for (let [scenario, error] of Object.entries(errors)) {
    console.error(`❌ ${scenario}: Error ${error.message}\n${error.stack}`);
  }

  let prefix = errCount === 0 ? "✅" : "❌";
  let avgTime = testCount > 0 ? totalTime / testCount : 0;
  let succText = pluralize(succCount, "success", "successes");
  let errText = pluralize(errCount, "error", "errors");
  let skipText = pluralize(skipCount, "skipped");
  let avgText = `[avg time: ${avgTime.toFixed(0)}ms]`;

  console.log(`\n\n${prefix} Results: ${succText}, ${errText}, ${skipText} ${avgText}\n`);
}

export function showReport(results: Result[], formats: Format[]) {
  formats.forEach((format) => {
    if (format === "console") {
      showReportConsole(results);
    }
  });
}
