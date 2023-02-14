import { Constraint, Solution, World, debug } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';
import { Migration, loadMigrations, Actions } from '../../plugins/deployment_manager/Migration';
import { modifiedPaths, subsets } from '../utils';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';

async function getMigrations<T>(context: CometContext, _requirements: Requirements): Promise<Migration<T>[]> {
  // TODO: make this configurable from cli params/env var?
  const network = context.world.deploymentManager.network;
  const deployment = context.world.deploymentManager.deployment;
  const pattern = new RegExp(`deployments/${network}/${deployment}/migrations/.*.ts`);
  return await loadMigrations((await modifiedPaths(pattern)).map(p => '../../' + p));
}

async function isEnacted<T>(actions: Actions<T>, deploymentManager: DeploymentManager): Promise<boolean> {
  return actions.enacted && await actions.enacted(deploymentManager);
}

export class MigrationConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    const label = `[${world.base.name}] {MigrationConstraint}`;
    const solutions: Solution<T>[] = [];
    const migrationPaths = [...subsets(await getMigrations(context, requirements))];

    for (const migrationList of migrationPaths) {
      if (migrationList.length == 0 && migrationPaths.length > 1) {
        if (!process.env['WITHOUT_MIGRATIONS']) {
          debug(`${label} Skipping empty migration`);
          continue;
        }
      }
      solutions.push(async function (ctx: T): Promise<T> {
        const governanceDeploymentManager = ctx.world.auxiliaryDeploymentManager || ctx.world.deploymentManager;
        const compWhale = (await ctx.getCompWhales())[0];
        const proposer = await impersonateAddress(governanceDeploymentManager, compWhale);

        // Make proposer the default signer
        governanceDeploymentManager._signers.unshift(proposer);

        // Order migrations deterministically and store in the context (i.e. for verification)
        migrationList.sort((a, b) => a.name.localeCompare(b.name));
        ctx.migrations = migrationList;

        debug(`${label} Running scenario with migrations: ${JSON.stringify(migrationList.map((m) => m.name))}`);
        for (const migration of migrationList) {
          const artifact = await migration.actions.prepare(ctx.world.deploymentManager);
          debug(`${label} Prepared migration ${migration.name}.\n  Artifact\n-------\n\n${JSON.stringify(artifact, null, 2)}\n-------\n`);
          if (await isEnacted(migration.actions, ctx.world.deploymentManager)) {
            debug(`${label} Migration ${migration.name} has already been enacted`);
          } else {
            await migration.actions.enact(ctx.world.deploymentManager, governanceDeploymentManager, artifact);
            debug(`${label} Enacted migration ${migration.name}`);
          }
        }

        // Remove proposer from signers
        governanceDeploymentManager._signers.shift();

        return ctx;
      });
    }

    return solutions;
  }

  async check(_requirements: R, _context: T, _world: World) {
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
          if (migration.actions.verify && !(await isEnacted(migration.actions, ctx.world.deploymentManager))) {
            await migration.actions.verify(ctx.world.deploymentManager);
            debug(`${label} Verified migration "${migration.name}"`);
          }
        }
        return ctx;
      }
    ];
  }

  async check(_requirements: R, _context: T, _world: World) {
    return; // XXX
  }
}
