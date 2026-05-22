import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils, Contract } from 'ethers';

const CBBTC_USD_SVR_PRICE_FEED_ADDRESS = '0x2231aEdEf63Bef7F32fA1cEc5851C5CD72746263';
const ETH_USD_SVR_PRICE_FEED_ADDRESS = '0x1428C9E908e32dD2839F99D63C242c91329A58C0';

const AERO_COMET_ADDRESS = '0x784efeB622244d2348d4F2522f8860B96fbEcE89';
const USDC_COMET_ADDRESS = '0xb125E6687d4313864e53df431d5425969c15Eb2F';
const USDS_COMET_ADDRESS = '0x2c776041CCFe903071AF44aa147368a9c8EEA518';
const WETH_COMET_ADDRESS = '0x46e6b214b524310239732D51387075E0e70970bf';

const abi = [
  'function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))',
  'function getPrice(address priceFeed) public view returns (uint256)'
];

let newCbEthToUsdPriceFeed: string;
let newCbEthToEthPriceFeed: string;

let oldAeroCbBTCToUsdPriceFeed: string;
let oldUsdcCbBTCToUsdPriceFeed: string;
let oldUsdsCbBTCToUsdPriceFeed: string;
let oldWethCbBTCToEthPriceFeed: string;

export default migration('1779459694_update_cbbtc_to_svr', {
  async prepare(deploymentManager: DeploymentManager) {
    const cbBTCToUsdPriceFeed = await deploymentManager.deploy(
      'cbBTC:priceFeed',
      'pricefeeds/ScalingPriceFeedWithCustomDescription.sol',
      [
        CBBTC_USD_SVR_PRICE_FEED_ADDRESS, // BTC / USD price feed
        8,                                // decimals
        'cbBTC / USD SVR price feed',     // description
      ],
      true
    );

    const cbBTCToEthPriceFeed = await deploymentManager.deploy(
      'cbBTC:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        CBBTC_USD_SVR_PRICE_FEED_ADDRESS, // cbBTC / USD price feed
        ETH_USD_SVR_PRICE_FEED_ADDRESS,   // USD / ETH price feed 
        8,                                // decimals
        'cbBTC / ETH SVR price feed',     // description
      ],
      true
    );

    return {
      cbBTCToUsdPriceFeed: cbBTCToUsdPriceFeed.address,
      cbBTCToEthPriceFeed: cbBTCToEthPriceFeed.address
    };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    {
      cbBTCToUsdPriceFeed,
      cbBTCToEthPriceFeed,
    }
  ) => {
    const trace = deploymentManager.tracer();

    const {
      bridgeReceiver,
      cbBTC,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const { governor, baseL1CrossDomainMessenger } = await govDeploymentManager.getContracts();

    newCbEthToUsdPriceFeed = cbBTCToUsdPriceFeed;
    newCbEthToEthPriceFeed = cbBTCToEthPriceFeed;

    const updateAssetPriceFeedCalldataAero = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        AERO_COMET_ADDRESS,
        cbBTC.address,
        cbBTCToUsdPriceFeed
      )
    );
    const deployAndUpgradeToCalldataAero = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, AERO_COMET_ADDRESS]
    );

    const updateAssetPriceFeedCalldataWeth = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        WETH_COMET_ADDRESS,
        cbBTC.address,
        cbBTCToEthPriceFeed
      )
    );
    const deployAndUpgradeToCalldataWeth = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, WETH_COMET_ADDRESS]
    );

    const l2ProposalDataPart1 = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address, cometAdmin.address, // AERO
          configurator.address, cometAdmin.address, // WETH
        ],
        [
          0, 0, // AERO
          0, 0, // WETH
        ],
        [
          'updateAssetPriceFeed(address,address,address)', 'deployAndUpgradeTo(address,address)', // AERO
          'updateAssetPriceFeed(address,address,address)', 'deployAndUpgradeTo(address,address)', // WETH
        ],
        [
          updateAssetPriceFeedCalldataAero, deployAndUpgradeToCalldataAero, // AERO
          updateAssetPriceFeedCalldataWeth, deployAndUpgradeToCalldataWeth, // WETH
        ],
      ]
    );

    const updateAssetPriceFeedCalldataUsdc = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        USDC_COMET_ADDRESS,
        cbBTC.address,
        cbBTCToUsdPriceFeed
      )
    );
    const deployAndUpgradeToCalldataUsdc = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDC_COMET_ADDRESS]
    );

    const updateAssetPriceFeedCalldataUsds = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        USDS_COMET_ADDRESS,
        cbBTC.address,
        cbBTCToUsdPriceFeed
      )
    );
    const deployAndUpgradeToCalldataUsds = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDS_COMET_ADDRESS]
    );

    const l2ProposalDataPart2 = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address, cometAdmin.address, // USDC
          configurator.address, cometAdmin.address, // USDS
        ],
        [
          0, 0, // USDC
          0, 0, // USDS
        ],
        [
          'updateAssetPriceFeed(address,address,address)', 'deployAndUpgradeTo(address,address)', // USDC
          'updateAssetPriceFeed(address,address,address)', 'deployAndUpgradeTo(address,address)', // USDS
        ],
        [
          updateAssetPriceFeedCalldataUsdc, deployAndUpgradeToCalldataUsdc, // USDC
          updateAssetPriceFeedCalldataUsds, deployAndUpgradeToCalldataUsds, // USDS
        ],
      ]
    );

    const aeroComet = new Contract(AERO_COMET_ADDRESS, abi, await deploymentManager.getSigner());
    const usdcComet = new Contract(USDC_COMET_ADDRESS, abi, await deploymentManager.getSigner());
    const usdsComet = new Contract(USDS_COMET_ADDRESS, abi, await deploymentManager.getSigner());
    const wethComet = new Contract(WETH_COMET_ADDRESS, abi, await deploymentManager.getSigner());

    const cbBTCAssetInfoAero = await aeroComet.getAssetInfoByAddress(cbBTC.address);
    const cbBTCAssetInfoUsdc = await usdcComet.getAssetInfoByAddress(cbBTC.address);
    const cbBTCAssetInfoUsds = await usdsComet.getAssetInfoByAddress(cbBTC.address);
    const cbBTCAssetInfoWeth = await wethComet.getAssetInfoByAddress(cbBTC.address);

    oldAeroCbBTCToUsdPriceFeed = cbBTCAssetInfoAero.priceFeed;
    oldUsdcCbBTCToUsdPriceFeed = cbBTCAssetInfoUsdc.priceFeed;
    oldUsdsCbBTCToUsdPriceFeed = cbBTCAssetInfoUsds.priceFeed;
    oldWethCbBTCToEthPriceFeed = cbBTCAssetInfoWeth.priceFeed;

    const mainnetActions = [
      // 1. Update price feed for cbBTC in AERO and WETH markets
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalDataPart1, 3_000_000]
      },
      // 2. Update price feed for cbBTC in USDC and USDS markets
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalDataPart2, 3_000_000]
      },
    ];

    const description = `# Update cbBTC price feeds on Base to SVR

## Proposal summary

This proposal updates the cbBTC price feeds in the Compound III AERO, USDC, USDS, and WETH markets on Base to use the new SVR price feeds.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1129) and [forum discussion for SVR](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).

### SVR fee recipient

SVR generates revenue from liquidators and Compound DAO will receive that revenue as part of the protocol fee. The fee recipient for SVR on Base is set to Compound DAO multisig: 0xb3e79c7cac540ca833015e63d96d3032ba0c4129.

## Proposal Actions

The first action updates the cbBTC price feeds in the AERO and WETH markets.

The second action updates the cbBTC price feeds in the USDC and USDS markets.`;

    const txn = await govDeploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 300_000
    );

    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      cbBTC,
    } = await deploymentManager.getContracts();

    const aeroComet = new Contract(AERO_COMET_ADDRESS, abi, await deploymentManager.getSigner());
    const usdcComet = new Contract(USDC_COMET_ADDRESS, abi, await deploymentManager.getSigner());
    const usdsComet = new Contract(USDS_COMET_ADDRESS, abi, await deploymentManager.getSigner());
    const wethComet = new Contract(WETH_COMET_ADDRESS, abi, await deploymentManager.getSigner());

    const cbBTCAssetInfoAero = await aeroComet.getAssetInfoByAddress(cbBTC.address);
    const cbBTCAssetInfoUsdc = await usdcComet.getAssetInfoByAddress(cbBTC.address);
    const cbBTCAssetInfoUsds = await usdsComet.getAssetInfoByAddress(cbBTC.address);
    const cbBTCAssetInfoWeth = await wethComet.getAssetInfoByAddress(cbBTC.address);

    expect(cbBTCAssetInfoAero.priceFeed).to.equal(newCbEthToUsdPriceFeed);
    expect(cbBTCAssetInfoUsdc.priceFeed).to.equal(newCbEthToUsdPriceFeed);
    expect(cbBTCAssetInfoUsds.priceFeed).to.equal(newCbEthToUsdPriceFeed);
    expect(cbBTCAssetInfoWeth.priceFeed).to.equal(newCbEthToEthPriceFeed);

    expect(cbBTCAssetInfoAero.priceFeed).to.not.equal(oldAeroCbBTCToUsdPriceFeed);
    expect(cbBTCAssetInfoUsdc.priceFeed).to.not.equal(oldUsdcCbBTCToUsdPriceFeed);
    expect(cbBTCAssetInfoUsds.priceFeed).to.not.equal(oldUsdsCbBTCToUsdPriceFeed);
    expect(cbBTCAssetInfoWeth.priceFeed).to.not.equal(oldWethCbBTCToEthPriceFeed);

    const oldPriceCbBTCToUsdAero = await aeroComet.getPrice(oldAeroCbBTCToUsdPriceFeed);
    const newPriceCbBTCToUsdAero = await aeroComet.getPrice(newCbEthToUsdPriceFeed);
    expect(oldPriceCbBTCToUsdAero).to.be.closeTo(newPriceCbBTCToUsdAero, exp(200, 8)); // within $200

    const oldPriceCbBTCToUsdUsdc = await usdcComet.getPrice(oldUsdcCbBTCToUsdPriceFeed);
    const newPriceCbBTCToUsdUsdc = await usdcComet.getPrice(newCbEthToUsdPriceFeed);
    expect(oldPriceCbBTCToUsdUsdc).to.be.closeTo(newPriceCbBTCToUsdUsdc, exp(200, 8)); // within $200

    const oldPriceCbBTCToUsdUsds = await usdsComet.getPrice(oldUsdsCbBTCToUsdPriceFeed);
    const newPriceCbBTCToUsdUsds = await usdsComet.getPrice(newCbEthToUsdPriceFeed);
    expect(oldPriceCbBTCToUsdUsds).to.be.closeTo(newPriceCbBTCToUsdUsds, exp(200, 8)); // within $200

    const oldPriceCbBTCToEthWeth = await wethComet.getPrice(oldWethCbBTCToEthPriceFeed);
    const newPriceCbBTCToEthWeth = await wethComet.getPrice(newCbEthToEthPriceFeed);
    expect(oldPriceCbBTCToEthWeth).to.be.closeTo(newPriceCbBTCToEthWeth, exp(0.094, 8)); // within 0.094 ETH ~ $200
  },
});
