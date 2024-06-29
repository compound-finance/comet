import { ethers, utils } from 'ethers';
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

const cUSDTAddress = '0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9';
const USDTAmount = ethers.BigNumber.from(exp(250_000, 6));

export default migration('1717664323_configurate_and_ens', {
  async prepare(deploymentManager: DeploymentManager) {
    const cometFactory = await deploymentManager.deploy('cometFactory', 'CometFactory.sol', [], true);
    return { newFactoryAddress: cometFactory.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { newFactoryAddress }) {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const {
      comet,
      cometAdmin,
      configurator,
      rewards,
      COMP,
      USDT,
      governor
    } = await deploymentManager.getContracts();

    const configuration = await getConfigurationStruct(deploymentManager);

    const ENSResolver = await deploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const currentChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
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

    // add polygon-usdt comet (0xaeB318360f27748Acb200CE616E389A6C9409a07)
    // optimism chain id is 137
    if (!(officialMarketsJSON[137].find(market => market.baseSymbol === 'USDT'))) {
      officialMarketsJSON[137].push({ baseSymbol: 'USDT', cometAddress: '0xaeB318360f27748Acb200CE616E389A6C9409a07' });
    }

    if (officialMarketsJSON[currentChainId]) {
      officialMarketsJSON[currentChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[currentChainId] = [newMarketObject];
    }

    const _reduceReservesCalldata = utils.defaultAbiCoder.encode(
      ['uint256'],
      [USDTAmount]
    );

    const actions = [
      // 1. Set the Comet factory in configuration
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, newFactoryAddress],
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
      // 5. Get USDT reserves from cUSDT contract
      {
        target: cUSDTAddress,
        signature: '_reduceReserves(uint256)',
        calldata: _reduceReservesCalldata
      },
      // 6. Transfer USDT to the Comet contract
      {
        contract: USDT,
        signature: 'transfer(address,uint256)',
        args: [comet.address, USDTAmount],
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

    const description = '# Initialize cUSDTv3 on Ethereum Mainnet\n\n## Proposal summary\n\nFranklinDAO team with advice support from Woof Software team proposes deployment of Compound III to the Ethereum Mainnet network. This proposal takes the governance steps recommended and necessary to initialize a Compound III USDT market on Ethereum Mainnet; upon execution, cUSDTv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/launch-usdt-market-on-compound-v3-ethereum/4977/5).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/862), [deploy market GitHub action run](https://github.com/woof-software/comet/actions/runs/9713953378/job/26811913447) and [forum discussion](https://www.comp.xyz/t/launch-usdt-market-on-compound-v3-ethereum/4977).\n\n\n## Proposal Actions\n\nThe first proposal action sets the CometFactory for the new Comet instance in the existing Configurator.\n\nThe second action configures the Comet instance in the Configurator.\n\nThe third action deploys an instance of the newly configured factory and upgrades the Comet instance to use that implementation.\n\nThe fourth action configures the existing rewards contract for the newly deployed Comet instance.\n\nThe fifth action reduces Compound’s [cUSDT](https://etherscan.io/address/0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9) reserves and transfers it to Timelock, in order to seed the market reserves for the cUSDTv3 Comet.\n\nThe sixth action transfers reserves from Timelock to the cUSDTv3 Comet.\n\nThe seventh action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Ethereum Mainnet cUSDTv3 market.';
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
    const ethers = deploymentManager.hre.ethers;

    const {
      comet,
      rewards,
      timelock,
      COMP,
      WBTC,
      WETH,
      UNI,
      LINK,
      wstETH
    } = await deploymentManager.getContracts();

    // 1. & 2. & 3.
    const compInfo = await comet.getAssetInfoByAddress(COMP.address);
    const wbtcInfo = await comet.getAssetInfoByAddress(WBTC.address);
    const wethInfo = await comet.getAssetInfoByAddress(WETH.address);
    const uniInfo = await comet.getAssetInfoByAddress(UNI.address);
    const linkInfo = await comet.getAssetInfoByAddress(LINK.address);
    const wstETHInfo = await comet.getAssetInfoByAddress(wstETH.address);

    expect(compInfo.supplyCap).to.be.eq(exp(100000, 18));
    expect(wbtcInfo.supplyCap).to.be.eq(exp(18000, 8));
    expect(wethInfo.supplyCap).to.be.eq(exp(500000, 18));
    expect(uniInfo.supplyCap).to.be.eq(exp(3000000, 18));
    expect(linkInfo.supplyCap).to.be.eq(exp(2000000, 18));
    expect(wstETHInfo.supplyCap).to.be.eq(exp(9000, 18));

    // 4
    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);
    
    expect((await comet.pauseGuardian()).toLowerCase()).to.be.eq('0xbbf3f1421d886e9b2c5d716b5192ac998af2012c');

    // 5. & 6.
    expect(await comet.getReserves()).to.be.equal(USDTAmount);

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
          cometAddress: comet.address,
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

    // 8.
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(70 / 86400, 15, 18));
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(exp(50 / 86400, 15, 18));
  }
});