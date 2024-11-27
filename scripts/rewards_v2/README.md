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

---

# **Step-by-Step Guide: Creating a Campaign**

## **1. Generate the Start Root**

The **startRoot** represents the initial accrued rewards for all users at the start of the campaign. To generate this, follow these steps:

### **Run the Merkle Tree Generation Script**:
1. Use the `generateMerkleTree` script to collect user data, compute accrued values, and construct the Merkle tree:
   ```bash
   yarn hardhat generateMerkleTree --network mainnet --deployment usdc --type start --blocknumber 21114579
   ```
   - Replace `mainnet`, `usdc`, and `21114579` with your network, deployment, and block number.
   - The script outputs:
     - The Merkle root (`startRoot`).
     - Proof files saved in the `/campaigns` directory.

### **Script Workflow**:
The script performs the following:
1. Retrieves all user addresses that interacted with the Comet contract up to the specified block.
2. Calculates accrued rewards for each user using `accrue` simulation.
3. Prepares input data and constructs a **sorted Merkle tree** (`Hash(address, index, accrued_value)`).
4. Outputs the Merkle root and proofs for each user.

---

## **2. Calculate the Token Multipliers**

Token multipliers adjust the reward speed for specific assets in the campaign. Follow these steps:

### **Run the Multiplier Calculation Script**:
1. Use the `calculateMultiplier` script to compute multipliers for each token:
   ```bash
   yarn hardhat calculateMultiplier --network mainnet --deployment usdc --duration 2592000 --amount 1000
   ```
   - Replace `mainnet`, `usdc`, `2592000` (30 days in seconds), and `1000` (reward amount) with your desired values.

### **Script Workflow**:
1. Computes the required multiplier based on:
   - Borrow/supply speeds of the Comet.
   - Reward distribution over the specified duration.
2. Outputs the multiplier for each token to include in the campaign.

### **Prepare the `TokenMultiplier` Array**:
- Structure:
  ```solidity
  struct TokenMultiplier {
      address token;
      uint256 multiplier;
  }
  ```
- Example:
  ```json
  [
    { "token": "0xTokenAddress1", "multiplier": 2 },
    { "token": "0xTokenAddress2", "multiplier": 3 }
  ]
  ```

---

## **3. Set Campaign Duration**

Decide on the campaign duration (in seconds). Example durations:
- 7 days: `604800` seconds.
- 30 days: `2592000` seconds.
- etc.

---

## **4. Call the `setNewCampaignWithCustomTokenMultiplier` Function**

Once you have the `startRoot`, token multipliers, and duration, invoke the function:

```solidity
setNewCampaignWithCustomTokenMultiplier(
    address comet,
    bytes32 startRoot,
    TokenMultiplier[] memory assets,
    uint256 duration
)
```

### **Parameters**:
- `comet`: Address of the Comet instance.
- `startRoot`: Merkle root for the start tree.
- `assets`: Array of token multipliers.
- `duration`: Campaign duration in seconds.

---

## **5. Example Input**

Let’s create a campaign with:
- **Comet Address**: `0x000...Comet`
- **Start Root**: `0xabc...123` (generated by `generateMerkleTree`).
- **Token Multipliers**:
  - USDC: 2x multiplier.
  - ETH: 3x multiplier.
- **Duration**: 30 days.

**Function Call Example**:
```solidity
setNewCampaignWithCustomTokenMultiplier(
    0x000...Comet, // Comet address
    0xabc...123,   // Start root
    [
        TokenMultiplier({token: 0x000...USDC, multiplier: 2}),
        TokenMultiplier({token: 0x000...ETH, multiplier: 3})
    ],
    2592000 // Duration: 30 days
)
```
---