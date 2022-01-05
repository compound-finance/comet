import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { World } from '../plugins/scenario';

scenario('initializes governor correctly', {}, async ({ comet, actors }) => {
  // TODO: Make this more interesting, plus the admin here isn't right for mainnet, etc.
  expect(await comet.governor()).to.equal(actors['admin']!.address);
});
