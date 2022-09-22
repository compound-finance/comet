import { Scenario, Solution } from './Scenario';
import { ForkSpec, Snapshot, World } from './World';
import { Result } from './worker/Parent';
import { AssertionError } from 'chai';

export type Address = string;

export type ResultFn<T, U, R> = (base: ForkSpec, scenario: Scenario<T, U, R>, err?: any) => void;

export interface Config {
  base: ForkSpec;
  world: World;
}

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
  config: Config;
  worldSnapshot: Snapshot;

  constructor(config: Config) {
    this.config = config;
  }

  async run(scenario: Scenario<T, U, R>): Promise<Result> {
    const { config } = this;
    const { base, world } = config;
    const { constraints = [] } = scenario;
    let startTime = Date.now();
    let numSolutionSets = 0;

    // reset the world if a snapshot exists and take a snapshot of it
    if (this.worldSnapshot) {
      this.worldSnapshot = await world._revertAndSnapshot(this.worldSnapshot);
    } else {
      this.worldSnapshot = await world._snapshot();
    }

    // initialize the context and take a snapshot of it
    let context = await scenario.initializer(world);
    let contextSnapshot = this.worldSnapshot;

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
      let ctx: T = await scenario.forker(context, world);

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
        contextSnapshot = await world._revertAndSnapshot(contextSnapshot);
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
