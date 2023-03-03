import { Scenario, ScenarioEnv, Solution } from './Scenario';
import { ForkSpec, World } from './World';
import { Loader } from './Loader';
import { showReport, pluralize, Result } from './Report';
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

  async *applyStaticConstraints<T, U>(env: ScenarioEnv<T, U>): AsyncGenerator<T> {
    const { world } = this;
    const { constraints } = env;

    // snapshot the world initially
    let worldSnapshot = await world._snapshot();

    // generate worlds which satisfy the constraints
    // note: constraints should be independent or conflicts will be detected
    const solutionChoices: Solution<T>[][] = await Promise.all(
      constraints.map((c) => c.solve(world).then(mapSolution))
    );
    const baseSolutions: Solution<T>[][] = [[identity]];

    for (const combo of combos(baseSolutions.concat(solutionChoices))) {
      // create a fresh copy of context that solutions can modify
      // note: changes to the static ctx won't currently be shared with dynamic constraints
      //  if context forking is added back to the env it could be supported
      let ctx: T = await env.initializer(world);

      // apply each solution in the combo, then check they all still hold
      for (const solution of combo)
        ctx = (await solution(ctx, world)) || ctx;
      for (const constraint of constraints)
        await constraint.check(world);
      yield ctx;

      worldSnapshot = await world._revertAndSnapshot(worldSnapshot);
    }
  }

  async run(scenario: Scenario<T, U, R>, context: T): Promise<Result> {
    const { base, world } = this;
    const { constraints = [], env } = scenario;

    let startTime = Date.now();
    let numSolutionSets = 0;

    // snapshot the world initially
    let worldSnapshot = await world._snapshot();

    // generate worlds which satisfy the constraints
    // note: constraints should be independent or conflicts will be detected
    const solutionChoices: Solution<T>[][] = await Promise.all(
      constraints.map((c) => c.solve(scenario.requirements, context, world).then(mapSolution))
    );
    const baseSolutions: Solution<T>[][] = [[identity]];

    let cumulativeGas = 0;
    for (const combo of combos(baseSolutions.concat(solutionChoices))) {
      // create a fresh copy of context that solutions can modify
      // note: context is not 'forked' from the static constraint context
      //  a forker could be added back to the env if needed to support that
      let ctx: T = await env.initializer(world);

      try {
        // apply each solution in the combo, then check they all still hold
        for (const solution of combo) {
          ctx = (await solution(ctx, world)) || ctx;
        }

        for (const constraint of constraints) {
          await constraint.check(scenario.requirements, ctx, world);
        }

        // requirements met, run the property
        let txnReceipt = await scenario.property(await env.transformer(ctx), ctx, world);
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
      diff,
    };
  }
}

export async function runScenarios(bases: ForkSpec[]) {
  const loader = await Loader.load();
  const [runningScenarios, skippedScenarios] = loader.splitScenarios();

  const startTime = Date.now();
  const results: Result[] = [];

  for (const base of bases) {
    const world = new World(base), dm = world.deploymentManager;
    const delta = await dm.runDeployScript({ allMissing: true });
    console.log(`[${base.name}] Deployed ${dm.counter} contracts, spent ${dm.spent} to initialize world 🗺`);
    console.log(`[${base.name}]\n${dm.diffDelta(delta)}`);

    if (world.auxiliaryDeploymentManager) {
      await world.auxiliaryDeploymentManager.spider();
    }

    const runner = new Runner(base, world);

    // NB: contexts are (still) a bit awkward
    //  they prob dont even really need to get passed through here currently
    //  and story around context and world is weird
    for await (const context of await runner.applyStaticConstraints(loader.env())) {
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

      for (const scenario of runningScenarios) {
        console.log(`[${base.name}] Running ${scenario.name} ...`);
        try {
          const result = await runner.run(scenario, context), N = result.numSolutionSets;
          if (N) {
            console.log(`[${base.name}] ... ran ${scenario.name}`);
            console.log(`[${base.name}]  ⛽ consumed ${result.gasUsed} gas on average over ${pluralize(N, 'solution', 'solutions')}`);
          } else {
            console.log(`[${base.name}]   ∅ for ${scenario.name}, has empty constraint solution space`);
          }
          results.push(result);
        } catch (e) {
          console.error('Encountered worker error', e);
        }
      }
    }
  }

  await showReport(results, startTime, Date.now());
}
