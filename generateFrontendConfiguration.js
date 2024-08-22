const fs = require('fs');

// Read and parse the aliases.json and configuration.json files
const aliases = JSON.parse(fs.readFileSync('deployments/sepolia/usdc/aliases.json', 'utf8'));
const configuration = JSON.parse(fs.readFileSync('deployments/sepolia/usdc/configuration.json', 'utf8'));

// Define the base frontendConfig
let frontendConfig = {
  "config": {
    "assets": [],
    "EthUsdProxyAddress": configuration.baseTokenAddress,
    "UsdcUsdProxyAddress": configuration.baseTokenPriceFeed,
    "network": {
        "chainId": 11155111,
        "name": "ETH Sepolia",
        "rpc": "https://1rpc.io/31sBCvq4UwMqYCWCg/sepolia",
        "nativeCurrency": {
          "name": "Ether",
          "symbol": "ETH",
          "wrapped": "WETH",
          "decimals": 18
        },
        "explorerLink": "https://sepolia.etherscan.io"
      }
  },
  "deployed-contracts": aliases,
};

// Iterate over the assets in the configuration file
for (let assetSymbol in configuration.assets) {
  // Add the asset to the frontendConfig
  frontendConfig.config.assets.push({
    "symbol": assetSymbol,
    "address": configuration.assets[assetSymbol].address,
    "priceFeed": configuration.assets[assetSymbol].priceFeed,
    "decimals": configuration.assets[assetSymbol].decimals
  });
}

// Write the frontendConfig to a new JSON file
fs.writeFileSync('frontendConfig.json', JSON.stringify(frontendConfig, null, 2));