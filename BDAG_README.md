# BlockDAG Primordial - Local Development Guide

## Quick Start

### 1. Environment Setup

Create a `.env` file in the root directory. All these values are mandatory for deployments to run properly:

```bash
ETHERSCAN_KEY=your_etherscan_api_key
SNOWTRACE_KEY=your_snowtrace_api_key
INFURA_KEY=your_infura_api_key
ANKR_KEY=your_ankr_api_key
POLYGONSCAN_KEY=your_polygonscan_api_key
ARBISCAN_KEY=your_arbiscan_api_key
LINEASCAN_KEY=your_lineascan_api_key
OPTIMISMSCAN_KEY=your_optimismscan_api_key
MANTLESCAN_KEY=your_mantlescan_api_key
UNICHAIN_QUICKNODE_KEY=your_unichain_quicknode_key
SCROLLSCAN_KEY=your_scrollscan_api_key
```

**Note**: We will only use hardhat (local development environment) and blockdag networks. No code will be deleted.

**Important**: The API keys above don't need to contain valid values, except for `ETHERSCAN_KEY` which is used by hardhat to fetch contracts. You can use placeholder text like `placeholder` or `your_arbiscan_api_key` for the other keys. This makes it easy to get started without having to obtain real API keys from all the different blockchain explorers and services.

### 2. Deploy DAI Market example Locally

```bash
yarn install
yarn build
yarn hardhat deploy --network hardhat --deployment dai
```

**Can be simulated:**
```bash
yarn hardhat deploy --network hardhat --deployment dai --simulate
```

### 3. Running Tests

Run tests explained in the Testing section to check everything is working as expected

## Testing


### Basic Tests

```bash
yarn hardhat test test/sanity-test.ts --network hardhat
```

### Core Functionality

```bash
# Test supply functionality
yarn hardhat test test/supply-test.ts --network hardhat

# Test withdraw functionality  
yarn hardhat test test/withdraw-test.ts --network hardhat

# Test basic operations
yarn hardhat test test/balance-test.ts --network hardhat
```

### Advanced Features

```bash
# Test rewards system
yarn hardhat test test/rewards-test.ts --network hardhat

# Test liquidation
yarn hardhat test test/absorb-test.ts --network hardhat

# Test price feeds
yarn hardhat test test/price-feed-test.ts --network hardhat
```

### Complete Test Suite

```bash
yarn hardhat test --network hardhat
```

**Note**: Tests that try to fork from mainnet (like liquidation tests) will fail if `ANKR_KEY` is not set.

## Testing Market on Specific Blockchain

You can test your deployed market on any blockchain network using the same test commands. Here's how to test on different networks:

### Testing on Local Network

```bash
# Deploy with BDAG governor on local network
yarn hardhat deploy --bdag --network local --deployment dai

# Run basic tests against local deployment
yarn hardhat test test/sanity-test.ts --network local

# Test core functionality
yarn hardhat test test/supply-test.ts --network local
yarn hardhat test test/withdraw-test.ts --network local
yarn hardhat test test/balance-test.ts --network local

# Test advanced features
yarn hardhat test test/rewards-test.ts --network local
yarn hardhat test test/absorb-test.ts --network local
```

### Testing on Other Networks

```bash
# Deploy to target network (example: polygon)
yarn hardhat deploy --bdag --network polygon --deployment dai

# Run tests against deployed contracts
yarn hardhat test test/supply-test.ts --network polygon
yarn hardhat test test/withdraw-test.ts --network polygon
```

### Account Funding Requirements

**Important**: When testing on real blockchains, your testing accounts need to have funds:

- **Local Network (Hardhat)**: Testing accounts are **automatically funded** with test ETH
- **Testnets**: You need to fund accounts with test tokens
- **Mainnets**: You need real tokens for testing (not recommended for development)

### Test Execution Flow

1. **Deploy contracts** to target network
2. **Fund testing accounts** (if needed)
3. **Run tests** against deployed contracts
4. **Verify results** match expected behavior

**Note**: Tests will use the existing deployment cache, so they run against your deployed contracts rather than creating new ones.

