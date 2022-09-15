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
      await storeBuildFile(cache, 'test-network', address, faucetTokenBuildFile);
      const buildFile = await getBuildFile(cache, 'test-network', address);
      const noBuildFile = await getBuildFile(cache, 'no-test-network', address);
      expect(buildFile).to.eql(faucetTokenBuildFile);
      expect(noBuildFile).to.eql(undefined);
    });

    it('stores deploys in the right place', async () => {
      const cache = new Cache('test-network', 'test-deployment', false, tempDir());
      await deploy('test/FaucetToken.sol', tokenArgs, hre, { cache, network: 'test-network' });
      const contracts = cache.cache.get('test-network').get('.contracts');
      const noContracts = cache.cache.get('no-test-network');
      expect(contracts.size).to.eql(1);
      expect(noContracts).to.eql(undefined);
    });
  });
});
