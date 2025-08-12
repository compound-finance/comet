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
