import hre, { ethers } from 'hardhat';
import { event, expect, exp, setTotalsBasic } from '../helpers';
import { liquidateUnderwaterBorrowers } from "../../scripts/run-liquidation-bot";
import { HttpNetworkConfig } from 'hardhat/types/config';
import makeLiquidatableProtocol, { forkMainnet, resetHardhatNetwork } from './makeLiquidatableProtocol';

describe.only('Liquidation Bot', function () {
  before(forkMainnet);
  after(resetHardhatNetwork);

  it('sets up the test', async function () {
    const { comet, liquidator } = await makeLiquidatableProtocol();
    expect(true).to.be.true;
  });
});