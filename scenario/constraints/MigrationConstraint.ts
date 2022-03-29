import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { ProtocolConfiguration, deployComet } from '../../src/deploy';
import { getFuzzedRequirements } from './Fuzzing';
import CometAsset from '../context/CometAsset';
import { Contract } from 'ethers';
import { Requirements } from './Requirements';

import * as path from 'path';
import { Migration, loadMigrations } from '../../plugins/deployment_manager/Migration';

// TODO: Improvements
function getMigrationConfigs(requirements: Requirements): boolean {
  return requirements.migrate ?? false;
}

function* subsets<T>(array: T[], offset = 0): Generator<T[]> {
  while (offset < array.length) {
    let first = array[offset++];
    for (let subset of subsets(array, offset)) {
      subset.push(first);
      yield subset;
    }
  }
  yield [];
}

function debug(...args: any[]) {
  console.log(`[MigrationConstraint]`, ...args);
}

async function asyncFilter<T>(els: T[], f: (T) => Promise<boolean>): Promise<T[]> {
  let filterResults = await Promise.all(els.map((el) => f(el)));
  return els.filter((el, i) => filterResults[i]);
}

export class MigrationConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    let migrate = getMigrationConfigs(requirements);
    if (!migrate) {
      return null;
    }

    let solutions: Solution<T>[] = [];
    let migrationsGlob = path.join('deployments', context.deploymentManager.network(), 'migrations', '**.ts');
    let migrations = Object.values(await loadMigrations(migrationsGlob));
    let pendingMigrations = await asyncFilter(migrations, async (migration) => !await migration.actions.enacted(context.deploymentManager));
    for (let migrationList of subsets(pendingMigrations)) {
      solutions.push(async function (context: T): Promise<T> {
        migrationList.sort((a, b) => a.name.localeCompare(b.name))
        debug(`Running scenario with migrations: ${JSON.stringify(migrationList.map((migration) => migration.name))}`);
        for (let migration of migrationList) {
          debug(`Preparing migration ${migration.name}`);
          let artifact = await migration.actions.prepare(context.deploymentManager);
          debug(`Prepared migration ${migration.name}.\n  Artifact\n-------\n\n${JSON.stringify(artifact, null, 2)}\n-------\n`);
          debug(`Enacting migration ${migration.name}`);
          await migration.actions.enact(context.deploymentManager, artifact);
          // TODO: Check migration was enacted
          // if (!await migration.actions.enacted(context.deploymentManager)) {
          //   throw new Error(`Failed to enact: ${migration.name}`);
          // }
          debug(`Enacted migration ${migration.name}`);
        }
        debug(`Spidering...`);
        await context.deploymentManager.spider();
        debug(`Complete`);

        return context;
      });
    }

    return solutions;
  }

  async check(requirements: R, context: T, world: World) {
    return; // XXX
  }
}