### How Deployment Caching Works

The Hardhat deployment manager uses a **caching system** to avoid re-deploying contracts:

#### **Cache Location:**
```
deployments/{network}/{deployment}/.contracts/
├── cache.json          # Contract addresses and metadata
├── governor.json       # Governor contract details
├── comet.json         # Comet contract details
└── ...                # Other deployed contracts
```

#### **Cache Behavior:**
1. **First Deployment**: Contracts are deployed and cached
2. **Subsequent Runs**: Contracts are loaded from cache
3. **Tests**: Use cached contract addresses automatically

#### **Example Cache Entry:**
```json
{
  "address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "deployedAt": "2024-01-15T10:30:00Z",
  "constructorArgs": [],
  "verified": false
}
```

#### **Verifying Cache Usage:**
```bash
# Check if contracts are cached
ls deployments/local/dai/.contracts/

# Clear cache to force re-deployment
rm -rf deployments/local/dai/.contracts/
yarn hardhat deploy --bdag --network local --deployment dai
```

**Benefits:**
- **Faster Testing**: No need to re-deploy for each test
- **Consistent State**: Tests use same contract instances
- **Cost Savings**: Avoid unnecessary gas costs on real networks



## Understanding execution flow

When you run `yarn hardhat deploy --network hardhat --deployment dai`, here's exactly what happens:

### 1. Command Line Execution
```bash
yarn hardhat deploy --network hardhat --deployment dai
```

### 2. Task Registration & Loading
- Hardhat loads task definitions from `tasks/deployment_manager/task.ts`
- The `deploy` task is registered with its `.setAction()` function
- Command line arguments are parsed: `network=hardhat`, `deployment=dai`

### 3. Task Action Execution (FIRST)
```typescript
// In tasks/deployment_manager/task.ts
.setAction(async ({ simulate, noDeploy, noVerify, noVerifyImpl, overwrite, deployment }, env) => {
  // 1. THIS RUNS FIRST
  // Setup environment and network configuration
  const network = env.network.name; // 'hardhat'
  const tag = `${network}/${deployment}`; // 'hardhat/dai'
  
  // 2. Create DeploymentManager instance
  const dm = new DeploymentManager(/* network, deployment, env, config */);

  if (noDeploy) {
    // Skip deployment
  } else {
    // 3. Call runDeployScript
    const delta = await dm.runDeployScript(overrides ?? { allMissing: true });
  }
  
  // 4. Verification logic runs after deployment
});
```

### 4. DeploymentManager.runDeployScript() (SECOND)
```typescript
// In plugins/deployment_manager/DeploymentManager.ts
async runDeployScript(deploySpec: object): Promise<DeploymentDelta> {
  // 5. Load the deployment script
  const deployScript = this.cache.getFilePath({ rel: 'deploy.ts' });
  // This resolves to: deployments/local/dai/deploy.ts
  
  // 6. Import the deploy function
  const { default: deployFn } = await import(deployScript);
  
  // 7. Call your deploy function
  const deployed = await deployFn(this, deploySpec);
  
  // Return deployment statistics
  return { old: {...}, new: {...} };
}
```

### 5. Your Deploy Function (THIRD)
```typescript
// In deployments/local/dai/deploy.ts
export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  // 8. THIS RUNS LAST IN THE DEPLOYMENT CHAIN

  // 9. Deploy governance contracts
  const { fauceteer, governor, timelock } = await cloneGov(deploymentManager);

  // 10. Deploy tokens and price feeds
  const DAI = await makeToken(/* params */);
  const GOLD = await makeToken(/* params */);
  const SILVER = await makeToken(/* params */);

  // 11. Deploy Comet and related contracts
  const deployed = await deployCometForBDAG(deploymentManager, deploySpec, {
    baseTokenPriceFeed: daiPriceFeed.address,
    assetConfigs: [assetConfig0, assetConfig1],
  });

  // 12. Return deployed contracts
  return { ...deployed, fauceteer };
}
```

