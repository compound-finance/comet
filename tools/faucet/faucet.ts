import { ethers } from 'ethers';

// Global configuration - modify these values
const CONFIG: FaucetConfig = {
  faucetAddress: "0x949b2175F38BF40e30A3A68D506B2999acEC4b85", // Your faucet address
  rpcUrl: "<YOUR_RPC_URL>", // Your RPC URL
  privateKey: "<YOUR_PRIVATE_KEY>", // Your private key
  tokens: [
    { address: "0xC6F11e6124D8c4864951229652497c782EC17e38" }, // DAI
    { address: "0xf24B549f81c9de7a99e5247Bc29328B4CAf44dF3" }, // WBTC
    { address: "0x76b6383fB0bAeE78fF330Ae4E5674cF60798f651" }, // WETH
  ]
};

// Faucet ABI - just the drip function
const FAUCET_ABI = [
  "function drip(address token) external",
  "function lastReceived(address user, address token) external view returns (uint256)"
];

// ERC20 ABI for balance checks
const ERC20_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)"
];

interface TokenInfo {
  address: string;
  symbol?: string;
  decimals?: number;
}

interface FaucetConfig {
  faucetAddress: string;
  rpcUrl: string;
  privateKey: string;
  tokens: TokenInfo[];
}

class FaucetClient {
  private provider: ethers.providers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private faucet: ethers.Contract;
  private tokens: TokenInfo[];

  constructor(config: FaucetConfig) {
    this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.faucet = new ethers.Contract(config.faucetAddress, FAUCET_ABI, this.wallet);
    this.tokens = config.tokens;
  }

  async getTokenInfo(tokenAddress: string): Promise<{ symbol: string; decimals: number }> {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    const [symbol, decimals] = await Promise.all([
      token.symbol(),
      token.decimals()
    ]);
    return { symbol, decimals };
  }

  async checkBalance(tokenAddress: string, userAddress: string): Promise<bigint> {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    return await token.balanceOf(userAddress);
  }

  async checkLastReceived(tokenAddress: string): Promise<bigint> {
    return await this.faucet.lastReceived(this.wallet.address, tokenAddress);
  }

  async canDrip(tokenAddress: string): Promise<boolean> {
    try {
      const lastReceived = await this.checkLastReceived(tokenAddress);
      const now = BigInt(Math.floor(Date.now() / 1000));
      const oneDay = 24n * 60n * 60n; // 1 day in seconds
      
      // Ensure lastReceived is converted to BigInt
      const lastReceivedBigInt = BigInt(lastReceived.toString());
      
      return (now - lastReceivedBigInt) >= oneDay;
    } catch (error) {
      console.log(`Error checking last received for token ${tokenAddress}:`, error);
      return true; // Assume we can drip if we can't check
    }
  }

  async dripToken(tokenAddress: string): Promise<boolean> {
    try {
      console.log(`Attempting to drip token: ${tokenAddress}`);
      
      // Check if we can drip
      if (!(await this.canDrip(tokenAddress))) {
        console.log(`Cannot drip yet. 24h cooldown not met.`);
        return false;
      }

      // Get token info for logging
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      
      // Check balance before drip
      const balanceBefore = await this.checkBalance(tokenAddress, this.wallet.address);
      console.log(`Balance before drip: ${ethers.utils.formatUnits(balanceBefore, tokenInfo.decimals)} ${tokenInfo.symbol}`);

      // Execute drip
      const tx = await this.faucet.drip(tokenAddress);
      console.log(`Drip transaction sent: ${tx.hash}`);
      
      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(`Drip transaction confirmed in block ${receipt.blockNumber}`);

      // Check balance after drip
      const balanceAfter = await this.checkBalance(tokenAddress, this.wallet.address);
      console.log(`Balance after drip: ${ethers.utils.formatUnits(balanceAfter, tokenInfo.decimals)} ${tokenInfo.symbol}`);
      return true;
    } catch (error) {
      console.error(`Error dripping token ${tokenAddress}:`, error);
      return false;
    }
  }

  async dripAllTokens(): Promise<void> {
    console.log(`Starting faucet drip for wallet: ${this.wallet.address}`);
    console.log(`Faucet address: ${this.faucet.target}`);
    console.log(`Number of tokens: ${this.tokens.length}`);
    console.log('---');

    for (const token of this.tokens) {
      console.log(`\nProcessing token: ${token.address}`);
      
      if (token.symbol && token.decimals) {
        console.log(`Token: ${token.symbol} (${token.decimals} decimals)`);
      } else {
        try {
          const tokenInfo = await this.getTokenInfo(token.address);
          token.symbol = tokenInfo.symbol;
          token.decimals = tokenInfo.decimals;
          console.log(`Token: ${token.symbol} (${token.decimals} decimals)`);
        } catch (error) {
          console.log(`Could not get token info: ${error}`);
          continue;
        }
      }

      const success = await this.dripToken(token.address);
      if (success) {
        console.log(`✅ Successfully dripped ${token.symbol || token.address}`);
      } else {
        console.log(`❌ Failed to drip ${token.symbol || token.address}`);
      }
      
      console.log('---');
    }

    console.log('Faucet drip process completed!');
  }
}

// Main execution function
async function main() {
  try {
    const faucetClient = new FaucetClient(CONFIG);
    await faucetClient.dripAllTokens();
  } catch (error) {
    console.error('Faucet script failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { FaucetClient, FaucetConfig, TokenInfo };

// Run if called directly
if (require.main === module) {
  main();
}
