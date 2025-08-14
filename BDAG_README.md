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


### Plan to Implement Custom Governor

This section outlines the step-by-step process to replace the cloned Governor Bravo with a custom governor implementation that's compatible with the `IGovernorBravo` interface.

#### Step 1: Create a Custom Governor Contract
- Create `contracts/CustomGovernor.sol` that implements `IGovernorBravo`
- Implement all required functions and events from the interface
- Add custom logic while maintaining compatibility

#### Step 2: Create createGov Method in Network.ts
- Add `createGov()` function in `src/deploy/Network.ts`
- Deploy custom governor implementation instead of cloning from mainnet
- Set up proxy pattern with custom implementation
- Configure timelock and token relationships

#### Step 3: Update Deployment Scripts
- Modify deployment scripts to use `createGov()` instead of `cloneGov()`
- Update `deployments/local/dai/deploy.ts` and other deployment files
- Ensure proper contract initialization

#### Step 4: Update Relations Configuration
- Modify `deployments/relations.ts` to point to custom governor
- Update artifact references for custom implementation
- Ensure spider tool can discover custom governor

#### Step 5: Test Custom Governor
- Create test scenarios for custom governor functionality
- Verify proposal creation, voting, and execution
- Test integration with existing Comet infrastructure

#### Step 6: Deploy and Verify
- Deploy custom governor to target networks
- Verify contract source code on block explorers
- Test governance proposals end-to-end

---