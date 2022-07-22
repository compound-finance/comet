import hre from 'hardhat';
import { expect } from 'chai';
import { Loader, Migration, getArtifactSpec, loader, migration, setupLoader } from '../Migration';
import { DeploymentManager } from '../../deployment_manager/DeploymentManager';

describe('Migration', () => {
  it('test a simple migration', async () => {
    setupLoader();
    let x = [];
    migration('test migration', {
      prepare: async (_deploymentManager) => {
        x = [...x, 'step 1'];
        return 'step 2';
      },
      enact: async (_deploymentManager, y) => {
        x = [...x, y];
      }
    });
    let dm = new DeploymentManager('TEST', hre);
    let migrations = (loader as Loader<string>).getMigrations();
    expect(Object.keys(migrations)).to.eql(['test migration']);
    let [m] = Object.values(migrations);
    expect(x).to.eql([]);
    let v: string = await m.actions.prepare(dm);
    expect(x).to.eql(['step 1']);
    await m.actions.enact(dm, v);
    expect(x).to.eql(['step 1', 'step 2']);
  });

  it('returns proper artifact file spec', async () => {
    let migration: Migration<null> = {
      name: 'test',
      actions: {
        prepare: async () => null,
        enact: async () => { /* */ }
      },
    };

    expect(getArtifactSpec(migration)).to.eql({ rel: ['artifacts', 'test.json'] });
  });
});
