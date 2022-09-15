
# Migrations

Migrations are simple scripts which deploy or modify contracts. The goal of migration scripts is to make sure that users can see potential changes that are run prior to creating a governance proposal. This is a "nothing up my sleeve" approach to governance preparation (as in, the magician rolls up his sleeves to show there's nothing there-- so the developer deploys scripts from GitHub to show which code was deployed or run).

## Creating a Migration

To create a new migration, run:

```sh
yarn hardhat gen:migration --network kovan --deployment usdc my_migration
```

This will create a new file, such as `deployments/kovan/usdc/migrations/164443237_my_migration.ts` with a base migration script. There are currently two steps to a migration script, but this is likely to change soon:

 1. Prepare: steps used to create artifacts, such as new on-chain contracts. The output from this step is stored (e.g. "NewCometImplementation: 0x...")
 2. Enact: steps used to make these artifacts current, such as upgrading the proxy to the address from the previous step.

## Running a Migration Locally

You can run the preparation for a migration locally via:

```sh
yarn hardhat migrate --network kovan --deployment usdc --prepare 164443237_my_migration
```

or the enactment via:

```sh
yarn hardhat migrate --network kovan --deployment usdc --enact 164443237_my_migration
```

or both preparation and enactment via:

```sh
yarn hardhat migrate --network kovan --deployment usdc --prepare --enact 164443237_my_migration
```

Also, you can simulate either of the previous steps to see what effect they would have without actually modifying the on-chain state:

```sh
yarn hardhat migrate --network kovan --deployment usdc --prepare --simulate 164443237_my_migration
```

## Running a Migration in GitHub

The preferred way to run a migration is in GitHub, via manual workflow dispatch. The goal of this approach is that it's clear to everyone the exact code that ran, which affords less opportunity for "I'm looking at <CODE X>, but what was deployed was actually <CODE Y>." Look at "Prepare Migration" and "Enact Migration" dispatches in GitHub Actions in this repo (or any fork).

## Migration Artifacts

After preparation, a migration stores some artifacts under `deployments/kovan/usdc/artifacts/164443237_my_migration.json`. These will be loaded and can be referenced in the enact step of that migration.