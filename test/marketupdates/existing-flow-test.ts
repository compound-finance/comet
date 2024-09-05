import hre from 'hardhat';
import {
  CometProxyAdmin__factory,
  GovernorSimple__factory,
  SimpleTimelock__factory,
  TransparentUpgradeableProxy__factory
} from '../../build/types';
import { ethers, event, expect, makeConfigurator, wait } from './../helpers';

describe('configurator', function() {
  it("Ensure - timelock's admin is set as Governor - Add two(access and not access) test for it.", async () => {
    const { signer, timelock } = await initializeAndFundTimelock();

    const {
      configurator,
      configuratorProxy,
      cometProxy,
      users: [alice]
    } = await makeConfigurator({
      governor: signer
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);

    let setPauseGuardianCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxy.address, alice.address]
    );

    // This works fine as governor is set as timelock's admin
    await timelock.executeTransactions(
      [configuratorProxy.address],
      [0],
      ['setPauseGuardian(address,address)'],
      [setPauseGuardianCalldata]
    );
    expect(
      (await configuratorAsProxy.getConfiguration(cometProxy.address))
        .pauseGuardian
    ).to.be.equal(alice.address);

    // This will revert as alice is calling the timelock
    await expect(
      timelock.connect(alice).executeTransactions(
        [configuratorProxy.address],
        [0], // no Ether to be sent
        ['setPauseGuardian(address,address)'],
        [setPauseGuardianCalldata]
      )
    ).to.be.revertedWithCustomError(timelock, 'Unauthorized');
  });

  it("Ensure - Configurator's governor is set as timelock - Test for access", async () => {
    const { signer, timelock } = await initializeAndFundTimelock();
    const {
      configurator,
      configuratorProxy,
      cometProxy,
      users: [alice]
    } = await makeConfigurator({ governor: signer });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);

    let setPauseGuardianCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxy.address, alice.address]
    );

    // This works fine as configurator's governor is set as timelock
    await timelock.executeTransactions(
      [configuratorProxy.address],
      [0],
      ['setPauseGuardian(address,address)'],
      [setPauseGuardianCalldata]
    );

    expect(
      (await configuratorAsProxy.getConfiguration(cometProxy.address))
        .pauseGuardian
    ).to.be.equal(alice.address);
  });

  it("Ensure - Configurator's governor is set as timelock - Test for not access", async () => {
    const { signer, timelock } = await initializeAndFundTimelock();
    const {
      governor,
      configurator,
      configuratorProxy,
      cometProxy,
      users: [alice]
    } = await makeConfigurator({ governor: signer });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    await configuratorAsProxy.connect(governor).transferGovernor(alice.address); // set alice as governor of Configurator

    let setPauseGuardianCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxy.address, alice.address]
    );

    // This will revert as configurator's governor is set as Alice
    await expect(
      timelock.executeTransactions(
        [configuratorProxy.address],
        [0], // no Ether to be sent
        ['setPauseGuardian(address,address)'],
        [setPauseGuardianCalldata]
      )
    ).to.be.revertedWith('failed to call');
  });

  it("Ensure - CometProxyAdmin's owner is timelock - Test for access", async () => {
    const { signer, timelock } = await initializeAndFundTimelock();
    const {
      configuratorProxy,
      proxyAdmin,
      cometProxy
    } = await makeConfigurator({ governor: signer });

    let deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configuratorProxy.address, cometProxy.address]
    );

    const txn = (await wait(
      timelock.executeTransactions(
        [proxyAdmin.address],
        [0],
        ['deployAndUpgradeTo(address,address)'],
        [deployAndUpgradeToCalldata]
      )
    )) as any;

    const abi = [
      'event CometDeployed(address indexed cometProxy, address indexed newComet)',
      'event Upgraded(address indexed implementation)'
    ];

    // Initialize the contract interface
    const iface = new ethers.utils.Interface(abi);
    const events = [];

    txn.receipt.events.forEach(event => {
      try {
        const decodedEvent = iface.parseLog(event);
        events.push(decodedEvent);
      } catch (error) {
        console.log('Failed to decode event:', error);
      }
    });

    // verify the event names
    expect(events[0].name).to.be.equal('CometDeployed');
    expect(events[1].name).to.be.equal('Upgraded');

    const oldCometProxyAddress = cometProxy.address;
    const oldCometProxyAddressFromEvent = events[0].args.cometProxy;
    const newCometProxyAddress = events[0].args.newComet;

    expect(oldCometProxyAddress).to.be.equal(oldCometProxyAddressFromEvent);
    expect(oldCometProxyAddress).to.be.not.equal(newCometProxyAddress);
  });

  it("Ensure - CometProxyAdmin's owner is timelock - Test for non-access", async () => {
    const { signer, timelock } = await initializeAndFundTimelock();
    const {
      configuratorProxy,
      proxyAdmin,
      cometProxy,
      users: [alice]
    } = await makeConfigurator({ governor: signer });

    await proxyAdmin.transferOwnership(alice.address); // Transferred ownership to alice instead of timelock

    let deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configuratorProxy.address, cometProxy.address]
    );

    expect(
      timelock.executeTransactions(
        [proxyAdmin.address],
        [0],
        ['deployAndUpgradeTo(address,address)'],
        [deployAndUpgradeToCalldata]
      )
    ).to.be.revertedWith('failed to call');
  });

  it("Ensure - Comet's Proxy's admin is set as CometProxyAdmin - Test for access.", async () => {
    const {
      configurator,
      configuratorProxy,
      proxyAdmin,
      comet,
      cometProxy,
      users: [alice]
    } = await makeConfigurator();

    const cometAsProxy = comet.attach(cometProxy.address);
    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    expect(
      (await configuratorAsProxy.getConfiguration(cometProxy.address)).governor
    ).to.be.equal(await comet.governor());

    const oldGovernor = await comet.governor();
    const newGovernor = alice.address;
    const txn = await wait(
      configuratorAsProxy.setGovernor(cometProxy.address, newGovernor)
    );
    await wait(
      proxyAdmin.deployAndUpgradeTo(
        configuratorProxy.address,
        cometProxy.address
      )
    );

    expect(event(txn, 0)).to.be.deep.equal({
      SetGovernor: {
        cometProxy: cometProxy.address,
        oldGovernor,
        newGovernor
      }
    });
    expect(oldGovernor).to.be.not.equal(newGovernor);
    expect(
      (await configuratorAsProxy.getConfiguration(cometProxy.address)).governor
    ).to.be.equal(newGovernor);
    expect(await cometAsProxy.governor()).to.be.equal(newGovernor);
  });

  it("Ensure - Comet's Proxy's admin is set as CometProxyAdmin - Test for non-access.", async () => {
    const {
      configuratorProxy,
      proxyAdmin,
      comet,
      users: [_alice, bob]
    } = await makeConfigurator();

    // Deploy ProxyAdmin
    const ProxyAdmin = (await ethers.getContractFactory(
      'CometProxyAdmin'
    )) as CometProxyAdmin__factory;
    const proxyAdminTemp = await ProxyAdmin.connect(bob).deploy();
    await proxyAdminTemp.deployed();

    // Deploy Comet proxy
    const CometProxy = (await ethers.getContractFactory(
      'TransparentUpgradeableProxy'
    )) as TransparentUpgradeableProxy__factory;
    const cometProxy = await CometProxy.deploy(
      comet.address,
      proxyAdminTemp.address,
      (await comet.populateTransaction.initializeStorage()).data
    );
    await cometProxy.deployed();

    await expect(
      proxyAdmin.deployAndUpgradeTo(
        configuratorProxy.address,
        cometProxy.address
      )
    ).to.be.reverted;
  });

  it("Add a test to create a proposal and execute it(This proposal changes the governor of configurator and the deploys the comet through ProxyAdmin). This proposal should update something simple on Comet's asset", async () => {
    const { signer, timelock } = await initializeAndFundTimelock();
    const {
      governor,
      configuratorProxy,
      proxyAdmin,
      cometProxy,
      comet,
      users: [_alice]
    } = await makeConfigurator({ governor: signer });
    const GovernorFactory = (await ethers.getContractFactory(
      'GovernorSimple'
    )) as GovernorSimple__factory;
    const governorBravo = await GovernorFactory.deploy();
    await governorBravo.deployed();
    governorBravo.initialize(timelock.address, [governor.address]);

    // Setting GovernorBravo as the admin of timelock
    timelock.setAdmin(governorBravo.address);

    const cometAsProxy = comet.attach(cometProxy.address);
    const ASSET_ADDRESS = (await cometAsProxy.getAssetInfo(1)).asset;
    const NEW_ASSET_SUPPLY_CAP = ethers.BigNumber.from('500000000000000000000');

    expect((await cometAsProxy.getAssetInfo(1)).supplyCap).to.be.not.equal(
      NEW_ASSET_SUPPLY_CAP
    );

    let updateAssetSupplyCapCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint128'],
      [cometProxy.address, ASSET_ADDRESS, NEW_ASSET_SUPPLY_CAP]
    );
    let deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configuratorProxy.address, cometProxy.address]
    );

    const proposeTx = (await wait(
      governorBravo
        .connect(governor)
        .propose(
          [configuratorProxy.address, proxyAdmin.address],
          [0, 0],
          [
            'updateAssetSupplyCap(address,address,uint128)',
            'deployAndUpgradeTo(address,address)'
          ],
          [updateAssetSupplyCapCalldata, deployAndUpgradeToCalldata],
          "Proposal to update Comet's governor"
        )
    )) as any;

    const proposalId = proposeTx.receipt.events[0].args.id.toNumber();

    await wait(governorBravo.connect(governor).queue(proposalId));

    await wait(governorBravo.connect(governor).execute(proposalId));

    expect(
      (await cometAsProxy.getAssetInfoByAddress(ASSET_ADDRESS)).supplyCap
    ).to.be.equal(NEW_ASSET_SUPPLY_CAP);
  });
});
async function initializeAndFundTimelock() {
  const signers = await ethers.getSigners();
  const gov = signers[0];
  const TimelockFactory = (await ethers.getContractFactory(
    'SimpleTimelock'
  )) as SimpleTimelock__factory;
  const timelock = await TimelockFactory.deploy(gov.address);
  const timelockAddress = await timelock.deployed();

  // Impersonate the account
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [timelockAddress.address]
  });

  // Fund the impersonated account
  await gov.sendTransaction({
    to: timelock.address,
    value: ethers.utils.parseEther('1.0') // Sending 1 Ether to cover gas fees
  });

  // Get the signer from the impersonated account
  const signer = await ethers.getSigner(timelockAddress.address);
  return { signer, timelock };
}
