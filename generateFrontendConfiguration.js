const fs = require("fs");

// Read and parse the aliases.json and configuration.json files
const aliases = JSON.parse(
  fs.readFileSync("deployments/sepolia/usdc/aliases.json", "utf8")
);
const configuration = JSON.parse(
  fs.readFileSync("deployments/sepolia/usdc/configuration.json", "utf8")
);

// Define the base frontendConfig
let frontendConfig = {
  currentMarket: "compound",
  compound: {
    config: {
      baseToken: configuration.baseTokenAddress,
      rewardToken: configuration?.assets?.[configuration.rewardToken].address,
      network: {
        chainId: 11155111,
        name: "ETH Sepolia",
        rpc:
          "https://rough-damp-scion.ethereum-sepolia.quiknode.pro/cc005555675ae91caad17e851ac5061e12d61f4a/",
        nativeCurrency: {
          name: "Ether",
          symbol: "ETH",
          wrapped: "WETH",
          decimals: 18,
        },
        explorerLink: "https://sepolia.etherscan.io",
      },
    },
    "deployed-contracts": {
      ...aliases,
      priceFeeds: {},
    },
  },
};

// Iterate over the assets in the configuration file
for (let assetSymbol in configuration.assets) {
  // Add the asset to the frontendConfig
  // frontendConfig.config.assets.push({
  //   symbol: assetSymbol,
  //   address: configuration.assets[assetSymbol].address,
  //   priceFeed: configuration.assets[assetSymbol].priceFeed,
  //   decimals: configuration.assets[assetSymbol].decimals,
  // });
  frontendConfig.compound["deployed-contracts"].priceFeeds[assetSymbol] =
    configuration.assets[assetSymbol].priceFeed;
}
// add base token price feed
frontendConfig.compound["deployed-contracts"].priceFeeds[
  configuration.baseToken
] = configuration.baseTokenPriceFeed;
// Write the frontendConfig to a new JSON file
fs.writeFileSync(
  "api3-aave-ui/deployment-configs.json",
  JSON.stringify(frontendConfig, null, 2)
);
