import { CometContext, scenario } from './context/CometContext';
import { expect } from 'chai';

scenario.only('upgrade governor', {}, async ({ comet, proxyAdmin, actors }, world) => {
    const { admin, albert } = actors;

    expect(await comet.governor()).to.equal(admin.address);

    await proxyAdmin.setGovernor(comet.address, albert.address);
    await proxyAdmin.deployAndUpgrade(comet.address);

    expect(await comet.governor()).to.equal(albert.address);
  });