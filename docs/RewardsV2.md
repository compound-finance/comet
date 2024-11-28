# Documentation for `CometRewardsV2` Contract Core Use Cases

The `CometRewardsV2` contract is designed to efficiently manage the distribution and claiming of rewards in the Compound ecosystem. It uses a Merkle tree structure to handle both existing users and new users.
Existing members are users who had already accrued rewards before the campaign began. Their accrued rewards up to a specific block (the start block) are represented in the Merkle tree.
New members are users who began accruing rewards after the campaign started. The same Merkle tree is reused for them, to ensure a unified rewards mechanism.
 This design ensures scalability and cost-effectiveness.

---

## Core Use Cases

### 1. **Claiming Rewards for Existing Members**

- **Purpose**: Allow users who were already accrued rewards before the start of the campaign to claim their rewards.

- **Mechanism**:
  - A **Merkle tree** is used to represent the accrued reward balances for all users at the time of a specific block (the campaign start block).
  - Each user's accrued rewards are included in the tree as their "initial value."
  - To claim rewards:
    - The user provides a **Merkle proof** to verify their inclusion in the tree.
    - The contract uses this proof to validate the user’s accrued rewards without storing all user data on-chain, saving significant gas costs.

- **Why Merkle Trees?**
  - **Efficiency**: Storing reward balances for a potentially large user base directly on-chain would be prohibitively expensive.
  - **Scalability**: As new campaigns are created regularly, it’s necessary to maintain a lightweight storage model. The Merkle tree allows only the root to be stored on-chain, with individual proofs generated off-chain.
  - **Historical Integration**: This mechanism enables seamless distribution of rewards accrued before the campaign started.

---

### 2. **Claiming Rewards for New Members (`ForNewMember`)**

- **Purpose**: Allow users who start accruing rewards after the campaign begins to claim their rewards.

- **Mechanism**:
  - The tree includes all existing users and additional boundary addresses (`0x0` and `address(MAX)`).
  - Sorting by address allows new users to infer their position relative to neighbors in the tree, even if they weren’t included initially.
  - New users can claim by:
    1. Using the same Merkle proof mechanism to validate their position.
    2. Verifying their potential neighbors and ensuring consistency in their claim.

- **Tree Design**:
  - Every entry in the tree includes an **index**, enabling accurate proof verification.
  - The tree is sorted to ensure every possible address (even those absent from the initial campaign) can find a valid claim path.

- **Advantages**:
  - Eliminates the need for a separate mechanism or tree for new users.
  - Maintains a lightweight and scalable rewards distribution system.

### 3. **Finish Root and Snapshot Tree**

#### **What is the Finish Root?**
The `finishRoot` is a secondary Merkle tree root used to capture a **snapshot** of user reward accruals at the moment the campaign ends. This snapshot ensures accurate reward distribution, particularly for ongoing or newly joined users, by establishing a definitive final state for the campaign.

#### **Why is the Finish Root Needed?**
1. **Accurate Final Balances**:
   - Rewards continue to accrue dynamically for all users during the campaign. The `finishRoot` captures the final accrued balances at the campaign’s conclusion, creating an immutable reference point for distribution.
   
2. **Support for New and Existing Users**:
   - For **existing users**: The `finishRoot` ensures their accrued rewards are finalized and verifiable.
   - For **new users**: The same as for existing users.

3. **Cost Efficiency**:
   - Instead of storing final balances on-chain, the `finishRoot` compresses the data into a single root, reducing gas costs for reward claims.

---

#### **How the Finish Root is Used**
1. At the end of the campaign:
   - The contract generates the `finishRoot` based on the final accrued values for all users, using the same sorted structure as the initial tree.
2. During claims:
   - Users (both existing and new) provide Merkle proofs from the `finishRoot` to validate their reward balances.

---

## Why Use Merkle Trees for Rewards Distribution?

1. **Historical Rewards Distribution**:
   - The Compound protocol accrued rewards for users long before `CometRewardsV2` was deployed.
   - To retroactively distribute these rewards, the accrued values at a specific block (campaign start) are used as the initial balances for existing members.

