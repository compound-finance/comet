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

### Custom Tests

#### Deployment Verification Test

The `deployment-verification-test.ts` is a comprehensive test that verifies your deployed market configuration:

**What it tests:**
- ✅ **Ownership relationships** (timelock admin, comet governor, proxy admin)
- ✅ **Base token configuration** (token address, price feed)
- ✅ **Asset configurations** (supply caps, collateral factors, price feeds)
- ✅ **Custom governor setup** (detects BDAG multisig governor vs standard Governor Bravo)
- ✅ **Proxy implementation** (verifies upgradeable contracts are properly linked)

**Usage:**
```bash
# Test local DAI deployment
export MARKET=dai && yarn hardhat test test/deployment-verification-test.ts --network local

# Test Polygon USDC deployment
export MARKET=usdc && yarn hardhat test test/deployment-verification-test.ts --network polygon

# Test Base WETH deployment
export MARKET=weth && yarn hardhat test test/deployment-verification-test.ts --network base
```

**Expected Output:**
```
🔍 Testing deployment on network: local, market: dai
✅ Custom BDAG governor detected and verified
```

**Key Features:**
- **Network agnostic**: Works with any deployed network/market combination
- **Automatic detection**: Identifies if you're using BDAG custom governor or standard Governor Bravo
- **Comprehensive verification**: Checks all critical deployment configurations
- **Clear error messages**: Shows exactly what's wrong if verification fails

## Hardhat Config

The Hardhat configuration (`hardhat.config.ts`) is the central configuration file that defines networks, deployments, and their relationships. Understanding this configuration is crucial for proper deployment and testing.

### Network Configuration

Each network in the configuration includes:
- **Chain ID**: Unique identifier for the blockchain
- **RPC URL**: Endpoint for interacting with the network
- **Accounts**: Signers for deployment and testing

```typescript
// Example network configuration
{
  network: 'bdag-primordial',
  chainId: 1043,
  url: 'https://node-blockdag.spacedev.io/rpc',
}
```

### Deployment Manager Configuration

The `deploymentManager` section maps networks to their available deployments and relation configurations:

```typescript
deploymentManager: {
  relationConfigMap, // Base relation configuration
  networks: {
    'bdag-primordial': {
      dai: bdagPrimordialDaiRelationConfigMap,
      _infrastructure: bdagPrimordialInfrastructureRelationConfigMap
    },
    'local': {
      dai: localDaiRelationConfigMap,
      _infrastructure: localInfrastructureRelationConfigMap
    }
  }
}
```

### Relation Configuration Maps

Each deployment requires a `RelationConfigMap` that defines:
- **Contract relationships**: How contracts reference each other
- **Field mappings**: How to extract data from contracts
- **Alias templates**: Naming conventions for discovered contracts

**Required Files:**
- `deployments/{network}/{deployment}/relations.ts` - Network-specific relations
- `deployments/relations.ts` - Base relations (shared across networks)
- `deployments/relations.market.ts` - Market-specific relations
- `deployments/relations.infra.ts` - Infrastructure-specific relations

#### Cloning Mechanism

The cloning process to fetch contract bytecode and data:

```typescript
// From src/deploy/Network.ts
const clone = {
  comp: '0xc00e94cb662c3520282e6f5717214004a7f26888', // Mainnet COMP address
  governorBravoImpl: '0xef3b6e9e13706a8f01fe98fdcf66335dc5cfdeed', // Mainnet Governor implementation
  governorBravo: '0xc0da02939e1441f497fd74f78ce7decb17b66529', // Mainnet Governor proxy
};

// Clone COMP token from mainnet
const COMP = await deploymentManager.clone('COMP', clone.comp, [admin.address]);
```

**What Gets Cloned:**
- **Contract Bytecode**: The actual contract code
- **Storage Layout**: Contract state structure
- **Constructor Arguments**: Initial parameters (if any)
- **Verification Data**: For block explorer verification

#### Benefits

