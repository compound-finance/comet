import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { Contract } from 'ethers';
import { Requirements } from './Requirements';
import { Migration, loadMigrations } from '../../plugins/deployment_manager/Migration';

import { execSync } from 'child_process';
import { existsSync } from 'fs';

async function getMigrations<T>(context: CometContext, requirements: Requirements): Promise<Migration<T>[]> {
  // TODO: make this configurable from cli params/env var?
  const deployment = context.deploymentManager.deployment; // XXX should become per instance
  const output = execSync(`git diff --numstat main | grep 'deployments/${deployment}/{deploys,changes}/.*.ts' | awk '{ print $3 }'`);
  const modified = output.toString().split('\n').filter(existsSync);
  return Object.values(await loadMigrations(modified));
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
    let solutions: Solution<T>[] = [];

    for (let migrationList of subsets(await getMigrations(context, requirements))) {
      solutions.push(async function (context: T): Promise<T> {
        // ensure that signer is a governor of the timelock before attempting to run migrations
        // XXX why?
        const { admin, signer } = context.actors;
        const governor = await context.getGovernor();
        await governor.connect(admin.signer).addAdmin(signer.address);

        migrationList.sort((a, b) => a.name.localeCompare(b.name))
        debug(`Running scenario with migrations: ${JSON.stringify(migrationList.map((m) => m.name))}`);
        for (let migration of migrationList) {
          debug(`Preparing migration ${migration.name}`);
          let artifact = await migration.actions.prepare(context.deploymentManager);
          debug(`Prepared migration ${migration.name}.\n  Artifact\n-------\n\n${JSON.stringify(artifact, null, 2)}\n-------\n`);
          // XXX enact will take the 'gov' deployment manager instead of the 'local' one
          debug(`Enacting migration ${migration.name}`);
          await migration.actions.enact(context.deploymentManager, artifact);
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
