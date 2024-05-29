import { Contract, ethers } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';
import { applyL1ToL2Alias, estimateL2Transaction, estimateTokenBridge } from '../../../../scenario/utils/arbitrumUtils';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

const WETHAmountToBridge = ethers.BigNumber.from(exp(500, 18));
const arbitrumCOMPAddress = '0x354A6dA3fcde098F8389cad84b0182725c6C91dE';

export default migration('1713517203_configurate_and_ens', {
  prepare: async (_deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const cometFactory = await deploymentManager.fromDep('cometFactory', 'arbitrum', 'usdc.e');
    const {
      bridgeReceiver,
      timelock: l2Timelock,
      comet,
      cometAdmin,
      configurator,
      rewards
    } = await deploymentManager.getContracts();
    const {
      arbitrumInbox,
      arbitrumL1GatewayRouter,
      timelock,
      governor,
      WETH,
      COMP
    } = await govDeploymentManager.getContracts();
    const refundAddress = l2Timelock.address;
    const wethGatewayAddress = await arbitrumL1GatewayRouter.getGateway(WETH.address);

    const wethGasParams = await estimateTokenBridge(
      {
        token: COMP.address,
        from: timelock.address,
        to: comet.address,
        amount: WETHAmountToBridge.toBigInt()
      },
      govDeploymentManager,
      deploymentManager
    );

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
      [comet.address, arbitrumCOMPAddress]
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
        [
          setFactoryCalldata,
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          setRewardConfigCalldata
        ]
      ]
    );

    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const polygonChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'WETH', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));

    if (officialMarketsJSON[polygonChainId]) {
      officialMarketsJSON[polygonChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[polygonChainId] = [newMarketObject];
    }

    const createRetryableTicketGasParams = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: bridgeReceiver.address,
        data: l2ProposalData
      },
      deploymentManager
    );

    const outboundTransferCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes'],
      [
        WETH.address,
        comet.address,
        WETHAmountToBridge.toBigInt(),
        wethGasParams.gasLimit,
        wethGasParams.maxFeePerGas,
        utils.defaultAbiCoder.encode(
          ['uint256', 'bytes'],
          [wethGasParams.maxSubmissionCost, '0x']
        )
      ]
    );

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Arbitrum.
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          bridgeReceiver.address,                           // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams.maxSubmissionCost, // uint256 maxSubmissionCost,
          refundAddress,                                    // address excessFeeRefundAddress,
          refundAddress,                                    // address callValueRefundAddress,
          createRetryableTicketGasParams.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams.maxFeePerGas,      // uint256 maxFeePerGas,
          l2ProposalData,                                   // bytes calldata data
        ],
        value: createRetryableTicketGasParams.deposit
      },
      // 2. Wrap some ETH as WETH
      {
        contract: WETH,
        signature: 'deposit()',
        args: [],
        value: WETHAmountToBridge,
      },
      // 2. Approve the WETH gateway to take Timelock's WETH for bridging
      {
        contract: WETH,
        signature: 'approve(address,uint256)',
        args: [wethGatewayAddress, WETHAmountToBridge]
      },
      // 3. Bridge WETH from mainnet to Arbitrum Comet
      {
        target: arbitrumL1GatewayRouter.address,
        signature: 'outboundTransfer(address,address,uint256,uint256,uint256,bytes)',
        calldata: outboundTransferCalldata,
        value: wethGasParams.deposit
      },
      // 4. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        )
      }
    ];

    const description = "# Initialize cUSDCv3 on Polygon\n\nThis proposal takes the governance steps recommended and necessary to initialize a Compound III USDC market on Polygon; upon execution, cUSDCv3 will be ready for use. Simulations have confirmed the market\u2019s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). Although real tests have also been run over the Goerli/Mumbai bridge, this will be the first proposal to actually bridge from Ethereum mainnet to another chain, and therefore includes risks not present in previous proposals.\n\nAlthough the proposal sets the entire configuration in the Configurator, the initial deployment already has most of these same parameters already set. The new parameters include setting the pause guardian to a Gnosis [multisig](https://app.safe.global/matic:0x8Ab717CAC3CbC4934E63825B88442F5810aAF6e5/home), which has been created on Polygon to match the same set of signers as currently on Ethereum mainnet. They also include risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/initialize-compound-iii-usdc-on-polygon-pos/3611/12). Finally, the parameters include a modest reallocation of some of the v2 USDT COMP rewards to borrowers in the new market.\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/672) and [forum discussion](https://www.comp.xyz/t/initialize-compound-iii-usdc-on-polygon-pos/3611/11).\n\n\n## Proposal Actions\n\nThe first proposal action sets the Comet configuration and deploys a new Comet implementation on Polygon. This sends the encoded `setConfiguration` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Polygon.\n\nThe second action approves Polygon's ERC20Predicate to take Timelock's USDC, in order to seed the market reserves through the bridge.\n\nThe third action deposits USDC from mainnet to the Polygon RootChainManager contract to bridge to Comet.\n\nThe fourth action approves Polygon's ERC20Predicate to take Timelock's COMP, in order to seed the rewards contract through the bridge.\n\nThe fifth action deposits COMP from mainnet to the Polygon RootChainManager contract to bridge to CometRewards. \n\nThe sixth action sets up the ENS subdomain `v3-additional-grants.compound-community-licenses.eth`,  with the Timelock as the owner.\n\nThe seventh action writes the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, containing the official markets JSON.\n\nThe eighth action migrates the COMP distribution for v2 cUSDT suppliers, so as to keep the total COMP distribution constant.\n";
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const ethers = deploymentManager.hre.ethers;

    const {
      comet,
      rewards,
      WETH,
      wstETH,
      rETH
    } = await deploymentManager.getContracts();

    const {
      timelock
    } = await govDeploymentManager.getContracts();

    // 1.
    const wstETHInfo = await comet.getAssetInfoByAddress(wstETH.address);
    const rETHInfo = await comet.getAssetInfoByAddress(rETH.address);
    // expect(wstETHInfo.supplyCap).to.be.eq(exp(400, 8));
    // expect(rETHInfo.supplyCap).to.be.eq(exp(10_000_000, 18));
    expect(await comet.pauseGuardian()).to.be.eq('0x78E6317DD6D43DdbDa00Dce32C2CbaFc99361a9d');

    // 2. & 3.
    expect(await comet.getReserves()).to.be.equal(WETHAmountToBridge);

    // 4. & 5.
    const arbitrumCOMP = new Contract(
      arbitrumCOMPAddress,
      ['function balanceOf(address account) external view returns (uint256)'],
      deploymentManager.hre.ethers.provider
    );
    expect((await arbitrumCOMP.balanceOf(rewards.address)).gt(exp(2_000, 18))).to.be.true;
    // 6. & 7.
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const ENSRegistry = await govDeploymentManager.existing('ENSRegistry', ENSRegistryAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);
    expect(await ENSRegistry.recordExists(subdomainHash)).to.be.equal(true);
    expect(await ENSRegistry.owner(subdomainHash)).to.be.equal(timelock.address);
    expect(await ENSRegistry.resolver(subdomainHash)).to.be.equal(ENSResolverAddress);
    expect(await ENSRegistry.ttl(subdomainHash)).to.be.equal(0);
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
        // should be changed after soon to be PR
        // {
        //   baseSymbol: 'WETH',
        //   cometAddress: comet.address,
        // },
      ],
      137: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
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
          cometAddress: comet.address,
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
      ],
    });

    // 8.
    // expect(await comet.baseTrackingSupplySpeed()).to.be.equal(0);
    // expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(exp(34.74 / 86400, 15, 18));
  }
});