### 6. Contract Deployment Process
For each contract deployment, the DeploymentManager:
1. **Checks cache** - If contract already exists, skip deployment
2. **Deploys contract** - If not cached, deploy to blockchain
3. **Stores in cache** - Save contract address and metadata
4. **Verifies contract** - If verification strategy is 'eager'

### 7. Return Flow
1. **Deploy function returns** deployed contracts
2. **runDeployScript returns** deployment delta
3. **Task action continues** with verification logic
4. **Results are logged** showing contracts deployed and gas spent

### Key Components

#### **Governance Contracts** (via `cloneGov`)
- **Fauceteer**: Token distribution contract
- **Timelock**: Governance timelock (admin stays with deployer)
- **COMP Token**: Cloned from mainnet
- **Governor**: Proxy pattern with implementation from mainnet

#### **Verification Strategies**
- **`'none'`**: No verification (used in local deployment)
- **`'eager'`**: Verify immediately after deployment
- **`'lazy'`**: Cache verification params for later

#### **Deployment Caching**
- Contracts are cached by alias (e.g., 'DAI', 'governor', 'comet')
- Prevents re-deployment of existing contracts
- Cache stored in `deployments/local/dai/.contracts/`

### Example Output
```
[hardhat/dai] Deployed 15 contracts, spent 0.0234 Ξ
[hardhat/dai] 
+ fauceteer: 0x5FbDB2315678afecb367f032d93F642f64180aa3
+ governor: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
+ timelock: 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
+ DAI: 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
+ comet: 0xDc64a140Aa3E981100a9becA4E685f962fF0C6F5
...
```

This execution flow ensures that:
- **Governance is properly set up**
- **All contracts are deployed** in the correct order
- **Dependencies are resolved** automatically
- **Deployment is idempotent** (can be run multiple times safely)


## Custom Governor Implementation

This section describes how the system automatically chooses between Governor Bravo and a custom multisig governor based on configuration flags.

### Implementation Overview

The system uses a **flag-based approach** to automatically select the appropriate governor:

- **`--bdag` flag**: Uses custom multisig governor (`createMultisigGov`)
- **No flag**: Uses standard Governor Bravo (`_cloneGov`)

### Step 1: Custom Governor Contract ✅
- Created `contracts/CustomGovernor.sol` that implements `IGovernorBravo`
- Implements all required functions and events from the interface
- Features multisig logic with admin approvals instead of token voting
- Includes UUPS upgradeability for future improvements

### Step 2: Flag-Based Governor Selection ✅
- Modified `cloneGov()` function in `src/deploy/Network.ts` to check `deploymentManager.config.bdag`
- If BDAG flag is set: uses `createMultisigGov()` (custom governor)
- If no flag: uses `_cloneGov()` (standard Governor Bravo)
- No changes needed to deployment scripts - automatic selection

### Step 3: Deployment Manager Integration ✅
- Extended `DeploymentManagerConfig` interface to include `bdag?: boolean`
- Added `--bdag` flag to deploy tasks in `tasks/deployment_manager/task.ts`
- Flag is passed through deployment manager config to `cloneGov()`

### Step 4: Usage Examples

#### Using BDAG Flag:
```bash
# Deploy with custom multisig governor
yarn hardhat deploy --bdag --deployment dai

# Deploy and migrate with custom governor
yarn hardhat deploy_and_migrate --bdag --deployment dai migration_name
```

#### Standard Deployment:
```bash
# Deploy with Governor Bravo (default)
yarn hardhat deploy --deployment dai
```

### Step 5: Key Features

#### Custom Governor Features:
- **Multisig Logic**: Admin-based approvals instead of token voting
- **UUPS Upgradeable**: Can be upgraded through governance proposals
- **Immutable Threshold**: Multisig threshold set in constructor
- **Governance Integration**: Upgrades follow same proposal process

#### Automatic Selection:
- **No Code Changes**: Existing deployments work unchanged
- **Flexible Control**: Can override with `--bdag` flag
- **Clear Logging**: Shows which governor is being used
- **Backward Compatible**: Maintains existing functionality