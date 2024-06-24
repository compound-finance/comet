import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { Contract, ethers } from 'ethers';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import {
  calldata,
  exp,
  getConfigurationStruct,
  proposal,
} from '../../../../src/deploy';
import { expect } from 'chai';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const opCOMPAddress = '0x7e7d4467112689329f7E06571eD0E8CbAd4910eE';

const wethAmountToBridge = exp(500, 18);

export default migration('1713012100_configurate_and_ens', {
  async prepare(deploymentManager: DeploymentManager) {
    const cometFactory = await deploymentManager.deploy('cometFactory', 'CometFactory.sol', [], true);
    return { newFactoryAddress: cometFactory.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, { newFactoryAddress }) => {
    const trace = deploymentManager.tracer();
    const { utils } = ethers;

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
      opL1CrossDomainMessenger,
      opL1StandardBridge,
      governor
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const opChainId = (
      await deploymentManager.hre.ethers.provider.getNetwork()
    ).chainId.toString();
    const newMarketObject = { baseSymbol: 'WETH', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(
      await ENSResolver.text(subdomainHash, ENSTextRecordKey)
    );

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

    // add polygon-usdt comet (0xaeB318360f27748Acb200CE616E389A6C9409a07)
    // optimism chain id is 137
    if (!(officialMarketsJSON[137].find(market => market.baseSymbol === 'USDT'))) {
      officialMarketsJSON[137].push({ baseSymbol: 'USDT', cometAddress: '0xaeB318360f27748Acb200CE616E389A6C9409a07' });
    }

    if (officialMarketsJSON[opChainId]) {
      officialMarketsJSON[opChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[opChainId] = [newMarketObject];
    }

    const configuration = await getConfigurationStruct(deploymentManager);
    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(
        comet.address,
        newFactoryAddress
      )
    );
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
      [comet.address, opCOMPAddress]
    );

    // wrap and transfer eth to comet on optimism to save on gas
    const depositCalldata = await calldata(WETH.populateTransaction.deposit());
    const transferCalldata = await calldata(WETH.populateTransaction.transfer(comet.address, wethAmountToBridge));

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          configurator.address,
          cometAdmin.address,
          rewards.address,
          WETH.address,
          WETH.address
        ],
        [0, 0, 0, 0, wethAmountToBridge, 0],
        [
          'setFactory(address,address)',
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)',
          'deposit()',
          'transfer(address,uint256)'
        ],
        [
          setFactoryCalldata,
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          setRewardConfigCalldata,
          depositCalldata,
          transferCalldata
        ],
      ]
    );

    const mainnetActions = [
      // 1. Bridge ETH from Ethereum to OP timelock using L1StandardBridge
      {
        contract: opL1StandardBridge,
        // function depositETHTo(address _to,uint32 _minGasLimit,bytes calldata _extraData)
        signature:
          'depositETHTo(address,uint32,bytes)',
        args: [
          localTimelock.address,
          200_000,
          '0x',
        ],
        value: wethAmountToBridge
      },
      // 2. Set Comet configuration + deployAndUpgradeTo new Comet, set Reward Config on Optimism
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000],
      },
      // 3. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        ),
      },
    ];  

    const description = '# Initialize cWETHv3 on Optimism\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes deployment of Compound III to the Optimism network. This proposal takes the governance steps recommended and necessary to initialize a Compound III WETH market on Optimism; upon execution, cWETHv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-market-eth-on-optimism/5274/5).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/865), [deploy market GitHub action run]() and [forum discussion](https://www.comp.xyz/t/add-market-eth-on-optimism/5274).\n\n\n## Proposal Actions\n\nThe first action sends mainnet ETH to Arbitrum’s Timelock in order to transfer it to the new Comet and thus seed the market reserves.\n\nThe second proposal action sets the Comet configuration and deploys a new Comet implementation on Optimism. This sends the encoded `setFactory`, `setConfiguration`, `deployAndUpgradeTo` calls across the bridge to the governance receiver on Optimism. It also calls `setRewardConfig` on the Optimism rewards contract, to establish Optimism’s bridged version of COMP as the reward token for the deployment and set the initial supply speed to be 4 COMP/day and borrow speed to be 3 COMP/day. Also it wraps received ETH and transfers it to the new Comet.\n\nThe third action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Arbitrum cUSDCv3 market.';
    const txn = await govDeploymentManager.retry(async () =>{
      return trace(await governor.propose(...(await proposal(mainnetActions, description))));
    }
    );

    const event = txn.events.find((event) => event.event === 'ProposalCreated');
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
      wstETH,
      rETH,
      WBTC
    } = await deploymentManager.getContracts();

    const {
      timelock
    } = await govDeploymentManager.getContracts();

    // 1. & 2
    const wstethInfo = await comet.getAssetInfoByAddress(wstETH.address);
    const rethInfo = await comet.getAssetInfoByAddress(rETH.address);
    const wbtcInfo = await comet.getAssetInfoByAddress(WBTC.address);
    // expect(rethInfo.supplyCap).to.be.eq(exp(470, 18));
    // expect(wstethInfo.supplyCap).to.be.eq(exp(1_300, 18));
    // expect(wbtcInfo.supplyCap).to.be.eq(exp(60, 8));
    expect(await comet.pauseGuardian()).to.be.eq('0x3fFd6c073a4ba24a113B18C8F373569640916A45');
    expect(await comet.getReserves()).to.be.equal(wethAmountToBridge);

    const opCOMP = new Contract(
      opCOMPAddress,
      ['function balanceOf(address account) external view returns (uint256)'],
      deploymentManager.hre.ethers.provider
    );
    expect((await opCOMP.balanceOf(rewards.address)).gt(exp(2_500, 18))).to.be.true;
    // expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(4 / 86400, 15, 18)); // 46296296296
    // expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(exp(3 / 86400, 15, 18)); // 34722222222

    // 3.
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
        {
          baseSymbol: 'USDT',
          cometAddress: '0xaeB318360f27748Acb200CE616E389A6C9409a07',
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
          cometAddress: comet.address,
        },
      ],
    });
  }
});
