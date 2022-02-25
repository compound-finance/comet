import { task } from 'hardhat/config';
import { execSync } from 'child_process';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';

async function deleteSpiderArtifacts() {
  [
    'rm -rf deployments/*/contracts',
    'rm deployments/*/aliases.json',
    'rm deployments/*/proxies.json',
  ].forEach(async (command) => {
    console.log(command);
    execSync(command);
  });
}

task('spider', 'Use Spider method to pull in contract configs')
  .addFlag('clean', 'Deletes spider artifacts')
  .setAction(async ({ clean }, hre) => {
    if (clean) {
      await deleteSpiderArtifacts();
    } else {
      let dm = new DeploymentManager(hre.network.name, hre, {
        writeCacheToDisk: true,
      });
      await dm.spider();
    }
  });
