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

const cWBTCAddress = '0xC11b1268C1A384e55C48c2391d8d480264A3A7F4';
const WBTCAmount = ethers.BigNumber.from(exp(2, 8));

export default migration('1725614783_configurate_and_ens', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    const {
      comet,
      cometAdmin,
      configurator,
      rewards,
      COMP,
      WBTC,
      governor
    } = await deploymentManager.getContracts();
    const cometFactory = await deploymentManager.fromDep('cometFactory', 'mainnet', 'usdc');

    const configuration = await getConfigurationStruct(deploymentManager);

    const ENSResolver = await deploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const currentChainId = 1;
    const newMarketObject = { baseSymbol: 'WBTC', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));

    if (officialMarketsJSON[currentChainId]) {
      officialMarketsJSON[currentChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[currentChainId] = [newMarketObject];
    }

    const _reduceReservesCalldata = utils.defaultAbiCoder.encode(
      ['uint256'],
      [WBTCAmount]
    );

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
      // 5. Get WBTC reserves from cWBTC contract
      {
        target: cWBTCAddress,
        signature: '_reduceReserves(uint256)',
        calldata: _reduceReservesCalldata
      },
      // 6. Transfer WBTC to the Comet contract
      {
        contract: WBTC,
        signature: 'transfer(address,uint256)',
        args: [comet.address, WBTCAmount],
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

    const description = 'DESCRIPTION';
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      rewards,
      timelock,
      COMP,
      uniBTC,
      swBTC,
      LBTC
    } = await deploymentManager.getContracts();

    // 1. & 2. & 3.
    const uniBTCInfo = await comet.getAssetInfoByAddress(uniBTC.address);
    const swBTCInfo = await comet.getAssetInfoByAddress(swBTC.address);
    const lbtcInfo = await comet.getAssetInfoByAddress(LBTC.address);

    // expect(uniBTCInfo.supplyCap).to.be.eq(exp(9, 8));
    // expect(swBTCInfo.supplyCap).to.be.eq(exp(13, 8));
    // expect(lbtcInfo.supplyCap).to.be.eq(exp(37, 8));
  
    // expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(1 / 86400, 15, 18)); // 11574074074
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(exp(0));


    // 4
    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);
    
    expect((await comet.pauseGuardian()).toLowerCase()).to.be.eq('0xbbf3f1421d886e9b2c5d716b5192ac998af2012c');

    // 5. & 6.
    expect(await comet.getReserves()).to.be.equal(WBTCAmount);

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
          cometAddress: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840',
        },
        {
          baseSymbol: 'WBTC',
          cometAddress: comet.address,
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
    });
  }
});