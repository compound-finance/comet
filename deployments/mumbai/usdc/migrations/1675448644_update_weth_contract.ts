import { Contract } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { exp, wait } from '../../../../test/helpers';
import {expect} from 'chai';

interface Vars {
  newWETH: Contract;
}

const WETH_PRICE_FEED = '0x0715A7794a1dc8e42615F059dD6e406A6594651A';
const PROPOSED_WETH_ASSET_INFO = {
  priceFeed: WETH_PRICE_FEED,
  decimals: 18,
  borrowCollateralFactor: exp(0.82, 18),
  liquidateCollateralFactor: exp(0.85, 18),
  liquidationFactor: exp(0.93, 18),
  supplyCap: exp(1_000_000, 18)
};

export default migration('1675448644_update_weth_contract', {
  prepare: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const signer = await deploymentManager.getSigner();

    // Deploy new WETH
    const WETH = await deploymentManager.clone(
      'WETH',
      '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      [signer.address],
      'polygon',
      true // force deploy to replace existing WETH contract
    );

    const fauceteer = await deploymentManager.getContractOrThrow('fauceteer');

    trace(`Attempting to mint as ${signer.address}...`);

    await deploymentManager.idempotent(
      async () => (await WETH.balanceOf(fauceteer.address)).eq(0),
      async () => {
        trace(`Minting 10_000 WETH to fauceteer`);
        const amount = ethers.utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(10_000, await WETH.decimals())]
        );
        trace(await wait(WETH.connect(signer).deposit(fauceteer.address, amount)));
        trace(`WETH.balanceOf(${fauceteer.address}): ${await WETH.balanceOf(fauceteer.address)}`);
      }
    );

    return { newWETH: WETH };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    governanceDeploymentManager: DeploymentManager,
    vars: Vars
  ) => {
    const trace = governanceDeploymentManager.tracer();
    const ethers = governanceDeploymentManager.hre.ethers;
    const { utils } = ethers;

    const { governor, fxRoot } = await governanceDeploymentManager.getContracts();

    const {
      bridgeReceiver,
      comet,
      configurator,
      cometAdmin
    } = await deploymentManager.getContracts();

    const wethAssetConfig = {
      asset: vars.newWETH.address,
      ...PROPOSED_WETH_ASSET_INFO
    };

    // 1. Add WETH in Configurator
    // 2. Deploy and upgrade to a new version of Comet
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          await calldata(configurator.populateTransaction.addAsset(comet.address, wethAssetConfig)),
          await calldata(
            cometAdmin.populateTransaction.deployAndUpgradeTo(configurator.address, comet.address)
          )
        ]
      ]
    );

    const mainnetActions = [
      {
        contract: fxRoot,
        signature: 'sendMessageToChild(address,bytes)',
        args: [bridgeReceiver.address, l2ProposalData]
      }
    ];

    const description = '# Add new WETH to Mumbai';
    const txn = await governanceDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      configurator,
      fauceteer,
      WETH
    } = await deploymentManager.getContracts();
    const wethAssetIndex = 4;
    const wethAssetConfig = {
      asset: WETH.address,
      ...PROPOSED_WETH_ASSET_INFO
    };

    // 1. Compare proposed asset config with Comet asset info
    const cometWETHAssetInfo = await comet.getAssetInfo(wethAssetIndex);
    expect(wethAssetConfig.asset).to.be.equal(cometWETHAssetInfo.asset);
    expect(wethAssetConfig.priceFeed).to.be.equal(cometWETHAssetInfo.priceFeed);
    expect(exp(1, wethAssetConfig.decimals)).to.be.equal(cometWETHAssetInfo.scale);
    expect(wethAssetConfig.borrowCollateralFactor).to.be.equal(cometWETHAssetInfo.borrowCollateralFactor);
    expect(wethAssetConfig.liquidateCollateralFactor).to.be.equal(cometWETHAssetInfo.liquidateCollateralFactor);
    expect(wethAssetConfig.liquidationFactor).to.be.equal(cometWETHAssetInfo.liquidationFactor);
    expect(wethAssetConfig.supplyCap).to.be.equal(cometWETHAssetInfo.supplyCap);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorWETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[wethAssetIndex];
    expect(wethAssetConfig.asset).to.be.equal(configuratorWETHAssetConfig.asset);
    expect(wethAssetConfig.priceFeed).to.be.equal(configuratorWETHAssetConfig.priceFeed);
    expect(wethAssetConfig.decimals).to.be.equal(configuratorWETHAssetConfig.decimals);
    expect(wethAssetConfig.borrowCollateralFactor).to.be.equal(configuratorWETHAssetConfig.borrowCollateralFactor);
    expect(wethAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorWETHAssetConfig.liquidateCollateralFactor);
    expect(wethAssetConfig.liquidationFactor).to.be.equal(configuratorWETHAssetConfig.liquidationFactor);
    expect(wethAssetConfig.supplyCap).to.be.equal(configuratorWETHAssetConfig.supplyCap);

    // 3. Expect that the Fauceteer has received 10M WETH
    expect(await WETH.balanceOf(fauceteer.address)).to.be.equal(exp(10_000, 18));
  },
});
