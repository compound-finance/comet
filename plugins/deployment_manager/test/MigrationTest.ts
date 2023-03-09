import hre from 'hardhat';
import { expect } from 'chai';
import { getArtifactSpec, loadMigrations, migration } from '../Migration';
import { DeploymentManager } from '../../deployment_manager/DeploymentManager';

describe('Migration', () => {
  it('test a simple migration', async () => {
    let x = [];
    let m = migration('test migration', {
      prepare: async (_deploymentManager, _govDm) => {
        x = [...x, 'step 1'];
        return 'step 2';
      },
      enact: async (_deploymentManager, _govDm, y) => {
        x = [...x, y];
      }
    });
    let dm = new DeploymentManager('test-network', 'test-deployment', hre);
    expect(m.name).to.eql('test migration');
    expect(x).to.eql([]);
    let v = await m.actions.prepare(dm, dm);
    expect(x).to.eql(['step 1']);
    await m.actions.enact(dm, dm, v);
    expect(x).to.eql(['step 1', 'step 2']);
  });

  it('loads a simple migration', async () => {
    let [m] = await loadMigrations([`${__dirname}/migration.ts`]);
    let dm = new DeploymentManager('test-network', 'test-market', hre);
    expect(m.name).to.eql('test migration');
    expect(await m.actions.prepare(dm, dm)).to.eql(['step 1']);
    expect(await m.actions.enact(dm, dm, [])).to.eql(undefined);
  });

  it('returns proper artifact file spec', async () => {
    let m = migration('test', {
      prepare: async () => null,
      enact: async () => { /* */ }
    });

    expect(getArtifactSpec(m)).to.eql({ rel: ['artifacts', 'test.json'] });
  });
});
