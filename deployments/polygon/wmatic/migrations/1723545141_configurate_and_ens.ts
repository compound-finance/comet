import { Contract, ethers } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getBlock, getConfigurationStruct, proposal } from '../../../../src/deploy';
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
const mainnetMATICAddress = '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0'
const polygonCOMPAddress = '0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c';
const cUSDTAddress = '0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9';

const uniswapRouterV2Address = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

const USDTAmountToSwap = ethers.BigNumber.from(exp(10_000, 6));
let MATICAmountToWrap;

export default migration('1723545141_configurate_and_ens', {
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
      WMATIC,
      localTimelock
    } = await deploymentManager.getContracts();

    const {
      fxRoot,
      timelock,
      governor
    } = await govDeploymentManager.getContracts();

    const uniswapRouterV2 = new Contract(
      uniswapRouterV2Address,
      [
        'function swapExactTokensForTokens(uint amountIn,uint amountOutMin,address[] calldata path,address to,uint deadline) external returns (uint[] memory amounts)',
        'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
      ],
      govDeploymentManager.hre.ethers.provider
    );

    MATICAmountToWrap = (await uniswapRouterV2.getAmountsOut(USDTAmountToSwap, [mainnetUSDTAddress, mainnetMATICAddress]))[1]

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

    // Note: There is no way to directly bridge WMATIC, so we have to bridge MATIC to the Timelock, wrap it, then transfer it to Comet
    const transferWMATICCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [comet.address, MATICAmountToWrap]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, configurator.address, cometAdmin.address, rewards.address, WMATIC.address, WMATIC.address],
        [0, 0, 0, 0, MATICAmountToWrap, 0],
        [
          'setFactory(address,address)',
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)',
          'deposit()',
          'transfer(address,uint256)'
        ],
        [setFactoryCalldata, setConfigurationCalldata, deployAndUpgradeToCalldata, setRewardConfigCalldata, '0x', transferWMATICCalldata]
      ]
    );

    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const polygonChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'WMATIC', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));

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

    const depositMATICData = utils.defaultAbiCoder.encode(['uint256'], [MATICAmountToWrap]);
    const depositForMATICCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'bytes'],
      [localTimelock.address, mainnetMATICAddress, depositMATICData]
    );

    const notEnoughUSDT = (await USDTMainnet.balanceOf(timelock.address)).lt(USDTAmountToSwap);
    const amountToSupply = notEnoughUSDT ? ethers.BigNumber.from(USDTAmountToSwap).sub(await USDTMainnet.balanceOf(timelock.address)) : 0;
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
      // 3. Approve Uniswap Router to take Timelock's USDT (for swapping)
      {
        contract: mainnetUSDTAddress,
        signature: 'approve(address,uint256)',
        args: [uniswapRouterV2Address, USDTAmountToSwap]
      },
      // 4. Swap USDT for MATIC
      {
        contract: uniswapRouterV2Address,
        signature: 'swapExactTokensForTokens(uint amountIn,uint amountOutMin,address[] calldata path,address to,uint deadline)',
        args: [USDTAmountToSwap, MATICAmountToWrap, [mainnetUSDTAddress, mainnetMATICAddress], timelock.address, (await getBlock()).timestamp]
      },
      // 5. Approve Polygon's ERC20Predicate to take Timelock's MATIC (for bridging)
      {
        contract: mainnetMATICAddress,
        signature: 'approve(address,uint256)',
        args: [ERC20PredicateAddress, MATICAmountToWrap]
      },
      // 6. Bridge MATIC from mainnet to Polygon using RootChainManager
      {
        target: RootChainManager.address,
        signature: 'depositFor(address,address,bytes)',
        calldata: depositForMATICCalldata
      },
      // 7. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        )
      }
    ];

    const description = "# Initialize cWMATICv3 on Polygon\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes the deployment of Compound III to the Polygon network. This proposal takes the governance steps recommended and necessary to initialize a Compound III WMATIC market on Polygon; upon execution, cWMATICv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-matic-market-on-the-matic-network/5159/5).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/906), [market deployment action](https://github.com/woof-software/comet/actions/runs/9627561011) and [forum discussion](https://www.comp.xyz/t/add-matic-market-on-the-matic-network/5159).\n\n\n## Proposal Actions\n\nThe first proposal action sets the Comet configuration and deploys a new Comet implementation on Polygon. This sends the encoded `setFactory`, `setConfiguration` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Polygon. It also calls `setRewardConfig` on the Polygon rewards contract, to establish Polygon’s bridged version of COMP as the reward token for the deployment and set the initial supply speed to be 3 COMP/day and borrow speed to be 0 COMP/day.\n\nThe second action reduces Compound [cUSDT](https://etherscan.io/address/0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9) reserves to Timelock, in order to seed the market reserves through the Polygon RootChainManager.\n\nThe third action approves Polygon’s [RootChainManager](https://etherscan.io/address/0xA0c68C638235ee32657e8f720a23ceC1bFc77C77) to take Timelock's USDT, in order to seed the reserves through the bridge.\n\nThe fourth action deposits 10K USDT from mainnet to the Polygon RootChainManager contract to bridge to Comet.\n\nThe fifth action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Polygon cWMATICv3 market.";
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
      COMP
    } = await deploymentManager.getContracts();

    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      MaticX: {
        supplyCap: exp(0, 18),
      },
      baseTrackingSupplySpeed: exp(0),
      baseTrackingBorrowSpeed: exp(0),
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    expect(await comet.getReserves()).to.be.equal(MATICAmountToWrap);

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
        {
          baseSymbol: 'USDT',
          cometAddress: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840',
        },
      ],
      137: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
        },
        {
          baseSymbol: 'USDT',
          cometAddress: "0xaeB318360f27748Acb200CE616E389A6C9409a07",
        },
        {
          baseSymbol: 'WMATIC',
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
        {
          baseSymbol: 'WETH',
          cometAddress: '0xE36A30D249f7761327fd973001A32010b521b6Fd',
        },
      ],
    });
  }
});
