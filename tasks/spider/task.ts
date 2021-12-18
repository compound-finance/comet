import { task } from 'hardhat/config';
import { pullConfigs } from '../../plugins/spider';
import { execSync } from "child_process";

async function deleteSpiderArtifacts() {
  [
    "rm -rf deployments/*/cache",
    "rm deployments/*/config.json",
    "rm deployments/*/proxies.json"

  ].forEach(async (command) => {
    console.log(command);
    execSync(command);
  });
}

task('spider', 'Use Spider method to pull in contract configs')
  .addFlag("clean", "Deletes spider artifacts")
  .setAction(async ({clean}, hre) => {
    if (clean) {
      await deleteSpiderArtifacts();
    } else {
      await pullConfigs(hre);
    }
  });