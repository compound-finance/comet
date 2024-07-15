import { Contract, ethers } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

const ERC20PredicateAddress = '0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf';
const RootChainManagerAddress = '0xA0c68C638235ee32657e8f720a23ceC1bFc77C77';

const mainnetUSDTAddress = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const polygonCOMPAddress = '0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c';
const cUSDTAddress = '0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9';

const USDTAmountToBridge = ethers.BigNumber.from(exp(10_000, 6));

export default migration('1713283675_configurate_and_ens', {
  prepare: async (_deploymentManager: DeploymentManager) => {
    return {};
  },
  
  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const cometFactory = await deploymentManager.fromDep('cometFactory', 'polygon', 'usdc');
    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      rewards,
      USDT,
      WBTC,
      WETH,
      WMATIC
    } = await deploymentManager.getContracts();

    const {
      fxRoot,
      timelock,
      governor
    } = await govDeploymentManager.getContracts();
    
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
      [comet.address, polygonCOMPAddress]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, configurator.address, cometAdmin.address, rewards.address],
        [0, 0, 0, 0],
        [
          'setFactory(address,address)',
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)'
        ],
        [setFactoryCalldata, setConfigurationCalldata, deployAndUpgradeToCalldata, setRewardConfigCalldata]
      ]
    );

    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const polygonChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDT', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));

    // add arbitrum-usdt comet (0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07)
    // arbitrum chain id is 42161
    if (!(officialMarketsJSON[42161].find(market => market.baseSymbol === 'USDT'))) {
      officialMarketsJSON[42161].push({ baseSymbol: 'USDT', cometAddress: '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07' });
    }

    // add arbitrum-weth comet (0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486)
    // arbitrum chain id is 42161
    if (!(officialMarketsJSON[42161].find(market => market.baseSymbol === 'WETH'))) {
      officialMarketsJSON[42161].push({ baseSymbol: 'WETH', cometAddress: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486' });
    }

    // add optimism-usdt comet (0x995E394b8B2437aC8Ce61Ee0bC610D617962B214)
    // optimism chain id is 10
    if (!(officialMarketsJSON[10].find(market => market.baseSymbol === 'USDT'))) {
      officialMarketsJSON[10].push({ baseSymbol: 'USDT', cometAddress: '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214' });
    }

    if (officialMarketsJSON[polygonChainId]) {
      officialMarketsJSON[polygonChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[polygonChainId] = [newMarketObject];
    }

    const RootChainManager = await deploymentManager.existing(
      'RootChainManager',
      RootChainManagerAddress
    );
    const USDTMainnet = new Contract(
      mainnetUSDTAddress,
      [
        'function balanceOf(address account) external view returns (uint256)',
        'function approve(address,uint256) external'        
      ],
      govDeploymentManager.hre.ethers.provider
    );

    const depositUSDTData = utils.defaultAbiCoder.encode(['uint256'], [USDTAmountToBridge]);
    const depositForUSDTCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'bytes'],
      [comet.address, USDTMainnet.address, depositUSDTData]
    );
    const notEnoughUSDT = (await USDTMainnet.balanceOf(timelock.address)).lt(USDTAmountToBridge);
    const amountToSupply = notEnoughUSDT ? ethers.BigNumber.from(USDTAmountToBridge).sub(await USDTMainnet.balanceOf(timelock.address)) : 0;
    const _reduceReservesCalldata = utils.defaultAbiCoder.encode(
      ['uint256'],
      [amountToSupply]
    );

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Polygon.
      {
        contract: fxRoot,
        signature: 'sendMessageToChild(address,bytes)',
        args: [bridgeReceiver.address, l2ProposalData]
      },
      // 2. Get USDT reserves from cUSDT contract
      {
        target: cUSDTAddress,
        signature: '_reduceReserves(uint256)',
        calldata: _reduceReservesCalldata
      },
      // 3. Approve Polygon's ERC20Predicate to take Timelock's USDT (for bridging)
      {
        contract: USDTMainnet,
        signature: 'approve(address,uint256)',
        args: [ERC20PredicateAddress, USDTAmountToBridge]
      },
      // 4. Bridge USDT from mainnet to Polygon Comet using RootChainManager
      {
        target: RootChainManager.address,
        signature: 'depositFor(address,address,bytes)',
        calldata: depositForUSDTCalldata
      },
      // 5. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        )
      }
    ];

    const description = "# Initialize cUSDTv3 on Polygon\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes the deployment of Compound III to the Polygon network. This proposal takes the governance steps recommended and necessary to initialize a Compound III USDT market on Polygon; upon execution, cUSDTv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-market-usdt-on-polygon/5190/3).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/858), [market deployment action](https://github.com/woof-software/comet/actions/runs/9627561011) and [forum discussion](https://www.comp.xyz/t/add-market-usdt-on-polygon/5190).\n\n\n## Proposal Actions\n\nThe first proposal action sets the Comet configuration and deploys a new Comet implementation on Polygon. This sends the encoded `setFactory`, `setConfiguration` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Polygon. It also calls `setRewardConfig` on the Polygon rewards contract, to establish Polygon’s bridged version of COMP as the reward token for the deployment and set the initial supply speed to be 8 COMP/day and borrow speed to be 4 COMP/day.\n\nThe second action reduces Compound [cUSDT](https://etherscan.io/address/0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9) reserves to Timelock, in order to seed the market reserves through the Polygon RootChainManager.\n\nThe third action approves Polygon’s [RootChainManager](https://etherscan.io/address/0xA0c68C638235ee32657e8f720a23ceC1bFc77C77) to take Timelock's USDT, in order to seed the reserves through the bridge.\n\nThe fourth action deposits 10K USDT from mainnet to the Polygon RootChainManager contract to bridge to Comet.\n\nThe fifth action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Polygon cUSDTv3 market.";
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
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

    const {
      comet,
      rewards,
      WMATIC,
      WETH,
      MaticX,
      stMATIC,
      WBTC,
      COMP
    } = await deploymentManager.getContracts();

    const {
      timelock
    } = await govDeploymentManager.getContracts();

    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      WMATIC: {
        supplyCap: exp(5_000_000, 18)
      },
      WETH: {
        supplyCap: exp(2_000, 18)
      },
      MaticX: {
        supplyCap: exp(2_600_000, 18),
      },
      stMATIC: {
        supplyCap: exp(1_500_000, 18)
      },
      WBTC: {
        supplyCap: exp(90, 8)
      },
      baseTrackingSupplySpeed: exp(8 / 86400, 15, 18), 
      baseTrackingBorrowSpeed: exp(4 / 86400, 15, 18),
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 2. & 3 & 4.
    expect(await comet.getReserves()).to.be.equal(USDTAmountToBridge);

    // 5.
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(
      subdomainHash,
      ENSTextRecordKey
    );
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
        {
          baseSymbol: 'USDT',
          cometAddress: comet.address,
        }
      ],
      8453: [
        {
          baseSymbol: 'USDbC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x46e6b214b524310239732D51387075E0e70970bf',
        },
        {
          baseSymbol: 'USDC',
          cometAddress: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
        },
      ],
      42161: [
        {
          baseSymbol: 'USDC.e',
          cometAddress: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
        },
        {
          baseSymbol: 'USDC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486',
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07',
        },
      ],
      534352: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44',
        },
      ],
      10: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x2e44e174f7D53F0212823acC11C01A11d58c5bCB',
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214',
        },
      ],
    });
  }
});
