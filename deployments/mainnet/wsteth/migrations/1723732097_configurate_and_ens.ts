import { ethers } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';
const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

const wstETHAmount = ethers.BigNumber.from(exp(20, 18));

export default migration('1723732097_configurate_and_ens', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();
    const cometFactory = await deploymentManager.fromDep('cometFactory', 'mainnet', 'usdt', true);
    const ethToWstETHPriceFeed = await deploymentManager.fromDep('wstETH:priceFeed', 'mainnet', 'weth', true);
    const price = (await ethToWstETHPriceFeed.latestRoundData())[1];
    const etherToWstETH = ethers.BigNumber.from(wstETHAmount).mul(price).div(exp(1,8)).toBigInt();

    const {
      comet,
      cometAdmin,
      configurator,
      rewards,
      COMP,
      governor,
      bulker,
    } = await deploymentManager.getContracts();

    const configuration = await getConfigurationStruct(deploymentManager);

    const ENSResolver = await deploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const currentChainId = 1;
    const newMarketObject = { baseSymbol: 'wstETH', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));

    if (officialMarketsJSON[currentChainId]) {
      officialMarketsJSON[currentChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[currentChainId] = [newMarketObject];
    }

    const actions = [
      // 1. Set the Comet factory in configuration
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, cometFactory.address],
      },
      // 2. Set the Comet configuration
      {
        contract: configurator,
        signature: 'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
        args: [comet.address, configuration],
      },
      // 3. Deploy Comet and upgrade it to the new implementation
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
      // 4. Set the reward configuration
      {
        contract: rewards,
        signature: 'setRewardConfig(address,address)',
        args: [comet.address, COMP.address],
      },
      // 5. Deposit ether to get wstETH and transfer it to the Comet
      {
        target: bulker.address,
        value: etherToWstETH,
        signature: 'deposit(address)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['address'],
          [comet.address]
        ),
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

    const description = '# Initialize cwstETHv3 on Ethereum Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes the deployment of Compound III to the Mainnet network. This proposal takes the governance steps recommended and necessary to initialize a Compound III wstETH market on Mainnet; upon execution, cwstETHv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-wsteth-market-on-mainnet/5504/4).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/911), [deploy market GitHub action run](https://github.com/woof-software/comet/actions/runs/10717773287) and [forum discussion](https://www.comp.xyz/t/add-wsteth-market-on-mainnet/5504).\n\n\n## Proposal Actions\n\nThe first proposal action sets the CometFactory for the new Comet instance in the existing Configurator.\n\nThe second action configures the Comet instance in the Configurator.\n\nThe third action deploys an instance of the newly configured factory and upgrades the Comet instance to use that implementation.\n\nThe fourth action configures the existing rewards contract for the newly deployed Comet instance.\n\nThe fifth action converts ether to wstETH and transfers it to the Comet to seed the reserves.\n\nThe sixth action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Ethereum Mainnet cwstETHv3 market.';
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      rewards,
      timelock,
      COMP,
      rsETH,
      ezETH
    } = await deploymentManager.getContracts();

    // 1. & 2. & 3.
    const rsETHInfo = await comet.getAssetInfoByAddress(rsETH.address);
    const ezETHInfo = await comet.getAssetInfoByAddress(ezETH.address);

    expect(rsETHInfo.supplyCap).to.be.eq(exp(10_000, 18));
    expect(ezETHInfo.supplyCap).to.be.eq(exp(15_000, 18));

    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(8 / 86400, 15, 18));   // 92592592592
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(exp(4 / 86400, 15, 18));   // 46296296296

    // 4
    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);
    
    expect((await comet.pauseGuardian()).toLowerCase()).to.be.eq('0xbbf3f1421d886e9b2c5d716b5192ac998af2012c');

    // 5. & 6.
    // expect reserves to be close to wstETHAmount +- 0.1
    expect(await comet.getReserves()).to.be.closeTo(wstETHAmount, exp(1, 17));

    // 7.
    const ENSResolver = await deploymentManager.existing('ENSResolver', ENSResolverAddress);
    const ENSRegistry = await deploymentManager.existing('ENSRegistry', ENSRegistryAddress);
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
        {
          baseSymbol: 'USDT',
          cometAddress: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840'
        },
        {
          baseSymbol: 'wstETH',
          cometAddress: comet.address,
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
    });
  }
});