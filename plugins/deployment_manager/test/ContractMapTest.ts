import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import hre from 'hardhat';
import { FaucetToken, FaucetToken__factory } from '../../../build/types';

import { tempDir } from './TestHelpers';
import { Cache } from '../Cache';
import { getContracts, getContractsFromAliases, storeBuildFile } from '../ContractMap';
import { deploy } from '../Deploy';
import { faucetTokenBuildFile, tokenArgs } from './DeployTest';
import { objectFromMap } from '../Utils';
import { BuildFile } from '../Types';

use(chaiAsPromised);

export function updateBuildFileABI(buildFile: BuildFile, abi: object): BuildFile {
  let abiString = JSON.stringify(abi);
  return Object.entries(buildFile.contracts).reduce((acc, [k, v]) => {
    return {
      ...acc,
      contracts: {
        ...acc.contracts,
        [k]: {
          ...v,
          abi: abiString,
        },
      },
    };
  }, buildFile) as any;
}

describe('ContractMap', () => {
  describe('getContractsFromAliases', () => {
    it('returns a contract map without proxy', async () => {
      let cache = new Cache('test', false, tempDir());

      await storeBuildFile(
        cache,
        '0x0000000000000000000000000000000000000000',
        faucetTokenBuildFile
      );
      let aliases = new Map([['token', '0x0000000000000000000000000000000000000000']]);
      let contractMap = await getContractsFromAliases(cache, aliases, new Map(), hre);

      expect([...contractMap.keys()]).to.eql(['token']);
      expect(await contractMap.get('token').address).to.eql(
        '0x0000000000000000000000000000000000000000'
      );
    });

    it('returns a contract map with proxy', async () => {
      let cache = new Cache('test', false, tempDir());

      await storeBuildFile(
        cache,
        '0x0000000000000000000000000000000000000000',
        updateBuildFileABI(faucetTokenBuildFile, [])
      );

      // No proxy
      let aliases = new Map([['token', '0x0000000000000000000000000000000000000000']]);
      let proxies = new Map();
      let contractMap = await getContractsFromAliases(cache, aliases, proxies, hre);
      expect([...contractMap.keys()]).to.eql(['token']);
      expect(await contractMap.get('token').address).to.eql(
        '0x0000000000000000000000000000000000000000'
      );
      expect(Object.keys(await contractMap.get('token').populateTransaction)).to.eql([]);

      // With proxy
      await storeBuildFile(
        cache,
        '0x0000000000000000000000000000000000000001',
        faucetTokenBuildFile
      );

      proxies.set('token', '0x0000000000000000000000000000000000000001');
      contractMap = await getContractsFromAliases(cache, aliases, proxies, hre);

      expect([...contractMap.keys()]).to.eql(['token']);
      expect(await contractMap.get('token').address).to.eql(
        '0x0000000000000000000000000000000000000000'
      );
      expect(Object.keys(await contractMap.get('token').populateTransaction)).to.eql([
        'allocateTo(address,uint256)',
        'allowance(address,address)',
        'approve(address,uint256)',
        'balanceOf(address)',
        'decimals()',
        'name()',
        'symbol()',
        'totalSupply()',
        'transfer(address,uint256)',
        'transferFrom(address,address,uint256)',
        'allocateTo',
        'allowance',
        'approve',
        'balanceOf',
        'decimals',
        'name',
        'symbol',
        'totalSupply',
        'transfer',
        'transferFrom',
      ]);
    });

    it('fails when proxy not found', async () => {
      let cache = new Cache('test', false, tempDir());

      await storeBuildFile(
        cache,
        '0x0000000000000000000000000000000000000000',
        faucetTokenBuildFile
      );

      let aliases = new Map([['token', '0x0000000000000000000000000000000000000000']]);
      let proxies = new Map([['token', '0x0000000000000000000000000000000000000001']]);

      await expect(getContractsFromAliases(cache, aliases, proxies, hre)).to.be.rejectedWith(
        'Failed to find contract by alias token:implementation at 0x0000000000000000000000000000000000000001'
      );
    });
  });

  describe('getContracts', () => {
    it('returns an empty contract map', async () => {
      let cache = new Cache('test', false, tempDir());
      expect(objectFromMap(await getContracts(cache, hre))).to.eql({});
    });

    it('returns a contract map', async () => {
      let cache = new Cache('test', false, tempDir());

      await deploy<FaucetToken, FaucetToken__factory, [number, string, number, string]>(
        'test/FaucetToken.sol',
        tokenArgs,
        hre,
        { cache, alias: 'Toke' }
      );

      let contractMap = await getContracts(cache, hre);

      expect([...contractMap.keys()]).to.eql(['Toke']);
      expect(await contractMap.get('Toke').symbol()).to.eql('TEST');
    });
  });
});
