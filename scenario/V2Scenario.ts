import { scenario } from './context/CometContext';
import { expect } from 'chai';

// XXX
scenario.only(
  'Compound v2 > allows a user to borrow cETH',
  {},
  async ({ actors }, context, world) => {
    const { albert, betty } = actors;
    const dm = context.deploymentManager;

    const whale = await world.impersonateAddress('0xee63001c0b591bdf3ded155a48d74160ee5a7324');
    const cDAI = await dm.existing('CErc20', '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643');
    const cETH = await dm.existing('CEther', '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5');

    await cETH.connect(whale).repayBorrow({value: 10n**18n});
    await cETH.connect(whale).borrow(10n**18n);
  }
);
