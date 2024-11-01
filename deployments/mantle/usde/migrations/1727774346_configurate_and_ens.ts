import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import {
  diffState,
  getCometConfig,
} from '../../../../plugins/deployment_manager/DiffState';
import {
  calldata,
  exp,
  getConfigurationStruct,
  proposal,
} from '../../../../src/deploy';
import { expect } from 'chai';
import { utils } from 'ethers';
import { Contract } from 'ethers';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

const USDT_MAINNET = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const cUSDTAddress = '0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9';

const USDT_MANTLE = '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE';
const MANTLE_USDT_USDE_SWAP_POOL = '0x7ccD8a769d466340Fff36c6e10fFA8cf9077D988';
const MANTLE_SWAP_ROUTER = '0xAFb85a12Babfafabfe1a518594492d5a830e782a';

const COMPAmountToBridge = exp(3_600, 18);
const USDeAmountToSeed = exp(75_000, 18);

let mantleCOMP: string;

export default migration('1727774346_configurate_and_ens', {
  prepare: async () => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager
  ) => {
    const trace = deploymentManager.tracer();

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      rewards,
      COMP,
      timelock,
      USDe,
    } =
      await deploymentManager.getContracts();

    const {
      mantleL1CrossDomainMessenger,
      mantleL1StandardBridge,
      governor,
      COMP: mainnetCOMP,
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const subdomainHash = utils.namehash(ENSSubdomain);
    const baseChainId = 5000;
    const newMarketObject = {
      baseSymbol: 'USDe',
      cometAddress: comet.address,
    };
    const officialMarketsJSON = JSON.parse(
      await ENSResolver.text(subdomainHash, ENSTextRecordKey)
    );
    if (officialMarketsJSON[baseChainId]) {
      officialMarketsJSON[baseChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[baseChainId] = [newMarketObject];
    }

    const configuration = await getConfigurationStruct(deploymentManager);
    const swapRouter = new Contract(
      MANTLE_SWAP_ROUTER,
      [
        'function getSwapIn(address pair, uint128 amountOut, bool swapForY) external view returns(uint128 amountIn, uint128 amountOutLeft, uint128 fee)',
        'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, tuple(uint256[] pairBinSteps, uint8[] versions, address[] tokenPath), address to, uint256 deadline) external returns(uint256[] memory amountsIn)',
      ],
      deploymentManager.hre.ethers.provider
    );

    const amountToSwap = ((await swapRouter.getSwapIn(MANTLE_USDT_USDE_SWAP_POOL, USDeAmountToSeed * 105n / 100n, false)).amountIn).toBigInt();

    const setConfigurationCalldata = await calldata(
      configurator.populateTransaction.setConfiguration(
        comet.address,
        configuration
      )
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    const setRewardConfigCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [comet.address, COMP.address]
    );

    const approveUSDTCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [MANTLE_SWAP_ROUTER, amountToSwap]
    );

    const swapCalldata = utils.defaultAbiCoder.encode(
      ['uint256', 'uint256', 'tuple(uint256[],uint8[],address[])', 'address', 'uint256'],
      [
        USDeAmountToSeed,
        amountToSwap,
        [
          [1], // magic number to define which pool to use
          [2], // magic number to define which pool to use
          [USDT_MANTLE, USDe.address],
        ],
        comet.address,
        exp(1, 18), // deadline
      ]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          cometAdmin.address,
          rewards.address,
          USDT_MANTLE,
          MANTLE_SWAP_ROUTER,
        ],
        [
          0,
          0,
          0,
          0,
          0,
        ],
        [
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)',
          'approve(address,uint256)',
          'swapTokensForExactTokens(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)',
        ],
        [
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          setRewardConfigCalldata,
          approveUSDTCalldata,
          swapCalldata,
        ],
      ]
    );

    const _reduceReservesCalldata = utils.defaultAbiCoder.encode(
      ['uint256'],
      [amountToSwap]
    );

    const approveCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [mantleL1StandardBridge.address, amountToSwap]
    );

    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Mantle.
      {
        contract: mantleL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 2_500_000],
      },
      // 2. Get USDT reserves from cUSDT contract
      {
        target: cUSDTAddress,
        signature: '_reduceReserves(uint256)',
        calldata: _reduceReservesCalldata
      },
      // 3. Approve USDT to L1StandardBridge
      {
        target: USDT_MAINNET,
        signature: 'approve(address,uint256)',
        calldata: approveCalldata,
      },
      // 4. Bridge USDT from Ethereum to Mantle Timelock using L1StandardBridge
      {
        contract: mantleL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature:
          'depositERC20To(address,address,address,uint256,uint32,bytes)',
        args: [
          USDT_MAINNET,
          USDT_MANTLE,
          timelock.address,
          amountToSwap,
          200_000,
          '0x',
        ],
      },
      // 5. Approve Ethereum's L1StandardBridge to take Timelock's COMP (for bridging)
      {
        contract: mainnetCOMP,
        signature: 'approve(address,uint256)',
        args: [mantleL1StandardBridge.address, COMPAmountToBridge],
      },
      // 6. Bridge COMP from Ethereum to Mantle Rewards using L1StandardBridge
      {
        contract: mantleL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature:
          'depositERC20To(address,address,address,uint256,uint32,bytes)',
        args: [
          mainnetCOMP.address,
          COMP.address,
          rewards.address,
          COMPAmountToBridge,
          200_000,
          '0x',
        ],
      },
      // 7. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        ),
      },
    ];

    const description = `# Initialize cUSDEv3 on Mantle\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes deployment of Compound III to Mantle network. This proposal takes the governance steps recommended and necessary to initialize a Compound III USDe market on Mantle; upon execution, cUSDEv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/deploy-compound-iii-on-mantle-network/5774/6).\n\nFurther detailed information can be found on the corresponding [pull request](https://github.com/compound-finance/comet/pull/939), [deploy market GitHub action run](https://github.com/woof-software/comet/actions/runs/11485970843/job/31967241848) and [forum discussion](https://www.comp.xyz/t/deploy-compound-iii-on-mantle-network/5774).\n\n\n## COMP token on Mantle\n\nFor creating a COMP token we used the same approach that we used before in the first Optimism USDC deployment. It uses OptimismMintableERC20 standard. The deployment COMP [transaction](https://mantlescan.xyz/address/0x52b7D8851d6CcBC6342ba0855Be65f7B82A3F17f#internaltx). [COMP token on Mantle](https://mantlescan.xyz/address/0x52b7D8851d6CcBC6342ba0855Be65f7B82A3F17f).\n\n## Pause Guardian\n\nWe deployed Safe pauseGuardian using [clone-multisig.ts](https://github.com/woof-software/comet/blob/main/scripts/clone-multisig.ts). [Deployment transaction](https://explorer.mantle.xyz/tx/0x3ff939d38b84add47f5bca1bd731d83cc030f8f1de6147d28197361ec2dc5ea9). [Address of pauseGuardian](https://explorer.mantle.xyz/address/0x2127338F0ff71Ecc779dce407D95C7D32f7C5F45)\n\n## Proposal Actions\n\nThe first proposal action sets the Comet configuration, deploys a new Comet implementation on Mantle and swaps received USDT for USDe. This sends the encoded 'setConfiguration', 'deployAndUpgradeTo', 'transfer' and 'swap' calls across the bridge to the governance receiver on Mantle. It also calls 'setRewardConfig' on the Mantle rewards contract, to establish Mantle’s bridged version of COMP as the reward token for the deployment and set the initial supply speed to be 4 COMP/day and borrow speed to be 4 COMP/day.\n\nThe second action reduces Compound’s [cUSDT](https://etherscan.io/address/0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9) reserves and transfers it to Timelock, in order to swap it for USDe and then seed the market reserves for the cUSDEv3 Comet.\n\nThe third action approves Mantle’s [L1StandardBridge](https://etherscan.io/address/0x95fC37A27a2f68e3A647CDc081F0A89bb47c3012) to take USDT, in order to then swap it for USDe./n/nThe fourth action deposits USDT  from mainnet to the Mantle L1StandardBridge contract to bridge to Timelock which will swap it for USDe to seed the reserves.\n\nThe fifth action approves Mantle’s [L1StandardBridge](https://etherscan.io/address/0x95fC37A27a2f68e3A647CDc081F0A89bb47c3012) to take Timelock's COMP, in order to seed the rewards contract through the bridge.\n\nThe sixth action deposits 3.6K COMP from mainnet to the Mantle L1StandardBridge contract to bridge to CometRewards.\n\nThe seventh action updates the ENS TXT record 'v3-official-markets' on 'v3-additional-grants.compound-community-licenses.eth', updating the official markets JSON to include the new Mantle cUSDEv3 market.`
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(actions, description))))
    );

    const event = txn.events.find((event) => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    preMigrationBlockNumber: number
  ) {
    await deploymentManager.spider();

    const { comet, rewards, USDe } = await deploymentManager.getContracts();

    const COMP = await deploymentManager.existing(
      'COMP',
      mantleCOMP,
      'mantle',
      'contracts/ERC20.sol:ERC20'
    );

    // 1.
    const stateChanges = await diffState(
      comet,
      getCometConfig,
      preMigrationBlockNumber
    );
    expect(stateChanges).to.deep.equal({
      mETH: {
        supplyCap: exp(3000, 18)
      },
      WETH: {
        supplyCap: exp(2800, 18)
      },
      FBTC: {
        supplyCap: exp(120, 8)
      },
      baseTrackingSupplySpeed: exp(4 / 86400, 15, 18), // 46296296296
      baseTrackingBorrowSpeed: exp(4 / 86400, 15, 18), // 46296296296
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 2. & 3.
    expect(await USDe.balanceOf(comet.address)).to.be.greaterThanOrEqual(USDeAmountToSeed);

    // 4. & 5.
    expect(await COMP.balanceOf(rewards.address)).to.be.equal(exp(3_600, 18));

    // 6.
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const subdomainHash = utils.namehash(ENSSubdomain);
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
          cometAddress: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840'
        },
        {
          baseSymbol: 'wstETH',
          cometAddress: '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3',
        },
        {
          baseSymbol: 'USDS',
          cometAddress: '0x5D409e56D886231aDAf00c8775665AD0f9897b56'
        }
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
          cometAddress: '0xE36A30D249f7761327fd973001A32010b521b6Fd'
        }
      ],
      137: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0xaeB318360f27748Acb200CE616E389A6C9409a07',
        },
      ],
      5000: [
        {
          baseSymbol: 'USDe',
          cometAddress: comet.address,
        },
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
        {
          baseSymbol: 'AERO',
          cometAddress: '0x784efeB622244d2348d4F2522f8860B96fbEcE89'
        }
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
    });
  },
});
