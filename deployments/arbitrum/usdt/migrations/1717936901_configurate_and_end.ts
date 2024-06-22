
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

const USDTAmountToBridge = exp(50_000, 6);
const arbitrumCOMPAddress = '0x354A6dA3fcde098F8389cad84b0182725c6C91dE';
const mainnetUSDTAddress = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const cUSDTAddress = '0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9';

export default migration('1717936901_configurate_and_end', {
  async prepare(deploymentManager: DeploymentManager) {
    const cometFactory = await deploymentManager.deploy('cometFactory', 'CometFactory.sol', [], true);
    return { newFactoryAddress: cometFactory.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, { newFactoryAddress }) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const {
      bridgeReceiver,
      timelock: l2Timelock,
      comet,
      cometAdmin,
      configurator,
      rewards,
    } = await deploymentManager.getContracts();
    const {
      arbitrumInbox,
      arbitrumL1GatewayRouter,
      timelock,
      governor,
    } = await govDeploymentManager.getContracts();
    const refundAddress = l2Timelock.address;
    const usdtGatewayAddress = await arbitrumL1GatewayRouter.getGateway(mainnetUSDTAddress);

    const usdtGasParams = await estimateTokenBridge(
      {
        token: mainnetUSDTAddress,
        from: timelock.address,
        to: comet.address,
        amount: USDTAmountToBridge
      },
      govDeploymentManager,
      deploymentManager
    );

    const configuration = await getConfigurationStruct(deploymentManager);
    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(comet.address, newFactoryAddress)
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
    const ArbitrumChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDT', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));

    // add optimism-usdt comet (0x995E394b8B2437aC8Ce61Ee0bC610D617962B214)
    // optimism chain id is 10
    // and arbitrum-weth comet (0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486)
    // arbitrum chain id is 42161
    // if there is no usdt comet on optimism chain, add it
    if (!officialMarketsJSON[10].find(market => market.baseSymbol === 'USDT')){
      officialMarketsJSON[10].push({ baseSymbol: 'USDT', cometAddress: '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214' });
    }

    if (!officialMarketsJSON[42161].find(market => market.baseSymbol === 'WETH')) {
      officialMarketsJSON[42161].push({ baseSymbol: 'WETH', cometAddress: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486' });
    }

    if (officialMarketsJSON[ArbitrumChainId]) {
      officialMarketsJSON[ArbitrumChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[ArbitrumChainId] = [newMarketObject];
    }

    const createRetryableTicketGasParams = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: bridgeReceiver.address,
        data: l2ProposalData
      },
      deploymentManager
    );

    const _reduceReservesCalldata = utils.defaultAbiCoder.encode(
      ['uint256'],
      [USDTAmountToBridge]
    );
  
    const zeroApproveCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [usdtGatewayAddress, 0]
    );

    const approveCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [usdtGatewayAddress, USDTAmountToBridge]
    );

    const outboundTransferCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes'],
      [
        mainnetUSDTAddress,
        comet.address,
        USDTAmountToBridge,
        usdtGasParams.gasLimit,
        usdtGasParams.maxFeePerGas,
        utils.defaultAbiCoder.encode(
          ['uint256', 'bytes'],
          [usdtGasParams.maxSubmissionCost, '0x']
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
      // 2. Get USDT reserves from cUSDT contract
      {
        target: cUSDTAddress,
        signature: '_reduceReserves(uint256)',
        calldata: _reduceReservesCalldata
      },
      // 3. Reset approve of USDT from Timelock's to Gateway
      {
        target: mainnetUSDTAddress,
        signature: 'approve(address,uint256)',
        calldata: zeroApproveCalldata
      },
      // 4. Approve the USDT gateway to take Timelock's USDT for bridging
      {
        target: mainnetUSDTAddress,
        signature: 'approve(address,uint256)',
        calldata: approveCalldata
      },
      // 5. Bridge USDT from mainnet to Arbitrum Comet
      {
        target: arbitrumL1GatewayRouter.address,
        signature: 'outboundTransfer(address,address,uint256,uint256,uint256,bytes)',
        calldata: outboundTransferCalldata,
        value: usdtGasParams.deposit
      },
      // 6. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        )
      }
    ];

    const description = "# Initialize cUSDTv3 on Arbitrum\n\n## Proposal summary\n\nFranklinDAO team with advice support from WOOF Software team proposes deployment of Compound III to the Arbitrum network. This proposal takes the governance steps recommended and necessary to initialize a Compound III USDT market on Arbitrum; upon execution, cUSDTv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/launch-usdt-market-on-compound-v3-arbitrum/5004/2).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/864), [deploy market GitHub action run](https://github.com/woof-software/comet/actions/runs/9595156999) and [forum discussion](https://www.comp.xyz/t/launch-usdt-market-on-compound-v3-arbitrum/5004).\n\n\n## Proposal Actions\n\nThe first proposal action sets the Comet configuration and deploys a new Comet implementation on Arbitrum. This sends the encoded `setFactory`, `setConfiguration`, `deployAndUpgradeTo` calls across the bridge to the governance receiver on Arbitrum. It also calls `setRewardConfig` on the Arbitrum rewards contract, to establish Artitrum’s bridged version of COMP as the reward token for the deployment and set the initial supply speed to be 12 COMP/day and borrow speed to be 10 COMP/day.\n\nThe second action reduces Compound’s [cUSDT](https://etherscan.io/address/0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9) reserves and transfers it to Timelock, in order to seed the market reserves for the cUSDTv3 Comet.\n\nThe third action approves 0 USDT from Timelock to [ArbitrumL1CustomGateway](https://etherscan.io/address/0xcEe284F754E854890e311e3280b767F80797180d) to reset potential previous approves.\n\nThe fourth action approves 50K USDT to [ArbitrumL1CustomGateway](https://etherscan.io/address/0xcEe284F754E854890e311e3280b767F80797180d) to take Timelock's USDT on Mainnet, in order to seed the market reserves through the [ArbitrumL1GatewayRouter](https://etherscan.io/address/0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef).\n\nThe fifth action bridges USDT from mainnet via ‘outboundTransfer’ function on ArbitrumL1GatewayRouter’s contract and sends it to Comet on Arbitrum.\n\nThe sixth action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Arbitrum cUSDTv3 market.";
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

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const ethers = deploymentManager.hre.ethers;

    const {
      comet,
      rewards,
      ARB,
      WETH,
      wstETH,
      WBTC,
      GMX
    } = await deploymentManager.getContracts();

    const {
      timelock
    } = await govDeploymentManager.getContracts();

    // 1.
    const ARBInfo = await comet.getAssetInfoByAddress(ARB.address);
    const WETHInfo = await comet.getAssetInfoByAddress(WETH.address);
    const wstETHInfo = await comet.getAssetInfoByAddress(wstETH.address);
    const WBTCInfo = await comet.getAssetInfoByAddress(WBTC.address);
    const GMXInfo = await comet.getAssetInfoByAddress(GMX.address);

    // check suplly caps
    expect(await ARBInfo.supplyCap).to.be.eq(exp(7_500_000, 18));
    expect(await WETHInfo.supplyCap).to.be.eq(exp(7_500, 18));
    expect(await wstETHInfo.supplyCap).to.be.eq(exp(1_500, 18));
    expect(await WBTCInfo.supplyCap).to.be.eq(exp(250, 8));
    expect(await GMXInfo.supplyCap).to.be.eq(exp(100_000, 18));

    expect(await comet.pauseGuardian()).to.be.eq('0x78E6317DD6D43DdbDa00Dce32C2CbaFc99361a9d');

    // 2. & 3. & 4. & 5.
    expect(await comet.getReserves()).to.be.equal(USDTAmountToBridge);

    // 6.
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
          cometAddress: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486',
        },
        {
          baseSymbol: 'USDT',
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
        {
          baseSymbol: 'USDT',
          cometAddress: '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214',
        },
      ],
    });

    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(12 / 86400, 15, 18)); // 138888888888
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(exp(10 / 86400, 15, 18)); // 115740740740
  }
});