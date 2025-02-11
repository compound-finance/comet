import { ethers, utils, Contract } from 'ethers';
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

const cWBTCAddress = '0xccF4429DB6322D5C611ee964527D42E5d685DD6a';
const WBTCAmount = ethers.BigNumber.from(exp(2, 8));

export default migration('1737396251_configurate_and_ens', {
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
      cometFactory,
      governor
    } = await deploymentManager.getContracts();

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

    // USDS on Base is live, ENS is not updated until proposal will be executed
    if (!(officialMarketsJSON[8453] as { baseSymbol: string, cometAddress: string }[])?.find(({ baseSymbol }) => baseSymbol === 'USDS')) {
      officialMarketsJSON[8453].push({
        baseSymbol: 'USDS',
        cometAddress: '0x2c776041CCFe903071AF44aa147368a9c8EEA518'
      });
    }

    // USDC on Linea is live, ENS is not updated until proposal will be executed
    if (!officialMarketsJSON[59144]) {
      officialMarketsJSON[59144] = [{
        baseSymbol: 'USDC',
        cometAddress: '0x8D38A3d6B3c3B7d96D6536DA7Eef94A9d7dbC991'
      }];
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

    const description = '# Initialize cWBTCv3 on Ethereum Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes the deployment of Compound III to the Mainnet network. This proposal takes the governance steps recommended and necessary to initialize a Compound III WBTC market on Mainnet; upon execution, cWBTCv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-market-wbtc-on-mainnet/5644/9).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/954), [deploy market GitHub action run](https://github.com/woof-software/comet/actions/runs/13254078631/job/36997674406) and [forum discussion](https://www.comp.xyz/t/add-market-wbtc-on-mainnet/5644).\n\n\n## ENS TXT record update\n\n[USDS on Base proposal](https://www.tally.xyz/gov/compound/proposal/395?govId=eip155:1:0x309a862bbC1A00e45506cB8A802D1ff10004c8C0) is active on the moment of pushing this proposal. The proposal reached the quorum and we expect that the proposal will be executed without fail. In case we need to cancel proposal 395, we need to cancel this proposal too\n\n[USDC on Linea proposal](https://www.tally.xyz/gov/compound/proposal/401) is active on the moment of pushing this proposal. We expect proposal 401 will reach the quorum and will be executed successfully. In case we need to cancel proposal 401, we need to cancel this proposal too.## Proposal Actions\n\nThe first proposal action sets the CometFactory for the new Comet instance in the existing Configurator.\n\nThe second action configures the Comet instance in the Configurator.\n\nThe third action deploys an instance of the newly configured factory and upgrades the Comet instance to use that implementation.\n\nThe fourth action configures the existing rewards contract for the newly deployed Comet instance.\n\nThe fifth action reduces Compound’s [cWBTC](https://etherscan.io/address/0xC11b1268C1A384e55C48c2391d8d480264A3A7F4) reserves and transfers it to Timelock, in order to seed the market reserves for the cWBTCv3 Comet.\n\nThe sixth action transfers reserves from Timelock to the cWBTCv3 Comet.\n\nThe seventh action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Ethereum Mainnet cWBTCv3 market.';
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
      pumpBTC,
      LBTC,
    } = await deploymentManager.getContracts();

    // 1. & 2. & 3.
    const lbtcInfo = await comet.getAssetInfoByAddress(LBTC.address);
    const pumpBTCInfo = await comet.getAssetInfoByAddress(pumpBTC.address);

    expect(lbtcInfo.supplyCap).to.be.eq(exp(200, 8));
    expect(pumpBTCInfo.supplyCap).to.be.eq(exp(15, 8));

    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(1 / 86400, 15, 18)); // 11574074074
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(exp(0));

    const cometNew = new Contract(
      comet.address,
      [
        'function assetList() external view returns (address)',
      ],
      await deploymentManager.getSigner()
    );

    const assetListAddress = await cometNew.assetList();

    expect(assetListAddress).to.not.be.equal(ethers.constants.AddressZero);
    expect(await comet.getReserves()).to.be.equal(WBTCAmount);
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
          cometAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0xA17581A9E3356d9A858b789D68B4d866e593aE94'
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840'
        },
        {
          baseSymbol: 'wstETH',
          cometAddress: '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3'
        },
        {
          baseSymbol: 'USDS',
          cometAddress: '0x5D409e56D886231aDAf00c8775665AD0f9897b56'
        },
        {
          baseSymbol: 'WBTC',
          cometAddress: comet.address
        }
      ],
      10: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x2e44e174f7D53F0212823acC11C01A11d58c5bCB'
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0xE36A30D249f7761327fd973001A32010b521b6Fd'
        }
      ],
      137: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF25212E676D1F7F89Cd72fFEe66158f541246445'
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0xaeB318360f27748Acb200CE616E389A6C9409a07'
        }
      ],
      5000: [
        {
          baseSymbol: 'USDe',
          cometAddress: '0x606174f62cd968d8e684c645080fa694c1D7786E'
        }
      ],
      8453: [
        {
          baseSymbol: 'USDbC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x46e6b214b524310239732D51387075E0e70970bf'
        },
        {
          baseSymbol: 'USDC',
          cometAddress: '0xb125E6687d4313864e53df431d5425969c15Eb2F'
        },
        {
          baseSymbol: 'AERO',
          cometAddress: '0x784efeB622244d2348d4F2522f8860B96fbEcE89'
        },
        {
          baseSymbol: 'USDS',
          cometAddress: '0x2c776041CCFe903071AF44aa147368a9c8EEA518'
        },
      ],
      42161: [
        {
          baseSymbol: 'USDC.e',
          cometAddress: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA'
        },
        {
          baseSymbol: 'USDC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486'
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07'
        }
      ],
      534352: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44'
        }
      ],
      59144: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x8D38A3d6B3c3B7d96D6536DA7Eef94A9d7dbC991'
        }
      ]
    });
  }
});
