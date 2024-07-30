const hre = require("hardhat");
const fs = require("fs");

module.exports = async () => {
    let data = fs.readFileSync('./config.json', 'utf8');
    let config;
    try {
        config = JSON.parse(data);
    }
    catch (err) {
        console.error('Error parsing config file:', err);
        return;
    }
    let deploymentsConfig = {
        assets: []
    };

    for (const asset of config.assets) {
        // Deploy the ERC20 asset and mint some tokens.
        const ERC20 = await hre.deployments.deploy("ERC20Token", {
            // Pass in the name and symbol of your asset here
            args: [asset.assetName, asset.assetSymbol],
            from: (await hre.getUnnamedAccounts())[0],
            log: true,
        });
        console.log (`Deployed ${asset.assetName} at ${ERC20.address}`);

        // Deploy the EACAggregatorProxy dAPI adaptor for the asset.
        const EACAggregatorProxy = await hre.deployments.deploy("EACAggregatorProxy", {
            args: [asset.proxyAddress, asset.description],
            from: (await hre.getUnnamedAccounts())[0],
            log: true,
        });
        console.log(`Deployed EACAggregatorProxy for ${asset.assetName} at ${EACAggregatorProxy.address}`);

        deploymentsConfig.assets.push({
            assetSymbol: asset.assetSymbol,
            pairName: asset.pairName,
            EACAggregatorProxy: EACAggregatorProxy.address
        });
    }

    // // Deploy USDC With Faucet
    // const USDCWithFaucet = await hre.deployments.deploy("USDCTOKEN", {
    //     args: [],
    //     from: (await hre.getUnnamedAccounts())[0],
    //     log: true,
    // });
    // deploymentsConfig['USDCWithFaucet'] = USDCWithFaucet.address;

    // Deploy EACAggregatorProxyUSDC
    const EACAggregatorProxyUSDC = await hre.deployments.deploy("EACAggregatorProxy", {
        args: [config.UsdcUsdProxyAddress, "Price Feed Adaptor For USDC/USD"],
        from: (await hre.getUnnamedAccounts())[0],
        log: true,
    });
    deploymentsConfig['EACAggregatorProxyUSDC'] = EACAggregatorProxyUSDC.address;

    // // Deploy Api3AggregatorAdaptor for WETH/USD
    // const Api3AggregatorAdaptorWETH = await hre.deployments.deploy("Api3AggregatorAdaptor", {
    //     args: [config.EthUsdProxyAddress, config.UsdcUsdProxyAddress, "WETH/USDC"],
    //     from: (await hre.getUnnamedAccounts())[0],
    //     log: true,
    // });
    // deploymentsConfig['Api3AggregatorAdaptorWETH'] = Api3AggregatorAdaptorWETH.address;

    // const MockWETH = await hre.deployments.deploy("MockWETH", {
    //     args: ["Mock Wrapped ETH", "WETH10"],
    //     from: (await hre.getUnnamedAccounts())[0],
    //     log: true,
    // });
    // deploymentsConfig['MockWETH'] = MockWETH.address;

    fs.writeFileSync('references.json', JSON.stringify(deploymentsConfig, null, 2));
    console.log('Deployments saved to references.json');
};

module.exports.tags = ['deployDapiAdapter'];