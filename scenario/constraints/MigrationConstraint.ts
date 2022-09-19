import { Constraint, Solution, World, debug } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';
import { Migration, loadMigrations } from '../../plugins/deployment_manager/Migration';
import { modifiedPaths, subsets } from '../utils';

async function getMigrations<T>(context: CometContext, requirements: Requirements): Promise<Migration<T>[]> {
  // TODO: make this configurable from cli params/env var?
  const network = context.world.deploymentManager.network;
  const deployment = context.world.deploymentManager.deployment;
  const pattern = new RegExp(`deployments/${network}/${deployment}/migrations/.*.ts`);
  return await loadMigrations((await modifiedPaths(pattern)).map(p => '../../' + p));
}

export class MigrationConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    const label = `[${world.base.name}] {MigrationConstraint}`;
    const solutions: Solution<T>[] = [];

    for (const migrationList of subsets(await getMigrations(context, requirements))) {
      solutions.push(async function (ctx: T): Promise<T> {
        const proposer = await ctx.getProposer();

        // Make proposer the default signer
        ctx.world.deploymentManager._signers.unshift(proposer);

        // Order migrations deterministically and store in the context (i.e. for verification)
        migrationList.sort((a, b) => a.name.localeCompare(b.name))
        ctx.migrations = migrationList;

        // XXX This should check that a migration has not already been run/proposed on-chain.
        // Otherwise the scenario could be running the same proposal twice.
        debug(`${label} Running scenario with migrations: ${JSON.stringify(migrationList.map((m) => m.name))}`);
        for (const migration of migrationList) {
          const artifact = await migration.actions.prepare(ctx.world.deploymentManager);
          debug(`${label} Prepared migration ${migration.name}.\n  Artifact\n-------\n\n${JSON.stringify(artifact, null, 2)}\n-------\n`);
          // XXX enact will take the 'gov' deployment manager instead of the 'local' one
          await migration.actions.enact(ctx.world.deploymentManager, artifact);
          debug(`${label} Enacted migration ${migration.name}`);
        }

        // Remove proposer from signers
        ctx.world.deploymentManager._signers.shift();

        return ctx;
      });
    }

    return solutions;
  }

  async check(requirements: R, context: T, world: World) {
    return; // XXX
  }
}

export class VerifyMigrationConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    const label = `[${world.base.name}] {VerifyMigrationConstraint}`;
    return [
      async function (ctx: T): Promise<T> {
        for (const migration of ctx.migrations) {
          // XXX does verify get the 'gov' deployment manager as well as the 'local' one?
          if (migration.actions.verify) {
            await migration.actions.verify(ctx.world.deploymentManager);
            debug(`${label} Verified migration "${migration.name}"`);
          }
        }
        return ctx;
      }
    ];
  }

  async check(requirements: R, context: T, world: World) { }
}
