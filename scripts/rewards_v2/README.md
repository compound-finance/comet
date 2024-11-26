# Rewards V2: Proof Generation Script

The purpose of this script is to generate proofs for Rewards V2. Detailed information about the Rewards V2 implementation can be found in the [RewardsV2.md](../../docs/RewardsV2.md).

## How to generate Merkle tree with proofs?

1. You can run the script locally by the command `yarn hardhat generateMerkleTree --network mainnet --deployment usdc --type start --blocknumber 21114579`
2. Run `create-rewards-v2-campaign` Github Workflow

## Script Workflow

1. User Collection. Retrieve all users that interacted with the Comet starting from the Comet creation block up to a specified block.
2. Accrued Value Calculation. Simulate the accrue calls for all users using multicall to calculate accrued values as of the specified block.
3. Input Data Preparation. Prepare input data in the required format for constructing a sorted Merkle tree.
4. Merkle Tree Generation. Construct a sorted Merkle tree using the prepared input data.
5. File Generation and Storage. Generate the proof file and save it for later use in the [/campaigns](../../campaigns/) directory.

## Verify user in campaign
To verify that the user was included into the Comet with the proper accrue value, user can run [verify-address-in-campaign.ts](./verify-address-in-campaign.ts) script. `ADDRESS=0xUserAddress CAMPAIGN='1732326736947-21247270-start.json' DEPLOYMENT=usdt BLOCK_NUMBER=21074594 NETWORK=mainnet yarn run rewards-v2-verify-address --network mainnet`

## Get proofs
To get user's proof or to get user neighbors' proofs use [verify-address-in-campaign.ts](./verify-address-in-campaign.ts) script. `ADDRESS=0xUserAddress CAMPAIGN='1732326736947-21247270-start.json' DEPLOYMENT=usdt BLOCK_NUMBER=21074594 NETWORK=mainnet yarn run rewards-v2-verify-address --network mainnet`
## 
To validate the list of interacted addresses with Comet please use [Dune Query](https://dune.com/queries/4320237)

# Rewards V2: Multiplayer Calculation Script

The purpose of this script is to calculate the multiplayer for the Rewards V2. Detailed information about the Rewards V2 implementation can be found in the [RewardsV2.md](../../docs/RewardsV2.md).

## Why do we need the multiplayer?

Rewards are distributed based on the borrow and supply speed of the Comet. If we need to distribute a specific amount of rewards during some time period we need to adjust the speed with the multiplier.

## How to calculate the multiplayer?

1. You can run the script locally by the command `yarn hardhat calculateMultiplier --network mainnet --deployment usdc --duration 2592000 --amount 1000`
2. Run `calculate-multiplier-for-rewards-v2-campaign` Github Workflow