2. **Efficient Data Storage**:
   - Storing all user balances on-chain is expensive and infeasible given the large user base.
   - By storing only the Merkle root, the contract drastically reduces on-chain storage costs.

3. **Regular Campaigns**:
   - The contract facilitates frequent campaign creation by only requiring the Merkle root for each campaign.
   - Users can generate proofs off-chain to claim their rewards, minimizing computational overhead.

4. **Secure Verification**:
   - The Merkle proof system ensures that only valid claims are accepted, with the proof structure preventing fraudulent claims.

5. **Dynamic Membership**:
   - New users can easily be integrated into the rewards system using the same Merkle tree.
   - Sorting by address and including boundary addresses ensures no gaps or ambiguities in user inclusion.



---



# Example of a Correct Merkle Tree with Indices

### 1. **Sorted List of Addresses with Indices**

The tree uses a sorted list of addresses, including boundaries (`0x000...000` and `0xFFF...FFF`), with each entry including its index. Indices are assigned based on the sorted order:

| Index | Address       | Accrued Value |
|-------|---------------|---------------|
| 0     | `0x000...000` | 0 (boundary)  |
| 1     | `0x000...001` | 100           |
| 2     | `0x000...002` | 200           |
| 3     | `0x000...004` | 300           |
| 4     | `0x000...007` | 400           |
| 5     | `0xFFF...FFF` | 0 (boundary)  |

### 2. **Tree Construction**
1. Each entry is represented as a **leaf node** with the structure:  
   `Hash(address, index, accrued_value)`
2. Pairs of nodes are hashed together iteratively to form parent nodes until a single root is reached.

---

### Corrected Example: Claiming for a New User (Using Neighbor Proofs)

#### **Tree Structure Overview**
The Merkle tree is constructed based on the sorted list of all addresses (including boundaries) and their accrued values at the start of the campaign. Each entry is hashed in the format:  
`Hash(address, index, accrued_value)`.  

The tree allows **new users** (who are not part of the initial list) to use **existing proofs** of their neighbors to validate their claims.

---

#### **New User Process**

1. **New User Address**: `0x000...005`  
   - The new user is not directly in the tree but is positioned logically between existing addresses:
     - **Left Neighbor**: `0x000...004` (Index 3, Accrued Value 300)
     - **Right Neighbor**: `0x000...007` (Index 4, Accrued Value 400)

2. **Validation Using Neighbor Proofs**:
   - The new user does not generate their own proof.
   - Instead, they use **proofs of their neighbors** (`0x000...004` and `0x000...007`) from the Merkle tree to prove their logical position.

#### **How the New User Claims**

The claim mechanism involves the following:

1. **Identify Neighbors**:
   - The new user finds their position relative to the sorted list:
     - **Left Neighbor**: `Hash(0x000...004, 3, 300)`
     - **Right Neighbor**: `Hash(0x000...007, 4, 400)`

2. **Use Neighbor Proofs**:
   - The new user utilizes the Merkle proofs for their **left and right neighbors**.
   - These proofs include:
     - The full path from the leaf node of each neighbor to the Merkle root.
     - The hashes necessary to validate the inclusion of `0x000...004` and `0x000...007`.

3. **Verify Consistency**:
   - The contract checks:
     - That the new user logically falls between the provided neighbors.
     - That their address does not conflict with the tree structure.
   - This ensures no double claims or inconsistencies.

---

#### **Steps in the Contract**

1. The new user submits their address (`0x000...005`), neighbors (`0x000...004` and `0x000...007`), and their neighbors' proofs.
2. The contract:
   - Validates the neighbors' proofs against the Merkle root.
   - Confirms the user logically fits between the neighbors based on sorting.
   - Ensures the user’s claim aligns with the expected rules for new users.

#### **No New Proofs**:
The new user does not generate a new proof.
Instead, they rely on existing neighbor proofs for validation.




---




# **Step-by-Step Guide: Claim Process for an Existing User**

## 1. **Understand Required Data**

