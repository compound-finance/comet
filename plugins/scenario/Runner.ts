import { Scenario, Solution } from './Scenario';
import { ForkSpec, World } from './World';
import { loadScenarios } from './Loader';
import { showReport, pluralize, Result } from './Report';
import { ScenarioConfig } from './types';
import { AssertionError } from 'chai';

export type Address = string;

export type ResultFn<T, U, R> = (base: ForkSpec, scenario: Scenario<T, U, R>, err?: any) => void;

function* combos<T>(choices: T[][]): Generator<T[]> {
  if (choices.length == 0) {
    yield [];
  } else {
    for (const option of choices[0])
      for (const combo of combos(choices.slice(1))) yield [option, ...combo];
  }
}

async function identity<T>(ctx: T, _world: World): Promise<T> {
  return ctx;
}

function asList<T>(v: T | T[]): T[] {
  return [].concat(v);
}

function mapSolution<T>(s: Solution<T> | Solution<T>[] | null): Solution<T>[] {
  if (s == null) {
    return [identity];
  } else {
    return asList(s);
  }
}

export class Runner<T, U, R> {
  base: ForkSpec;
  world: World;

  constructor(base: ForkSpec, world: World) {
    this.base = base;
    this.world = world;
  }

  async run(scenario: Scenario<T, U, R>): Promise<Result> {
    const { base, world } = this;
    const { constraints = [] } = scenario;
    let startTime = Date.now();
    let numSolutionSets = 0;

    // snapshot the world initially
    let worldSnapshot = await world._snapshot();

    // get a context to use for solving constraints
    const getContext = (world) => scenario.initializer(world); // XXXX
    const context = await getContext(world);

    // generate worlds which satisfy the constraints
    // note: `solve` is expected not to modify context or world
    //  and constraints should be independent or conflicts will be detected
    const solutionChoices: Solution<T>[][] = await Promise.all(
      constraints.map((c) => c.solve(scenario.requirements, context, world).then(mapSolution))
    );
    const baseSolutions: Solution<T>[][] = [[identity]];

    let cumulativeGas = 0;
    for (const combo of combos(baseSolutions.concat(solutionChoices))) {
      // create a fresh copy of context that solutions can modify
      let ctx: T = await getContext(world);

      try {
        // apply each solution in the combo, then check they all still hold
        for (const solution of combo) {
          ctx = (await solution(ctx, world)) || ctx;
        }

        for (const constraint of constraints) {
          await constraint.check(scenario.requirements, ctx, world);
        }

        // requirements met, run the property
        let txnReceipt = await scenario.property(await scenario.transformer(ctx), ctx, world);
        if (txnReceipt) {
          cumulativeGas += txnReceipt.cumulativeGasUsed.toNumber();
        }
        numSolutionSets++;
      } catch (e) {
        // TODO: Include the specific solution (set of states) that failed in the result
        return this.generateResult(base, scenario, startTime, 0, ++numSolutionSets, e);
      } finally {
        worldSnapshot = await world._revertAndSnapshot(worldSnapshot);
      }
    }
    // Send success result only after all combinations of solutions have passed for this scenario.
    return this.generateResult(base, scenario, startTime, cumulativeGas, numSolutionSets);
  }

  private generateResult(
    base: ForkSpec,
    scenario: Scenario<T, U, R>,
    startTime: number,
    totalGas: number,
    numSolutionSets: number,
    err?: any
  ): Result {
    let diff = null;
    if (err instanceof AssertionError) {
      let { actual, expected } = <any>err; // Types unclear
      if (actual !== expected) {
        diff = { actual, expected };
      }
    }

    return {
      base: base.name,
      file: scenario.file || scenario.name,
      scenario: scenario.name,
      gasUsed: totalGas / numSolutionSets,
      numSolutionSets,
      elapsed: Date.now() - startTime,
      error: err || null,
      trace: err && err.stack ? err.stack : err,
      diff, // XXX can we move this into parent?
    };
  }
}

function filterRunning<T, U, R>(
  scenarios: Scenario<T, U, R>[]
): [Scenario<T, U, R>[], Scenario<T, U, R>[]] {
  const rest = scenarios.filter(s => s.flags === null);
  const only = scenarios.filter(s => s.flags === 'only');
  const skip = scenarios.filter(s => s.flags === 'skip');

  if (only.length > 0) {
    return [only, skip.concat(rest)];
  } else {
    return [rest, skip];
  }
}

export async function runScenario<T, U, R>(
  scenarioConfig: ScenarioConfig,
  bases: ForkSpec[],
) {
  const scenarios: Scenario<T, U, R>[] = Object.values(await loadScenarios());
  const [runningScenarios, skippedScenarios] = filterRunning(scenarios);

  const results: Result[] = [];

  const startTime = Date.now();

  const runners = {}; // XXX

  for (const base of bases) {
    const world = new World(base), dm = world.deploymentManager;
    const delta = await dm.runDeployScript({ allMissing: true });
    console.log(`[${base.name}] Deployed ${dm.counter} contracts, spent ${dm.spent} to initialize world 🗺`);
    console.log(`[${base.name}]\n${dm.diffDelta(delta)}`);

    if (world.auxiliaryDeploymentManager) {
      await world.auxiliaryDeploymentManager.spider();
    }

    runners[base.name] = new Runner(base, world); // XXX

    for (const scenario of skippedScenarios) {
      results.push({
        base: base.name,
        file: scenario.file || scenario.name,
        scenario: scenario.name,
        elapsed: undefined,
        error: undefined,
        skipped: true,
      });
    }

    for (const scenario of runningScenarios) { // XXX
      console.log(`[${base.name}] Running ${scenario.name} ...`);
      try {
        const result = await runners[base.name].run(scenario);
        const numSolutionSets = result.numSolutionSets ?? 0;
        console.log(`[${base.name}] ... ran ${scenario.name} on ${pluralize(numSolutionSets, 'solution', 'solutions')}`);
        // XXX
        // Update the scenario name to include the number of solution sets run and average gas cost.
        result.scenario += ` [${pluralize(numSolutionSets, 'run', 'runs')}]`;
        if (result.gasUsed) {
          result.scenario += ` [Avg gas: ${result.gasUsed}]`;
        }
        results.push(result);
      } catch (e) {
        console.error('Encountered worker error', e);
      }
    }
  }

  const endTime = Date.now();

  await showReport(results, startTime, endTime);
}
