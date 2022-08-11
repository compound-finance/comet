import { expect } from 'chai';
import hre from 'hardhat';

import { tempDir } from './TestHelpers';
import { Cache } from '../Cache';
import { getBuildFile, storeBuildFile } from '../ContractMap';
import { deploy } from '../Deploy';
import { faucetTokenBuildFile, tokenArgs } from './DeployHelpers';

describe('ContractMap', () => {
  describe('storeBuildFile/getBuildFile', () => {
    it('gets what it stores', async () => {
      const cache = new Cache('test-network', 'test-deployment', false, tempDir());
      const address = '0x0000000000000000000000000000000000000000';
      await storeBuildFile(cache, address, faucetTokenBuildFile);
      const buildFile = await getBuildFile(cache, address);
      expect(buildFile).to.eql(faucetTokenBuildFile);
    });

    it('stores deploys in the right place', async () => {
      const cache = new Cache('test-network', 'test-deployment', false, tempDir());
      await deploy('test/FaucetToken.sol', tokenArgs, hre, { cache, alias: 'Toke' });
      const contracts = cache.cache.get('.contracts');
      const aliases = cache.cache.get('test-network').get('test-deployment').get('aliases.json');
      const address = aliases.get('Toke');
      expect(contracts.has(`${address.toLowerCase()}.json`)).to.eql(true);
    });
  });
});