To claim rewards as an existing user, you need to gather the following information from both the **start tree** and the **finish tree** (if the campaign is finished):  
- **Index**: Your position in the respective Merkle tree.  
- **Accrue**: Your accrued rewards in the tree.  
- **Proof**: The Merkle proof for verifying your data against the tree root.  

This data can be generated using the `verify-address-in-campaign` [script](../scripts/rewards_v2/README.md#get-proofs).

---

## 2. **Prepare Data**

### **Start Tree Proofs**:
- Gather proof data for the **start tree**, which represents the state of rewards at the campaign's beginning:
  - `startIndex`: Your index in the start tree.
  - `startAccrued`: Your accrued rewards in the start tree.
  - `startMerkleProof`: Your proof path in the start tree.

### **Finish Tree Proofs** (if applicable):
- If the campaign has ended, gather proof data for the **finish tree**, representing the final state of rewards:
  - `finishIndex`: Your index in the finish tree.
  - `finishAccrued`: Your accrued rewards in the finish tree.
  - `finishMerkleProof`: Your proof path in the finish tree.

---

## 3. **Call the `claim` Function**

Invoke the following function on the rewards contract:

```solidity
claim(
    address comet,
    uint256 campaignId,
    address src,
    bool shouldAccrue,
    Proofs proofs
)
```

**Parameters**:
- `comet`: Address of the Comet instance for the campaign.
- `campaignId`: ID of the ongoing campaign.
- `src`: Address of the user (existing member).
- `shouldAccrue`: Set to `true` to accrue rewards before claiming.
- `proofs`: Proof data for the user, structured as:
  - `startIndex`: Your index in the start tree.
  - `finishIndex`: Your index in the finish tree (if applicable).
  - `startAccrued`: Your accrued rewards in the start tree.
  - `finishAccrued`: Your accrued rewards in the finish tree (if applicable).
  - `startMerkleProof`: Proof path in the start tree.
  - `finishMerkleProof`: Proof path in the finish tree (if applicable).

---

## 4. **Example Input for an Existing User**

Assume the existing user `src` has the following details:

- **Start Tree Proof**:
  - `startIndex`: `3`
  - `startAccrued`: `300`
  - `startMerkleProof`: `[<hash1>, <hash2>, ...]`

- **Finish Tree Proof** (if the campaign is finished):
  - `finishIndex`: `3`
  - `finishAccrued`: `500`
  - `finishMerkleProof`: `[<hash3>, <hash4>, ...]`

**Function Call Example**:
```solidity
claim(
    comet,
    campaignId,
    src,
    true, // shouldAccrue
    Proofs({
        startIndex: 3,
        finishIndex: 3,
        startAccrued: 300,
        finishAccrued: 500,
        startMerkleProof: [<hash1>, <hash2>],
        finishMerkleProof: [<hash3>, <hash4>]
    })
)
```

---

## 5. **Verification in the Contract**

The contract performs the following checks:  
1. **Start Tree Verification**:
   - Confirms that the user’s data (index, accrued value) matches the `startRoot` using the provided `startMerkleProof`.
2. **Finish Tree Verification** (if applicable):
   - Confirms the final accrued rewards against the `finishRoot` using the `finishMerkleProof`.
3. **Reward Accrual**:
   - Rewards are computed based on the difference between `startAccrued` and `finishAccrued` (if the campaign has ended).




---




# **Step-by-Step Guide: Claim Process for a New User**

## 1. **Understand Required Data**
To claim rewards as a new user, you need to gather the following information:
- **Neighbors**:
  - Addresses of your logical **left** and **right** neighbors in the Merkle tree. These neighbors verify your position relative to the snapshot.
- **Proofs for Neighbors**:
  - **Accrue**, **Index**, and **Proof** for both neighbors in the **start tree**.
- **Finish Proof**:
  - Data specific to the **finish tree** (if the campaign is finished), including your accrued rewards and proof for verification.

---

## 2. **Prepare Data**

### **Neighbors**:
- Locate your logical neighbors (based on address sorting) using the **start tree**. 
- These will be stored in the `neighbors` array as:
  - `neighbors[0]`: Address of the left neighbor.
  - `neighbors[1]`: Address of the right neighbor.

### **Proofs for Neighbors**:
- Gather proof data for both neighbors from the **start tree**:
  - `Proofs[0]`: Proof data for the left neighbor.
  - `Proofs[1]`: Proof data for the right neighbor.
- Each proof consists of:
  - `startIndex`: Index of the neighbor in the start tree.
  - `startAccrued`: Accrued rewards of the neighbor in the start tree.
  - `startMerkleProof`: Merkle proof for the neighbor's position in the start tree.

### **Finish Proof**:
- For the **finish tree**, prepare:
  - `finishIndex`: Your logical position based on sorting.
  - `finishAccrued`: Your accrued rewards at the end of the campaign (typically zero for new users).
  - `finishMerkleProof`: Proof validating your logical position in the finish tree.

---

## 3. **Call the `claimForNewMember` Function**

Invoke the following function on the rewards contract:

```solidity
claimForNewMember(
    address comet,
    uint256 campaignId,
    address src,
    bool shouldAccrue,
    address[2] calldata neighbors,
    Proofs[2] calldata proofs,
    FinishProof calldata finishProof
)
```

**Parameters**:
- `comet`: Address of the Comet instance for the campaign.
- `campaignId`: ID of the ongoing campaign.
- `src`: Address of the user (new member).
- `shouldAccrue`: Set to `true` to accrue rewards before claiming.
- `neighbors`: Array containing the left and right neighbor addresses:
  - `neighbors[0]`: Left neighbor.
  - `neighbors[1]`: Right neighbor.
- `proofs`: Array containing proof data for both neighbors:
  - `Proofs[0]`: Proof for the left neighbor.
  - `Proofs[1]`: Proof for the right neighbor.
- `finishProof`: Proof for the finish tree:
  - `finishIndex`: Your index in the finish tree.
  - `finishAccrued`: Your accrued value in the finish tree.
  - `finishMerkleProof`: Your proof path in the finish tree.

---

## 4. **Example Input for a New User**
Assume the new user `src` has the following details:

- **Neighbors**:
  - Left: `0x000...004` (Index 3, Accrued 300).
  - Right: `0x000...007` (Index 4, Accrued 400).

- **Proofs for Neighbors**:
  - `Proofs[0]`: Data for `0x000...004`.
    - `startIndex`: `3`
    - `startAccrued`: `300`
    - `startMerkleProof`: `[<hash1>, <hash2>, ...]`
  - `Proofs[1]`: Data for `0x000...007`.
    - `startIndex`: `4`
    - `startAccrued`: `400`
    - `startMerkleProof`: `[<hash3>, <hash4>, ...]`

- **Finish Proof**:
  - `finishIndex`: `5` (logical position for new user).
  - `finishAccrued`: `0` (no initial rewards for new user).
  - `finishMerkleProof`: `[<hash5>, <hash6>, ...]`

**Function Call Example**:
```solidity
claimForNewMember(
    comet,
    campaignId,
    src,
    true, // shouldAccrue
    [0x000...004, 0x000...007], // neighbors
    [
        Proofs({startIndex: 3, startAccrued: 300, startMerkleProof: [<hash1>, <hash2>]}),
        Proofs({startIndex: 4, startAccrued: 400, startMerkleProof: [<hash3>, <hash4>]})
    ],
    FinishProof({
        finishIndex: 5,
        finishAccrued: 0,
        finishMerkleProof: [<hash5>, <hash6>]
    })
)
```

## 5. **Verification in the Contract**
1. The contract validates:
   - Neighbor proofs in the start tree to confirm the new user’s logical position.
   - The finish proof to finalize the accrued value.
2. If successful, rewards are allocated to the new user.

---

### **Note**:
RewardsV2 contract on sepolia: 0x8D88c1EB48e8549bEac11B696944599DB7B60520
There is a test campaign for WETH market on sepolia with campaignId: 0
``
