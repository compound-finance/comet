import { task } from 'hardhat/config';
import { execSync } from 'child_process';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';

async function deleteSpiderArtifacts() {
  [
    'rm -rf deployments/*/.contracts',
    'rm deployments/*/*/aliases.json',
  ].forEach(async (command) => {
    console.log(command);
    execSync(command);
  });
}

task('spider', 'Use Spider method to pull in contract configs')
  .addFlag('clean', 'Deletes spider artifacts')
  .addOptionalParam('deployment', 'The deployment to spider')
  .setAction(async ({ clean, deployment }, hre) => {
    const network = hre.network.name;

    if (clean) {
      await deleteSpiderArtifacts();
    } else {
      if (!deployment) {
        throw new Error('missing argument --deployment');
      }
      let dm = new DeploymentManager(
        network,
        deployment,
        hre,
        {
          writeCacheToDisk: true,
        }
      );
      await dm.spider();
    }
  });