1. **Security**: Use audited, verified contracts from trusted networks
2. **Consistency**: Ensure governance tokens and contracts behave identically
3. **Efficiency**: Avoid re-deploying complex contracts
4. **Verification**: Leverage existing contract verification on source networks

#### Configuration Requirements

When setting up a new network, you must configure:

1. **Network Entry**: Add network to `networkConfigs` array
2. **Deployment Manager**: Add network to `deploymentManager.networks`
3. **Relation Configs**: Create network-specific relation configuration files

## Testing Market on Specific Blockchain

You can test your deployed market on any blockchain network using the same test commands. Here's how to test on different networks:

### Testing on Local Network

```bash
# Deploy with BDAG infrastructure on local network
DEBUG=* yarn hardhat deploy_infrastructure --network local --bdag

# Deploy with BDAG governor on local network
yarn hardhat deploy --bdag --network local --deployment dai

# Run deployment verification test
export MARKET=dai && yarn hardhat test test/deployment-verification-test.ts --network local

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



## How Deployment Scripts Are Executed

When you run `yarn hardhat deploy --deployment dai`, the system automatically finds and executes the correct deployment script. Here's how this works:

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

### Deployment Script Resolution

The deployment system uses a **path-based resolution** to find the right deployment script:

1. **Command Line Parameters**: `--deployment dai` specifies which market to deploy
2. **Network Context**: `--network hardhat` determines the blockchain network
3. **Path Construction**: System builds path: `deployments/{network}/{deployment}/deploy.ts`
4. **Script Execution**: The found script is imported and executed

### Example Path Resolution

```bash
# Command
yarn hardhat deploy --network hardhat --deployment dai

# Resolves to script path
deployments/hardhat/dai/deploy.ts
```

### How the System Finds Your Script

The DeploymentManager creates a Cache object with the network and deployment parameters, which handles all path resolution:

```typescript
// 1. DeploymentManager constructor creates Cache
const dm = new DeploymentManager(
  network,        // 'hardhat'
  deployment,     // 'dai'
  env,
  config
);

// 2. Cache constructor stores network and deployment
this.cache = new Cache(
  this.network,    // 'hardhat'
  this.deployment, // 'dai'
  config.writeCacheToDisk ?? false,
  config.baseDir
);

// 3. Cache.getFilePath() uses stored network/deployment to build path
const deployScript = this.cache.getFilePath({ rel: 'deploy.ts' });
// Returns: deployments/hardhat/dai/deploy.ts

// 4. Import and execute the deployment script
const { default: deployFn } = await import(deployScript);
// Imports the default export from your deploy.ts file

const deployed = await deployFn(this, deploySpec);
// Executes your deployment function
```

### Deployment Script Structure

Each deployment script follows this standard pattern:

```typescript
// deployments/hardhat/dai/deploy.ts
import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(
  deploymentManager: DeploymentManager, 
  deploySpec: DeploySpec
): Promise<Deployed> {
  // Your deployment logic here
  const DAI = await makeToken(/* params */);
  const deployed = await deployComet(deploymentManager, deploySpec, {
    baseTokenPriceFeed: daiPriceFeed.address,
    assetConfigs: [/* configs */],
  });
  
  return deployed;
}
```

### Key Benefits

- **Automatic Discovery**: No need to specify script paths manually
- **Network Isolation**: Each network has its own deployment scripts
- **Market Separation**: Different markets (DAI, USDC, WETH) have separate scripts
- **Consistent Interface**: All deployment scripts follow the same pattern
- **Easy Testing**: Can test different markets by changing the `--deployment` parameter

## Understanding execution flow

**🎯 Automated Solution**: We have created an automated script that handles the entire deployment and upgrade process. You can skip the manual steps below and use our script instead.

**⚠️ Important Note**: These scripts are designed to work when the deployer is the only admin in the governor and the timelock delay is set to 0. This script is ideal for initial deployments and development phases before the governance system is configured for production use with multiple admins and security delays.

### **Automated Deployment Script**

We've created a comprehensive deployment script that automates the entire process:

#### **Script Location:**
```
scripts/deploy-market/
├── index.ts    # TypeScript deployment script
└── index.sh    # Shell wrapper script
```

#### **Usage Examples:**

**TypeScript Script:**
```bash
# Deploy DAI market on local network with BDAG governor
yarn ts-node scripts/deploy-market/index.ts --network local --deployment dai

