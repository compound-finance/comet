# Rewards V2: Proof Generation Script

The purpose of this script is to generate proofs for Rewards V2. Detailed information about the Rewards V2 implementation can be found in the [RewardsV2.md](../../docs/RewardsV2.md).

## Script Workflow

1. User Collection. Retrieve all users that interacted with the Comet starting from the Comet creation block up to a specified block.
2. Accrued Value Calculation. Simulate the accrue calls for all users using multicall to calculate accrued values as of the specified block.
3. Input Data Preparation. Prepare input data in the required format for constructing a sorted Merkle tree.
4. Merkle Tree Generation. Construct a sorted Merkle tree using the prepared input data.
5. File Generation and Storage. Generate the proof file and save it for later use in the [/campaigns](../../campaigns/) directory.

## 
To validate the list of interacted addresses with Comet please use [Dune Query](https://dune.com/queries/4320237)