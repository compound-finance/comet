# Faucet Tool

A TypeScript tool for interacting with the Comet faucet contract. This tool allows you to automatically drip tokens from the faucet using a list of token addresses and a private key.

## Features

- **Automated token dripping** from the faucet contract
- **Balance tracking** before and after each drip
- **Cooldown checking** to respect the 24-hour limit
- **Comprehensive logging** of all operations
- **Error handling** with graceful fallbacks
- **TypeScript support** with proper type definitions

## Installation

1. Navigate to the `aux-tools` directory:
   ```bash
   cd aux-tools
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

Edit the `CONFIG` object in `faucet.ts` to set your parameters:

```typescript
const CONFIG: FaucetConfig = {
  faucetAddress: "YOUR_FAUCET_ADDRESS",
  rpcUrl: "YOUR_RPC_URL",
  privateKey: "YOUR_PRIVATE_KEY",
  tokens: [
    { address: "TOKEN_1_ADDRESS" },
    { address: "TOKEN_2_ADDRESS" },
    // Add more tokens as needed
  ]
};
```

## Usage

### Development Mode (with ts-node)
```bash
npm run dev
```

### Build and Run
```bash
# Build the project
npm run build

# Run the compiled JavaScript
npm start
```

### Clean Build
```bash
npm run clean
npm run build
```

## Project Structure

```
aux-tools/
├── faucet.ts          # Main faucet logic and configuration
├── package.json       # Project dependencies and scripts
├── tsconfig.json      # TypeScript configuration
├── README.md          # This file
└── dist/              # Compiled JavaScript output (generated)
```

## Dependencies

- **ethers**: Ethereum library for interacting with smart contracts
- **TypeScript**: For type safety and modern JavaScript features
- **ts-node**: For running TypeScript directly during development

## Scripts

- `npm run dev`: Run the faucet tool directly with ts-node
- `npm run build`: Compile TypeScript to JavaScript
- `npm start`: Run the compiled JavaScript
- `npm run clean`: Remove the dist directory
- `npm run prebuild`: Automatically clean before building

## Example Output

```
Starting faucet drip for wallet: 0x...
Faucet address: 0x...
Number of tokens: 3
---

Processing token: 0x...
Token: DAI (18 decimals)
Attempting to drip token: 0x...
Balance before drip: 0.0 DAI
Drip transaction sent: 0x...
Drip transaction confirmed in block 12345
Balance after drip: 1000.0 DAI
Received: 1000.0 DAI
✅ Successfully dripped DAI
---
```

## Security Notes

- **Never commit private keys** to version control
- **Use environment variables** for sensitive data in production
- **Test on testnets** before using on mainnet
- **Verify contract addresses** before executing transactions

## License

MIT 