# Deploy USDC market on polygon network
yarn ts-node scripts/deploy-market/index.ts --network polygon --deployment usdc

# Deploy with clean cache (fresh deployment)
yarn ts-node scripts/deploy-market/index.ts --network local --deployment dai --clean
```

**Shell Script (Simpler):**
```bash
# Deploy DAI market on local network with BDAG governor
./scripts/deploy-market/index.sh -n local -d dai -b

# Deploy USDC market on polygon network
./scripts/deploy-market/index.sh -n polygon -d usdc

# Deploy with clean cache
./scripts/deploy-market/index.sh -n local -d dai -c
```

#### **What the Script Automates:**

✅ **Infrastructure Deployment** - Deploys governance contracts  
✅ **Configuration Updates** - Prompts for market configuration  
✅ **Market Deployment** - Deploys the Comet market  
✅ **Governance Flow** - Handles proposal approval, queueing, and execution  
✅ **Upgrade Process** - Manages implementation upgrades  
✅ **Verification Testing** - Runs deployment verification tests  
✅ **Spider Integration** - Handles root refreshing with retry logic  

#### **Market Upgrades:**

**For market upgrades, simply run the same script again:**
```bash
# The script will detect existing deployment and handle upgrades
yarn ts-node scripts/deploy-market/index.ts --network local --deployment dai --bdag
```

The script automatically:
- Detects if infrastructure already exists
- Prompts for new implementation addresses
- Handles upgrade proposal governance
- Manages spider retries for implementation mismatches

---

### **Manual Execution (Step-by-Step)**

If you prefer to run the process manually, here's exactly what happens:

**1. Deploy Infrastructure:**
```bash
DEBUG=* yarn hardhat deploy_infrastructure --network local --bdag
```

**⚠️ Required Environment Variables for BDAG Infrastructure:**
Before deploying BDAG infrastructure, you must set these environment variables in your `.env` file:

```bash
# Comma-separated list of admin addresses for the multisig governor
GOV_SIGNERS=0x1234...,0x5678...,0x9abc...

# Number of required approvals for governance proposals (must be positive integer)
MULTISIG_THRESHOLD=2

# Timelock delay in seconds before transactions can be executed (must be non-negative integer)
TIMELOCK_DELAY=0

# Grace period in seconds after delay expires (must be positive integer)
GRACE_PERIOD=1209600

# Minimum delay in seconds (must be non-negative integer)
MINIMUM_DELAY=0

# Maximum delay in seconds (must be positive integer)
MAXIMUM_DELAY=2592000
```

**Example:**
```bash
GOV_SIGNERS=0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6,0x1234567890123456789012345678901234567890
MULTISIG_THRESHOLD=2
TIMELOCK_DELAY=0
GRACE_PERIOD=1209600
MINIMUM_DELAY=0
MAXIMUM_DELAY=2592000
```

**Delay Configuration Examples:**
- **`TIMELOCK_DELAY=0`**: No delay - transactions execute immediately (development/testing)
- **`TIMELOCK_DELAY=86400`**: 24-hour delay (1 day = 24 * 60 * 60 seconds)
- **`TIMELOCK_DELAY=604800`**: 7-day delay (1 week = 7 * 24 * 60 * 60 seconds)

**Additional Timelock Configuration:**
- **`GRACE_PERIOD=1209600`**: 14-day grace period (2 weeks = 14 * 24 * 60 * 60 seconds)
- **`MINIMUM_DELAY=0`**: No minimum delay requirement (development/testing)
- **`MINIMUM_DELAY=86400`**: 24-hour minimum delay (production security)
- **`MAXIMUM_DELAY=2592000`**: 30-day maximum delay (1 month = 30 * 24 * 60 * 60 seconds)

*Note: Dont forget to configure the [market]/configuration.json accordingly (price feeds, etc.)*

**2. Deploy Market:**
```bash
DEBUG=* yarn hardhat deploy --network local --deployment dai --bdag
```

> **📋 Note**: For BlockDAG networks, the deployment system uses caching to avoid re-deploying existing contracts. Since BlockDAG doesn't have an explorer API yet, the `.contracts/` cache must be committed to the repository to preserve contract addresses. See the [Deployment Caching and BlockDAG Networks](#deployment-caching-and-blockdag-networks) section below for detailed information.

**3. Governance Flow:**
```bash
# Check proposal status
yarn hardhat governor:status --network local --proposal-id 1 --deployment dai

