import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';

const SECONDS_PER_YEAR = 31_536_000n;
const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const baseCOMPAddress = '0x9e1028F5F1D5eDE59748FFceE5532509976840E0';
const amountETHToWrap = exp(10, 18);

const cUSDCAddress = '0x39AA39c021dfbaE8faC545936693aC917d5E7563';

export default migration('1689893694_configurate_and_ens', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const cometFactory = await deploymentManager.fromDep('cometFactory', 'base', 'usdbc');
    const {
      bridgeReceiver,
      timelock: localTimelock,
      comet,
      cometAdmin,
      configurator,
      rewards,
      WETH
    } = await deploymentManager.getContracts();

    const {
      baseL1CrossDomainMessenger,
      baseL1StandardBridge,
      governor,
      comptrollerV2
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const baseChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'WETH', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));
    if (officialMarketsJSON[baseChainId]) {
      officialMarketsJSON[baseChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[baseChainId] = [newMarketObject];
    }

    const configuration = await getConfigurationStruct(deploymentManager);
    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(comet.address, cometFactory.address)
    );
    const setConfigurationCalldata = await calldata(
      configurator.populateTransaction.setConfiguration(comet.address, configuration)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    const setRewardConfigCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [comet.address, baseCOMPAddress]
    );
    // Note: There is no way to directly bridge WETH, so we have to bridge ETH to the Timelock, wrap it, then transfer it to Comet
    const transferWETHCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [comet.address, amountETHToWrap]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, configurator.address, cometAdmin.address, rewards.address, WETH.address, WETH.address],
        [0, 0, 0, 0, amountETHToWrap, 0],
        [
          'setFactory(address,address)',
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)',
          'deposit()',
          'transfer(address,uint256)'
        ],
        [setFactoryCalldata, setConfigurationCalldata, deployAndUpgradeToCalldata, setRewardConfigCalldata, '0x', transferWETHCalldata]
      ]
    );

    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet, set reward config on Base, wrap ETH to WETH and transfer to Comet as reserves.
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },

      // 2. Bridge ETH to the L2 timelock
      {
        contract: baseL1StandardBridge,
        value: amountETHToWrap,
        signature: 'depositETHTo(address,uint32,bytes)',
        args: [localTimelock.address, 200_000, '0x']
      },

      // 3. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        )
      },

      // 4. Displace v2 USDC COMP rewards
      {
        contract: comptrollerV2,
        signature: '_setCompSpeeds(address[],uint256[],uint256[])',
        args: [
          [cUSDCAddress],
          [9194444444444444n],
          [12666666666666667n]
        ],
      },
    ];

    const description = "# Initialize cWETHv3 on Base\n\nThis proposal takes the governance steps recommended and necessary to initialize a Compound III WETH market on Base; upon execution, cWETHv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).\n\nAlthough the proposal sets the entire configuration in the Configurator, the initial deployment already has most of these same parameters already set. The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet for Base](https://www.comp.xyz/t/deploy-compound-iii-on-base/4402/2) as well as their [latest recommendations for the WETH market](https://www.comp.xyz/t/gauntlet-recommendations-ethereum-compound-v3-eth-risk-parameter-ir-curve-incentive-changes-8-4-23/4565). Finally, the parameters include a modest reallocation of some of the v2 USDC borrow-side COMP incentives to users in the new market.\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/794) and [forum discussion](https://www.comp.xyz/t/deploy-compound-iii-on-base/4402).\n\n\n## Proposal Actions\n\nThe first proposal action sends a cross-chain message to Base, triggering a series of actions. These actions are to set the CometFactory for the new Comet, set the Comet configuration, deploy a new Comet implementation, set COMP as the reward token for the deployment, wrap some ETH to WETH, and transfer WETH to the cWETHv3 contract as initial reserves. The initial supply speed will be 20 COMP/day and borrow speed will be 0 COMP/day.\n\nThe second action bridges 10 ETH from the mainnet Timelock to the Base Timelock, to be wrapped as WETH and seeded as initial reserves to the cWETHv3 market.\n\nThe third action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Base cUSDbCv3 market.\n\nThe fourth action reduces the COMP distribution to v2 cUSDC borrowers by 20 COMP/day, so as to keep the total COMP distribution constant.";
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, preMigrationBlockNumber: number) {
    const ethers = deploymentManager.hre.ethers;
    await deploymentManager.spider(); // We spider here to pull in Base COMP now that reward config has been set

    const {
      comet,
      rewards,
      COMP,
      WETH
    } = await deploymentManager.getContracts();

    const {
      comptrollerV2,
    } = await govDeploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      baseTrackingSupplySpeed: exp(20 / 86400, 15, 18),
      storeFrontPriceFactor: exp(1, 18),
      borrowPerSecondInterestRateSlopeLow: exp(0.037, 18) / SECONDS_PER_YEAR,
      cbETH: {
        liquidationFactor: exp(0.975, 18),
        supplyCap: exp(7500, 18)
      }
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 1. & 2.
    expect(await comet.getReserves()).to.be.equal(amountETHToWrap);
    expect(await WETH.balanceOf(comet.address)).to.be.equal(amountETHToWrap);

    // 3.
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);

    expect(officialMarkets).to.deep.equal({
      1: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0xA17581A9E3356d9A858b789D68B4d866e593aE94',
        },
      ],
      137: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
        },
      ],
      42161: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
        }
      ],
      8453: [
        {
          baseSymbol: 'USDbC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
        },
        {
          baseSymbol: 'WETH',
          cometAddress: comet.address,
        },
      ],
    });

    // 4.
    expect(await comptrollerV2.compSupplySpeeds(cUSDCAddress)).to.be.equal(9194444444444444n);  // 66.2 COMP/day
    expect(await comptrollerV2.compBorrowSpeeds(cUSDCAddress)).to.be.equal(12666666666666667n); // 91.2 COMP/day
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(20 / 86400, 15, 18));
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(exp(0 / 86400, 15, 18));
  }
});