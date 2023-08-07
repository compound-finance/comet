# Migrations

Migrations are simple scripts which deploy or modify contracts. The goal of migration scripts is to make sure that users can see potential changes that are run prior to creating a governance proposal. This is a "nothing up my sleeve" approach to governance preparation (as in, the magician rolls up his sleeves to show there's nothing there-- so the developer deploys scripts from GitHub to show which code was deployed or run).

## Creating a Migration

To create a new migration, run:

```sh
yarn hardhat gen:migration --network goerli --deployment usdc my_migration
```

This will create a new file, such as `deployments/goerli/usdc/migrations/164443237_my_migration.ts` with a base migration script. There are currently two steps to a migration script, but this is likely to change soon:

 1. Prepare: steps used to create artifacts, such as new on-chain contracts. The output from this step is stored (e.g. "NewCometImplementation: 0x...")
 2. Enact: steps used to make these artifacts current, such as upgrading the proxy to the address from the previous step.

## Running a Migration Locally

You can run the preparation for a migration locally via:

```sh
yarn hardhat migrate --network goerli --deployment usdc --prepare 164443237_my_migration
```

or the enactment via:

```sh
yarn hardhat migrate --network goerli --deployment usdc --enact 164443237_my_migration
```

or both preparation and enactment via:

```sh
yarn hardhat migrate --network goerli --deployment usdc --prepare --enact 164443237_my_migration
```

Also, you can simulate either of the previous steps to see what effect they would have without actually modifying the on-chain state:

```sh
yarn hardhat migrate --network goerli --deployment usdc --prepare --simulate 164443237_my_migration
```

When simulating a migration, you can also impersonate an address to run the migration as. This can be helpful when trying to test a migration that makes a proposal, which requires an address with enough COMP:

```sh
yarn hardhat migrate --network goerli --deployment usdc --prepare --simulate --impersonate ADDRESS_TO_IMPERSONATE 164443237_my_migration
```

## Running a Migration in GitHub

The preferred way to run a migration is in GitHub Actions, via manual workflow dispatch. The goal of this approach is that to make it clear to everyone the exact code that ran, which affords less opportunity for "I'm looking at \<CODE X\>, but what was deployed was actually \<CODE Y\>." To get started, navigate to the [Github Actions tab](https://github.com/compound-finance/comet/actions). Note that only developers with certain permissions can run actions in the Comet repo, so you'll most likely have to run actions as part of your own fork of the repo.

### Steps

These are steps for enacting a migration. The steps for preparing a migration are similar (just switch out `Enact Migration` for `Prepare Migration`).

 1. Click on `Enact Migration` on the left-hand side of the Github Actions tab.
 2. Click on `Run Workflow`, which should bring up a dropdown with some fields to fill out:
    - a. Select the branch that you will run your workflow from. Make sure that your migration exists on that branch.
    - b. Select the network from the `Network` dropdown.
    - c. Fill in the `Deployment` (e.g. `usdc`, `weth`) that your migration scripts is targetting.
    - d. Fill in the `Migration Name`, which is the string specified at the top of your migration. [Example](https://github.com/compound-finance/comet/blob/main/deployments/mainnet/usdc/migrations/1659582050_raise_supply_caps_and_seed_reserves.ts#L4)
    - e. Fill in the `Run ID for Artifact` with the run id of your recently run job for `prepare`. If your migration does not have a `prepare` step, leave this field blank.
    - f. You can leave the rest of the fields blank. There is an optional field for providing a private key for signing transactions, but this is discouraged because you can run the workflow without exposing your private key by using WalletConnect.
3. Start the migration by clicking the green `Run Workflow` button at the bottom of the dropdown.
4. Click on the newly spun-up Github action once it appears in the list of workflow runs.
5. Click on `Enact Migration`, which should appear as a pending job.
6. If you did not input your private key when starting the action, the next steps will ask you to connect a wallet to the job using WalletConnect QR codes (Seacrest). Generally, you'll need a mobile wallet like Metamask to scan the QR codes.
    a. The first QR code to pop up should be under a task called `Seacrest`. In your mobile wallet, make sure you are connected to the network you specified in section 2b. Scan the QR code and accept the WalletConnect connection in your mobile wallet. Scanning the QR code can take some time, try scanning with different angles.
    b. If your migration is targetting an L2 that is governed by another network (e.g. Ethereum mainnet governs Polygon, Arbitrum, Base, etc.), a second task called `Seacrest (governance network)` will run and also ask you to scan a QR code. Change the network in your mobile wallet to the governance network, which is usually going to be Ethereum mainnet. Then, scan the QR code.
7. Once your address has been connected to the job (either via Seacrest or inputting your private key), the job will run your migration script. If you used Seacrest/WalletConnect, make sure to keep your mobile wallet open to accept any transactions it may ask you to sign (e.g. when making a proposal on-chain).
8. After your migration script is run, the job should complete succesfully.

## Migration Artifacts

After preparation, a migration stores some artifacts under `deployments/goerli/usdc/artifacts/164443237_my_migration.json`. These will be loaded and can be referenced in the enact step of that migration.

## Testing Migrations

Migrations can be tested using Comet's [scenario framework](https://github.com/compound-finance/comet/blob/main/SCENARIO.md).

Migrations that have been committed to a branch but not enacted yet will automatically be picked up and run by the scenarios framework (in the [MigrationConstraint](https://github.com/compound-finance/comet/blob/main/scenario/constraints/MigrationConstraint.ts)). This ensures that any new migrations are checked against all existing scenarios and any issues with a migration can be proactively caught.

Migrations should also include a `verify` function to check that the correct state-changes are made by it. This `verify` block is also run as part of the scenario framework.

## Process for Managing Migrations

Once a migration has been created, the next step is to create a PR on GitHub and follow the process to get it reviewed, enacted, and merged:

 1. Open up a PR with the migration script.
 2. Get it reviewed and approved by others.
 3. Prepare/enact the migration in GitHub via [manual workflow dispatch](#running-a-migration-in-github).
 4. If the migration creates a governance proposal on-chain, then **wait** until the proposal either executes or fails before merging the PR. Otherwise, just merge the PR.

> Note: If the governance proposal fails, make sure that no changes to roots are included in the PR when merging.