# Approve proposal
yarn hardhat governor:approve --network local --proposal-id 1 --deployment dai

# Note: The amount of approvements will depend on the threshold the governor has

# Queue proposal
yarn hardhat governor:queue --network local --proposal-id 1 --deployment dai

# Execute proposal with specific execution type for log parsing
yarn hardhat governor:execute --network local --proposal-id 1 --deployment dai --execution-type comet-impl-in-configuration
```

**You will see output like this:**

✅ Proposal 1 executed successfully!
   Transaction hash: 0x...
📋 Extracted Logs:
{
  "txHash": "0x...",
  "blockNumber": 123,
  "logsCount": 5,
  "executionType": "comet-impl-in-configuration",
  "parsedLogs": {
    "cometDeployed": {
      "cometProxy": "0x67d269191c92Caf3cD7723F116c85e6E9bf55933",
      "newComet": "0x8aCd85898458400f7Db866d53FCFF6f0D49741FF",
      "eventName": "CometDeployed"
    }
  }
}

```bash
**Important**: The `newComet` value is the implementation address that will be used in the next step.

# Propose upgrade to new implementation (after previous proposal is executed)

yarn hardhat governor:propose-upgrade --network local --deployment dai --implementation 0x...

# The upgrade proposal will need to go through the same governance flow:
# 1. Check proposal status: yarn hardhat governor:status --network local --proposal-id 2 --deployment dai
# 2. Approve proposal: yarn hardhat governor:approve --network local --proposal-id 2 --deployment dai
# 3. Queue proposal: yarn hardhat governor:queue --network local --proposal-id 2 --deployment dai
# 4. Execute proposal: yarn hardhat governor:execute --network local --proposal-id 2 --deployment dai --execution-type comet-upgrade
# 5. Refresh roots: yarn hardhat spider --network local --deployment dai

## ⚠️ Important: Spider Implementation Mismatch Resolution

**Expected Behavior**: When running spider after a deployment, you may encounter an error indicating that the implementation does not match. This is **normal and expected** behavior.

### Resolution Steps:

1. **Update `aliases.json`**: 
   - Locate the `comet:implementation` entry in your deployment's `aliases.json` file
   - Update the address to match the actual deployed implementation address

2. **Update `roots.json`** (if needed):
   - Check if `roots.json` also needs to be updated with the correct implementation address

3. **Re-run spider**:
   yarn hardhat spider --network <network> --deployment <deployment>

  ### Why This Happens:
  This occurs because the spider process compares the expected implementation address (from configuration) with the actual deployed implementation address. When they don't match (which is common after deployments), spider reports this as an error to ensure data consistency.

  ### Example:
  ```bash
  # First run (may show implementation mismatch error)
  yarn hardhat spider --network local --deployment dai

  # Update aliases.json and roots.json with correct addresses
  # Then re-run (should succeed)
  yarn hardhat spider --network local --deployment dai
  ```

4. **Verify success**: After these updates, running spider again should complete without errors.


**4. Test deployment** 

