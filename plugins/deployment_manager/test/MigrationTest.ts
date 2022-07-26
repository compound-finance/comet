import hre from 'hardhat';
import { expect } from 'chai';
import { Loader, Migration, loader, migration, setupLoader } from '../Migration';
import { DeploymentManager } from '../../deployment_manager/DeploymentManager';

describe('Migration', () => {
  it('test a simple migration', async () => {
    setupLoader();
    let x = [];
    migration('test migration', {
      run: async (_deploymentManager) => {
        x = [...x, 'step 1'];
      }
    });
    let dm = new DeploymentManager('TEST', hre);
    let migrations = (loader as Loader).getMigrations();
    expect(Object.keys(migrations)).to.eql(['test migration']);
    let [m] = Object.values(migrations);
    expect(x).to.eql([]);
    await m.actions.run(dm);
    expect(x).to.eql(['step 1']);
  });
});
