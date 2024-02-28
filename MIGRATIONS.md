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

The preferred way to run a migration is in GitHub, via manual workflow dispatch. The goal of this approach is that it's clear to everyone the exact code that ran, which affords less opportunity for "I'm looking at \<CODE X\>, but what was deployed was actually \<CODE Y\>." Look at "Prepare Migration" and "Enact Migration" dispatches in GitHub Actions in this repo (or any fork).

## Migration Artifacts

After preparation, a migration stores some artifacts under `deployments/goerli/usdc/artifacts/164443237_my_migration.json`. These will be loaded and can be referenced in the enact step of that migration.

## Testing Migrations

Migrations can be tested using Comet's [scenario framework](https://github.com/compound-finance/comet/blob/main/SCENARIO.md).

Migrations that have been staged to a branch but not enacted yet will automatically be picked up and run by the scenarios framework (in the [MigrationConstraint](https://github.com/compound-finance/comet/blob/main/scenario/constraints/MigrationConstraint.ts)). This ensures that any new migrations are checked against all existing scenarios and any issues with a migration can be proactively caught. Remember, migrations **need to be staged in git** before it can be picked up by scenarios.

Migrations should also include a `verify` function to check that the correct state-changes are made by it. This `verify` block is also run as part of the scenario framework.

## Process for Managing Migrations

Once a migration has been created, the next step is to create a PR on GitHub and follow the process to get it reviewed, enacted, and merged:

 1. Open up a PR with the migration script.
 2. Get it reviewed and approved by others.
 3. Prepare/enact the migration in GitHub via [manual workflow dispatch](#running-a-migration-in-github).
 4. If the migration creates a governance proposal on-chain, then **wait** until the proposal either executes or fails before merging the PR. Otherwise, just merge the PR.

> Note: If the governance proposal fails, make sure that no changes to roots are included in the PR when merging.