```bash
export MARKET=dai && yarn hardhat test test/deployment-verification-test.ts --network local
```
**5. Mint tokens to CometReward**
   **Note**: This step is only required if you need to distribute reward tokens to users. The CometReward contract manages the distribution of COMP tokens to users based on their supply/borrow activity. A `mint-rewards` task WILL be created in governor: `governor:fund-comet-rewards`. 

## Deployment Caching and BlockDAG Networks

The deployment system uses caching to avoid re-deploying existing contracts. For standard networks with explorer APIs, the system can automatically fetch contract data and populate the cache. However, BlockDAG networks don't have explorer APIs yet, so the `.contracts/` cache must be manually committed to the repository to preserve contract addresses. This ensures that team members can access the same contract instances and maintain deployment consistency across the project.

## Available Execution Types

The `--execution-type` parameter determines which logs to extract and analyze during proposal execution.

Possible values `comet-impl-in-configuration` |`comet-upgrade`


## Custom Governor Implementation

This section describes how the system automatically chooses between Governor Bravo and a custom multisig governor based on configuration flags.

### Implementation Overview

The system uses a **flag-based approach** to automatically select the appropriate governor:

- **`--bdag` flag**: Uses custom multisig governor (`createBDAGGov`)
- **No flag**: Uses standard Governor Bravo (`_cloneGov`)

### Step 1: Custom Governor Contract ✅
- Created `contracts/CustomGovernor.sol` that implements `IGovernorBravo`
- Implements all required functions and events from the interface
- Features multisig logic with admin approvals instead of token voting
- Includes UUPS upgradeability for future improvements

### Step 2: Flag-Based Governor Selection ✅
- Modified `cloneGov()` function in `src/deploy/Network.ts` to check `deploymentManager.config.bdag`
- If BDAG flag is set: uses `createBDAGGov()` (custom governor)
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

### Why Custom Governor uses UUPS

**Security Argument**: UUPS was chosen over Transparent Proxy because in Transparent Proxy we would need to choose a proxyAdmin owner, and there is no other admin that can govern the governor. If an EOA controls the proxy admin, all future security would be compromised. UUPS ensures the governor contract itself manages upgrades, maintaining security regardless of who controls the proxy admin.


## SimpleTimelock with Governor Integration

The **SimpleTimelock** is used for governance execution, where the **Governor** handles signature encoding:

**Governor**: Includes function signature in calldata
```solidity
// Governor encodes the complete function call including signature
bytes memory callData = abi.encodeWithSignature("functionName(params)", ...);
```

**SimpleTimelock**: Uses pre-encoded calldata directly
```solidity
bytes memory callData = data; // signature already included in data from governor
```

**Why**: The Governor is responsible for creating properly encoded function calls, so the SimpleTimelock can execute them directly without additional signature handling.

**Impact**: Clean separation of concerns - Governor handles call encoding, SimpleTimelock handles execution timing and authorization.



## Reconfigure Comet

Comet has a **critical restriction** on reconfiguring markets:

```solidity
if (oldConfiguration.baseToken != address(0) &&
    (oldConfiguration.baseToken != newConfiguration.baseToken ||
     oldConfiguration.trackingIndexScale != newConfiguration.trackingIndexScale))
    revert ConfigurationAlreadyExists();
```

### Rules

**✅ Allowed**: Keep base token AND tracking index scale the same
- Asset configurations, collateral factors, supply caps, price feeds

**❌ Blocked**: Change base token OR tracking index scale
- Base token changes (USDC → DAI)
- Tracking index scale changes (1e18 → 1e6)

### Tracking Index Scale

Precision multiplier for calculations:
```solidity
1e18  // 18 decimals (WETH)
1e6   // 6 decimals (USDC)
1e8   // 8 decimals (WBTC)
```

### Examples

**✅ Works**: Same base token + scale, different assets
**❌ Fails**: Different base token or scale

### Why

Prevents breaking user balances and accounting errors.

**Impact**: Proposals must match existing base token and tracking index scale.