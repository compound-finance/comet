import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { expect } from "chai";
import { calldata, exp, proposal } from "../../../../src/deploy";
import { utils } from "ethers";

interface Vars {}

const STMATIC_ADDRESS = "0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4"
const STMATIC_PRICE_FEED_ADDRESS = "0x97371dF4492605486e23Da797fA68e55Fc38a13f"

export default migration('1692456764_add_stmatic_collateral', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    vars: Vars
  ) => {
    const trace = deploymentManager.tracer();

    const stmatic = await deploymentManager.existing(
      "STMATIC",
      STMATIC_ADDRESS,
      "polygon",
      "contracts/ERC20.sol:ERC20"
    );
    const stmaticPricefeed = await deploymentManager.existing(
      "STMATIC:priceFeed",
      STMATIC_PRICE_FEED_ADDRESS,
      "polygon"
    );

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const { fxRoot, governor } = await govDeploymentManager.getContracts();

    const newAssetConfig = {
      asset: stmatic.address,
      priceFeed: stmaticPricefeed.address,
      decimals: await stmatic.decimals(),
      borrowCollateralFactor: exp(0.60, 18),
      liquidateCollateralFactor: exp(0.65, 18),
      liquidationFactor: exp(0.07, 18),
      supplyCap: exp(8_000_000, 18)
    };

    const addAssetCalldata = await calldata(
      configurator.populateTransaction.addAsset(comet.address, newAssetConfig)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ["address", "address"],
      [configurator.address, comet.address]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ["address[]", "uint256[]", "string[]", "bytes[]"],
      [
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          "addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))",
          "deployAndUpgradeTo(address,address)",
        ],
        [addAssetCalldata, deployAndUpgradeToCalldata],
      ]
    );

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Polygon.
      {
        contract: fxRoot,
        signature: "sendMessageToChild(address,bytes)",
        args: [bridgeReceiver.address, l2ProposalData],
      },
    ];

    const description = "# Add stMATIC as Collateral to USDCv3 Polygon Market\n\n Using stMATIC as a collateral asset has added significant value on other lending platforms like Aave v3 (Polygon) and a popular leveraged staking strategy increasing utilization rates for MATIC. For Compound, stMATIC offers a good collateral option because of its extensive use and composability on Polygon.\n\n ## stMATIC - Key Reasons to List on Compound\n\n stMATIC is deeply integrated with DeFI projects such as Aave and Balancer.\n stMATIC TVL has grown to 135M+ MATIC steadily ever since its launch.\n There is 40M+ stMATIC on Polygon that haven't been deployed on DeFi yet, which offers a large TVL opportunity for Compound\n\n ## Proposed Parameters\n\n Liquidity - stMATIC currently has a TVL of 135M+ MATIC staked.\n This proposal is to set the parameters for stMATIC as below based on [Gauntlet's  recommendations](https://www.comp.xyz/t/gauntlet-recommendations-stmatic-and-stmatic-listing-on-polygon-compound-v3/4397)\n supplyCap: 8,000,000\n borrowCollateralFactor: 60%\n liquidateCollateralFactor: 65%\n liquidationFactor: 7%\n The proposal is to be made from [this pull request](https://github.com/compound-finance/comet/pull/808/files)\n\n ## Background - stMATIC\n\n Lido on Polygon staking solution for Polygon is stMATIC, a liquid staking solution for MATIC. Lido on Polygon lets users earn MATIC staking rewards and also enables users to participate in other Defi protocols using stMATIC while accruing rewards.\n stMATIC is a token that represents your share of the total MATIC pool deposited with Lido on Polygon. As soon as you deposit MATIC on the Lido on Polygon smart contract, you receive newly minted stMATIC, based on the exchange rate at the time of staking. As the MATIC rewards get added the value of stMATIC increases.\n\n Lido on Polygon for Polygon gives you\n Liquidity through tokenization\n Ease of staking\n stMATIC is the only solution that allows users to natively stake their MATIC on Polygon, allowing users to take advantage of the low transaction fee\n\n ## stMATIC Security:\n\n Lido on Polygon protocol contracts are dual audited:\n\n [Here](https://github.com/lidofinance/polygon-contracts/tree/main/audits) is the link to the Audits\n Lido on Polygon contracts for stMATIC are controlled by a multi-sig account (0xd65Fa54F8DF43064dfd8dDF223A446fc638800A9) managed by (Shardlabs, Lido and Polygon). The Lido on Polygon bug bounty program on [Immunefi](https://immunefi.com/bounty/lidoonpolygon/)\n\n ## References\n\n [stMATIC Chainlink Oracle Price Feed](https://polygonscan.com/address/0x97371dF4492605486e23Da797fA68e55Fc38a13f)\n [Polygonscan - stMATIC address](https://polygonscan.com/token/0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4)\n [Forum Discussion](https://www.comp.xyz/t/stmatic-compound-listing/4293)\n";
    const txn = await govDeploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );

    const event = txn.events.find(
      (event) => event.event === "ProposalCreated"
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const stmaticAssetIndex = Number(await comet.numAssets()) - 1;

    const stmaticAssetConfig = {
      asset: STMATIC_ADDRESS,
      priceFeed: STMATIC_PRICE_FEED_ADDRESS,
      decimals: 18,
      borrowCollateralFactor: exp(0.55, 18),
      liquidateCollateralFactor: exp(0.60, 18),
      liquidationFactor: exp(0.93, 18),
      supplyCap: exp(6_000_000, 18),
    };

    // 1. Compare proposed asset config with Comet asset info
    const cometstmaticAssetInfo = await comet.getAssetInfoByAddress(
      STMATIC_ADDRESS
    );
    expect(stmaticAssetIndex).to.be.equal(cometstmaticAssetInfo.offset);
    expect(stmaticAssetConfig.asset).to.be.equal(cometstmaticAssetInfo.asset);
    expect(stmaticAssetConfig.priceFeed).to.be.equal(
      cometstmaticAssetInfo.priceFeed
    );
    expect(exp(1, stmaticAssetConfig.decimals)).to.be.equal(
      cometstmaticAssetInfo.scale
    );
    expect(stmaticAssetConfig.borrowCollateralFactor).to.be.equal(
      cometstmaticAssetInfo.borrowCollateralFactor
    );
    expect(stmaticAssetConfig.liquidateCollateralFactor).to.be.equal(
      cometstmaticAssetInfo.liquidateCollateralFactor
    );
    expect(stmaticAssetConfig.liquidationFactor).to.be.equal(
      cometstmaticAssetInfo.liquidationFactor
    );
    expect(stmaticAssetConfig.supplyCap).to.be.equal(
      cometstmaticAssetInfo.supplyCap
    );

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorstmaticAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[stmaticAssetIndex];
    expect(stmaticAssetConfig.asset).to.be.equal(
      configuratorstmaticAssetConfig.asset
    );
    expect(stmaticAssetConfig.priceFeed).to.be.equal(
      configuratorstmaticAssetConfig.priceFeed
    );
    expect(stmaticAssetConfig.decimals).to.be.equal(
      configuratorstmaticAssetConfig.decimals
    );
    expect(stmaticAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorstmaticAssetConfig.borrowCollateralFactor
    );
    expect(stmaticAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorstmaticAssetConfig.liquidateCollateralFactor
    );
    expect(stmaticAssetConfig.liquidationFactor).to.be.equal(
      configuratorstmaticAssetConfig.liquidationFactor
    );
    expect(stmaticAssetConfig.supplyCap).to.be.equal(
      configuratorstmaticAssetConfig.supplyCap
    );
  },
});
