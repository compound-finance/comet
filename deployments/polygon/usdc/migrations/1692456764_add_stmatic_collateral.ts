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

    const maticx = await deploymentManager.existing(
      "STMATIC",
      STMATIC_ADDRESS,
      "polygon",
      "contracts/ERC20.sol:ERC20"
    );
    const maticxPricefeed = await deploymentManager.existing(
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
      asset: maticx.address,
      priceFeed: maticxPricefeed.address,
      decimals: await maticx.decimals(),
      borrowCollateralFactor: exp(0.55, 18),
      liquidateCollateralFactor: exp(0.60, 18),
      liquidationFactor: exp(0.93, 18),
      supplyCap: exp(6_000_000, 18),
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

    const description = "# Add stMATIC as Collateral to USDCv3 Polygon Market\n\n Using stMATIC as a collateral asset has added significant value on other lending platforms like Aave v3 (Polygon) and a popular leveraged staking strategy increasing utilization rates for MATIC. For Compound, stMATIC offers a good collateral option because of its extensive use and composability on Polygon.\n\n ## stMATIC - Key Reasons to List on Compound\n\n stMATIC is deeply integrated with DeFI projects such as Aave and Balancer.\n There is $10M+ liquidity in stMATIC based pools cross leading DEXs\n ~35M stMATIC supplied on Aave against supply cap of 38M stMATIC. Proposal to enhance supply cap to 50.6M stMATIC underway.\n stMATIC TVL has grown to 84M+ MATIC steadily ever since its launch in Apr’22.\n There is 20M+ stMATIC on Polygon that haven't been deployed on DeFi yet, which offers a large TVL opportunity for Compound\n\n ## Proposed Parameters\n\n Liquidity - stMATIC currently has a TVL of 84M+ MATIC staked and total liquidity of $10M+ in stMATIC based liquidity pools on ecosystem DEXs with Balancer being the lead along with QuickSwap & MeshSwap.\n This proposal is to set the parameters for stMATIC as below based on [Gauntlet's  recommendations](https://www.comp.xyz/t/gauntlet-recommendations-stmatic-and-maticx-listing-on-polygon-compound-v3/4397)\n supplyCap: 6,000,000\n borrowCollateralFactor: 55%\n liquidateCollateralFactor: 60%\n liquidationFactor: 93%\n The proposal is to be made from [this pull request](https://github.com/compound-finance/comet/pull/780/files)\n\n ## Background - stMATIC\n\n Stader's staking solution for Polygon is stMATIC, a liquid staking solution for MATIC. Stader lets users earn MATIC staking rewards and also enables users to participate in other Defi protocols using stMATIC while accruing rewards.\n stMATIC is a token that represents your share of the total MATIC pool deposited with Stader. As soon as you deposit MATIC on the Stader smart contract, you receive newly minted stMATIC, based on the exchange rate at the time of staking. As the MATIC rewards get added the value of stMATIC increases (w.r.t MATIC).\n\n Stader for Polygon gives you\n Liquidity through tokenization\n Ease of staking\n stMATIC is the only solution that allows users to natively stake their MATIC on Polygon, allowing users to take advantage of the low transaction fee\n\n ## stMATIC Security:\n\n Stader on Polygon protocol contracts are dual audited:\n\n [Here](https://staderlabs-docs.s3.amazonaws.com/audits/polygon/StaderLabs_stMATIC_Smart_Contract_Security_Audit_Report_Halborn_Final.pdf) is the link to the Audit completed by Halborn\n [Here](https://staderlabs-docs.s3.amazonaws.com/audits/polygon/StaderLabs_maticX_Audit_Report_Immunebytes.pdf) is the link to the Audit completed by Immunebytes\n Stader's contracts for stMATIC are controlled by a multi-sig account (0x91B4139A2FAeaCD4CdbFc3F7B1663F91a54be237) managed by the internal as well as external parties. The confirmation count is 3 out of 5 signatures required $1Mn Bug Bounty on [Immunefi](https://immunefi.com/bounty/StaderforPolygon/)\n Ongoing monitoring and on-chain security tracking by [Forta](https://app.forta.network/agents/stader-labs) External multi-sig and time-lock drive the staking contract\n\n ## References\n\n [stMATIC Chainlink Oracle Price Feed](https://polygonscan.com/address/0x5d37E4b374E6907de8Fc7fb33EE3b0af403C7403)\n [Polygonscan - stMATIC address](https://polygonscan.com/token/0xfa68fb4628dff1028cfec22b4162fccd0d45efb6)\n [Forum Discussion](https://www.comp.xyz/t/listing-maticx-on-compound/4306)\n";
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

    const maticxAssetIndex = Number(await comet.numAssets()) - 1;

    const maticxAssetConfig = {
      asset: STMATIC_ADDRESS,
      priceFeed: STMATIC_PRICE_FEED_ADDRESS,
      decimals: 18,
      borrowCollateralFactor: exp(0.55, 18),
      liquidateCollateralFactor: exp(0.60, 18),
      liquidationFactor: exp(0.93, 18),
      supplyCap: exp(6_000_000, 18),
    };

    // 1. Compare proposed asset config with Comet asset info
    const cometMaticxAssetInfo = await comet.getAssetInfoByAddress(
      STMATIC_ADDRESS
    );
    expect(maticxAssetIndex).to.be.equal(cometMaticxAssetInfo.offset);
    expect(maticxAssetConfig.asset).to.be.equal(cometMaticxAssetInfo.asset);
    expect(maticxAssetConfig.priceFeed).to.be.equal(
      cometMaticxAssetInfo.priceFeed
    );
    expect(exp(1, maticxAssetConfig.decimals)).to.be.equal(
      cometMaticxAssetInfo.scale
    );
    expect(maticxAssetConfig.borrowCollateralFactor).to.be.equal(
      cometMaticxAssetInfo.borrowCollateralFactor
    );
    expect(maticxAssetConfig.liquidateCollateralFactor).to.be.equal(
      cometMaticxAssetInfo.liquidateCollateralFactor
    );
    expect(maticxAssetConfig.liquidationFactor).to.be.equal(
      cometMaticxAssetInfo.liquidationFactor
    );
    expect(maticxAssetConfig.supplyCap).to.be.equal(
      cometMaticxAssetInfo.supplyCap
    );

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorMaticxAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[maticxAssetIndex];
    expect(maticxAssetConfig.asset).to.be.equal(
      configuratorMaticxAssetConfig.asset
    );
    expect(maticxAssetConfig.priceFeed).to.be.equal(
      configuratorMaticxAssetConfig.priceFeed
    );
    expect(maticxAssetConfig.decimals).to.be.equal(
      configuratorMaticxAssetConfig.decimals
    );
    expect(maticxAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorMaticxAssetConfig.borrowCollateralFactor
    );
    expect(maticxAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorMaticxAssetConfig.liquidateCollateralFactor
    );
    expect(maticxAssetConfig.liquidationFactor).to.be.equal(
      configuratorMaticxAssetConfig.liquidationFactor
    );
    expect(maticxAssetConfig.supplyCap).to.be.equal(
      configuratorMaticxAssetConfig.supplyCap
    );
  },
});
