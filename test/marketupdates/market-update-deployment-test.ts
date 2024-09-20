import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from './../helpers';
import {
  initializeAndFundGovernorTimelock,
  advanceTimeAndMineBlock,
} from './market-updates-helper';
import {
  CometFactory__factory,
  CometProxyAdmin__factory,
  CometProxyAdminOld__factory,
  Configurator__factory,
  ConfiguratorOld__factory,
  ConfiguratorProxy__factory,
  MarketAdminPermissionChecker__factory,
  SimpleTimelock,
  TransparentUpgradeableProxy__factory,
} from './../../build/types';
import { makeProtocol, getConfigurationForConfigurator } from './../helpers';
import { ethers } from 'hardhat';

describe('MarketUpdateDeployment', function() {
  /*

    Mainner Timelock - https://etherscan.io/address/0x6d903f6003cca6255D85CcA4D3B5E5146dC33925

    Existing Setup Steps:
    1) Deploy CometProxyAdmin with Governor Timelock. The owner of the CometProxyAdmin should be the Governor Timelock
       See the owner here on mainnet -https://etherscan.io/address/0x1ec63b5883c3481134fd50d5daebc83ecd2e8779#readContract
       The owner should be the Governor Timelock
    2) Deploy the Configurator with Admin as CometProxyAdmin
       See the admin of the Proxy contact https://etherscan.io/address/0x316f9708bb98af7da9c68c1c3b5e79039cd336e3
       The admin should be the CometProxyAdmin
    3) Deploy the Comet's Proxy with Admin as CometProxyAdmin
       See the admin of the Proxy contact https://etherscan.io/address/0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840
       The admin should be the CometProxyAdmin

    New Setup Steps:
    -------   Deploy New Contracts -----------
    1) Deploy the address of MarketAdminMultiSig

    2) Deploy MarketUpdateTimelock with Governor Timelock as the owner

    3) Deploy MarketUpdateProposer with MarketAdminMultiSig as the owner

    4) Deploy the new CometProxyAdmin

    5) Set MainGovernorTimelock as the owner of new CometProxyAdmin by calling transferOwnership

    6) Deploy the new Configurator's Implementation

    7) Deploy the MarketAdminPermissionChecker contract

    8) Transfer the ownership of MarketAdminPermissionChecker to Governor Timelock

    -------   Update Existing Contracts -----------

    All actions to be done by timelock proposals
    -- Update Admins ---
    1) Call Old CometProxyAdmin  via timelock and call `changeProxyAdmin` function to set Comet Proxy's admin as the new CometProxyAdmin // This will allow the new CometProxyAdmin to upgrade the Comet's implementation

    2) Call Old CometProxyAdmin and call `changeProxyAdmin` function to set Configurator's Proxy's admin as the new CometProxyAdmin // This will allow the new CometProxyAdmin to upgrade the Configurator's implementation if needed in future

    -- Set new configurator's implementation ---

    3) Set marketUpdateAdmin on MarketAdminPermissionChecker

    4) Set MarketAdminPermissionChecker on Configurator

    5) Set MarketAdminPermissionChecker on CometProxyAdmin

    6) Set Market Update proposer in MarketUpdateTimelock

    7) Deploy market update   // This will make sure existing functionality is working fine
          - setSupplyKink
          - deployAndUpgrade
   */

  /*
    Market Updates

    1) propose a new market update on MarketUpdateProposer using MarketAdminMultiSig

    2) Call the execute function on MarketUpdateProposer to execute the proposal
   */

  it('should be able to deploy MarketUpdates in the proper sequence', async () => {
    const {
      governorTimelockSigner: governorTimelockSigner,
      governorTimelock: governorTimelock,
      originalSigner,
    } = await initializeAndFundGovernorTimelock();

    const {
      configuratorProxyContract,
      configuratorBehindProxy,
      cometBehindProxy,
      oldCometProxyAdmin,
      proxyOfComet,
      comet,
    } = await deployExistingContracts({
      governorTimelock,
      governorTimelockSigner,
      originalSigner,
    });

    const cometAsProxy = comet.attach(cometBehindProxy.address);

    expect(await configuratorBehindProxy.governor()).to.be.equal(
      governorTimelock.address
    );
    // -------   Deploy New Contracts -----------

    const signers = await ethers.getSigners();

    // 1) Deploy the address of MarketAdminMultiSig
    const marketUpdateMultiSig = signers[3];

    const marketUpdaterProposerFactory = await ethers.getContractFactory(
      'MarketUpdateProposer'
    );

    // Fund the impersonated account
    await signers[0].sendTransaction({
      to: marketUpdateMultiSig.address,
      value: ethers.utils.parseEther('1.0'), // Sending 1 Ether to cover gas fees
    });

    const marketAdminTimelockFactory = await ethers.getContractFactory(
      'MarketUpdateTimelock'
    );

    // 2) Deploy MarketUpdateTimelock with Governor Timelock as the owner
    const marketUpdateTimelock = await marketAdminTimelockFactory.deploy(
      governorTimelock.address,
      2 * 24 * 60 * 60 // This is 2 days in seconds
    );

    // Fund the impersonated account
    await signers[0].sendTransaction({
      to: marketUpdateTimelock.address,
      value: ethers.utils.parseEther('1.0'), // Sending 1 Ether to cover gas fees
    });

    // 3) Deploy MarketUpdateProposer with MarketAdminMultiSig as the owner
    const proposalGuardian = signers[5];
    const marketUpdateProposer = await marketUpdaterProposerFactory
      .connect(marketUpdateMultiSig)
      .deploy(
        governorTimelock.address,
        marketUpdateMultiSig.address,
        proposalGuardian.address,
        marketUpdateTimelock.address
      );

    // 4) Deploy the new CometProxyAdmin
    const ProxyAdmin = (await ethers.getContractFactory(
      'CometProxyAdmin'
    )) as CometProxyAdmin__factory;
    const proxyAdminNew = await ProxyAdmin.connect(
      marketUpdateMultiSig
    ).deploy();

    // 5) Set MainGovernorTimelock as the owner of new CometProxyAdmin by calling transferOwnership
    await proxyAdminNew
      .connect(marketUpdateMultiSig)
      .transferOwnership(governorTimelock.address);

    // 6) Deploy the new Configurator's Implementation
    const ConfiguratorFactory = (await ethers.getContractFactory(
      'Configurator'
    )) as Configurator__factory;
    const configuratorNew = await ConfiguratorFactory.connect(
      marketUpdateMultiSig
    ).deploy();
    await configuratorNew.deployed();

    // 7) Deploy the MarketAdminPermissionChecker contract
    const MarketAdminPermissionCheckerFactory =
      (await ethers.getContractFactory(
        'MarketAdminPermissionChecker'
      )) as MarketAdminPermissionChecker__factory;

    const marketAdminPermissionCheckerContract =
      await MarketAdminPermissionCheckerFactory.deploy(
        ethers.constants.AddressZero,
        ethers.constants.AddressZero
      );

    // 8) Transfer the ownership of MarketAdminPermissionChecker to Governor Timelock
    await marketAdminPermissionCheckerContract.transferOwnership(
      governorTimelock.address
    );

    // -------   Update Existing Contracts -----------
    console.log('Updating the existing contracts');

    // Call Old CometProxyAdmin  via timelock and call `changeProxyAdmin` function to set Comet Proxy's admin as the new CometProxyAdmin // This will allow the new CometProxyAdmin to upgrade the Comet's implementation
    await governorTimelock.executeTransactions(
      [oldCometProxyAdmin.address],
      [0],
      ['changeProxyAdmin(address,address)'],
      [
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'address'],
          [proxyOfComet.address, proxyAdminNew.address]
        ),
      ]
    );

    // Call Old CometProxyAdmin and call `changeProxyAdmin` function to set Configurator's Proxy's admin as the new CometProxyAdmin // This will allow the new CometProxyAdmin to upgrade the Configurator's implementation if needed in future
    await governorTimelock.executeTransactions(
      [oldCometProxyAdmin.address],
      [0],
      ['changeProxyAdmin(address,address)'],
      [
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'address'],
          [configuratorProxyContract.address, proxyAdminNew.address]
        ),
      ]
    );

    await governorTimelock.executeTransactions(
      [proxyAdminNew.address],
      [0],
      ['upgrade(address,address)'],
      [
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'address'],
          [configuratorProxyContract.address, configuratorNew.address]
        ),
      ]
    );

    // Setting Market Update Admin in MarketAdminPermissionChecker
    await governorTimelock.executeTransactions(
      [marketAdminPermissionCheckerContract.address],
      [0],
      ['setMarketAdmin(address)'],
      [
        ethers.utils.defaultAbiCoder.encode(
          ['address'],
          [marketUpdateTimelock.address]
        ),
      ]
    );

    // Setting MarketAdminPermissionChecker on Configurator
    await governorTimelock.executeTransactions(
      [configuratorProxyContract.address],
      [0],
      ['setMarketAdminPermissionChecker(address)'],
      [
        ethers.utils.defaultAbiCoder.encode(
          ['address'],
          [marketAdminPermissionCheckerContract.address]
        ),
      ]
    );

    // Setting MarketAdminPermissionChecker on CometProxyAdmin
    await governorTimelock.executeTransactions(
      [proxyAdminNew.address],
      [0],
      ['setMarketAdminPermissionChecker(address)'],
      [
        ethers.utils.defaultAbiCoder.encode(
          ['address'],
          [marketAdminPermissionCheckerContract.address]
        ),
      ]
    );

    // Setting Market Update proposer in MarketUpdateTimelock
    await governorTimelock.executeTransactions(
      [marketUpdateTimelock.address],
      [0],
      ['setMarketUpdateProposer(address)'],
      [
        ethers.utils.defaultAbiCoder.encode(
          ['address'],
          [marketUpdateProposer.address]
        ),
      ]
    );

    // Governor Timelock: Setting new supplyKink in Configurator and deploying Comet
    const newSupplyKinkByGovernorTimelock = 300n;
    const oldSupplyKink = await cometAsProxy.supplyKink();
    expect(oldSupplyKink).to.be.equal(800000000000000000n);
    await governorTimelock.executeTransactions(
      [configuratorProxyContract.address, proxyAdminNew.address],
      [0, 0],
      ['setSupplyKink(address,uint64)', 'deployAndUpgradeTo(address,address)'],
      [
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint64'],
          [cometBehindProxy.address, newSupplyKinkByGovernorTimelock]
        ),
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'address'],
          [configuratorProxyContract.address, cometBehindProxy.address]
        ),
      ]
    );

    const newSupplyKink = await cometAsProxy.supplyKink();
    expect(newSupplyKink).to.be.equal(newSupplyKinkByGovernorTimelock);

    // MarketAdmin: Setting new supplyKink in Configurator and deploying Comet
    const newConfiguratorViaProxy = configuratorNew.attach(
      configuratorProxyContract.address
    );
    const supplyKinkOld = (
      await newConfiguratorViaProxy.getConfiguration(cometBehindProxy.address)
    ).supplyKink;
    expect(supplyKinkOld).to.be.equal(300n);

    const newSupplyKinkByMarketAdmin = 100n;
    await marketUpdateProposer
      .connect(marketUpdateMultiSig)
      .propose(
        [configuratorProxyContract.address, proxyAdminNew.address],
        [0, 0],
        [
          'setSupplyKink(address,uint64)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint64'],
            [cometBehindProxy.address, newSupplyKinkByMarketAdmin]
          ),
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'address'],
            [configuratorProxyContract.address, cometBehindProxy.address]
          ),
        ],
        'Test market update'
      );

    await advanceTimeAndMineBlock(2 * 24 * 60 * 60 + 10); // Fast forward by 2 days + a few seconds to surpass the eta

    await marketUpdateProposer.connect(marketUpdateMultiSig).execute(1);

    expect(
      (await newConfiguratorViaProxy.getConfiguration(cometBehindProxy.address))
        .supplyKink
    ).to.be.equal(newSupplyKinkByMarketAdmin);
  });

  async function deployExistingContracts(input: {
    governorTimelock: SimpleTimelock;
    governorTimelockSigner: SignerWithAddress;
    originalSigner: SignerWithAddress;
  }) {
    const { governorTimelockSigner } = input;
    const opts: any = {};

    const {
      governor,
      pauseGuardian,
      extensionDelegate,
      base,
      comet,
      tokens,
      priceFeeds,
    } = await makeProtocol({
      governor: governorTimelockSigner,
    });

    const configuration = await getConfigurationForConfigurator(
      opts,
      comet,
      governor,
      pauseGuardian,
      extensionDelegate,
      tokens,
      base,
      priceFeeds
    );

    // Deploy ProxyAdmin
    const ProxyAdmin = (await ethers.getContractFactory('CometProxyAdminOld')) as CometProxyAdminOld__factory;
    const proxyAdmin = await ProxyAdmin.connect(governorTimelockSigner).deploy();

    // Deploy Comet proxy
    const CometProxy = (await ethers.getContractFactory('TransparentUpgradeableProxy')) as TransparentUpgradeableProxy__factory;
    const cometBehindProxy = await CometProxy.connect(governorTimelockSigner).deploy(comet.address, proxyAdmin.address, (await comet.populateTransaction.initializeStorage()).data);
    await cometBehindProxy.deployed();

    // Derive the rest of the Configurator configuration values

    // Deploy CometFactory
    const CometFactoryFactory = (await ethers.getContractFactory('CometFactory')) as CometFactory__factory;
    const cometFactory = await CometFactoryFactory.deploy();
    await cometFactory.deployed();

    // Deploy Configurator
    const ConfiguratorFactory = (await ethers.getContractFactory('ConfiguratorOld')) as ConfiguratorOld__factory;
    const configurator = await ConfiguratorFactory.deploy();
    await configurator.deployed();

    // Deploy Configurator proxy
    const initializeCalldata = (await configurator.populateTransaction.initialize(governor.address)).data;
    const ConfiguratorProxyContract = (await ethers.getContractFactory('ConfiguratorProxy')) as ConfiguratorProxy__factory;
    const configuratorProxyContract = await ConfiguratorProxyContract.deploy(configurator.address, proxyAdmin.address, initializeCalldata);
    await configuratorProxyContract.deployed();

    // Set the initial factory and configuration for Comet in Configurator
    const configuratorBehindProxy = configurator.attach(configuratorProxyContract.address);
    await configuratorBehindProxy.connect(governorTimelockSigner).setConfiguration(cometBehindProxy.address, configuration);
    await configuratorBehindProxy.connect(governorTimelockSigner).setFactory(cometBehindProxy.address, cometFactory.address);

    return {
      configuratorProxyContract,
      configuratorBehindProxy,
      cometBehindProxy,
      proxyOfComet: cometBehindProxy,
      oldCometProxyAdmin: proxyAdmin,
      comet,
    };
  }
});
