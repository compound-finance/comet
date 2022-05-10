import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import hre from 'hardhat';
import { FaucetToken, FaucetToken__factory } from '../../../build/types';

import { tempDir } from './TestHelpers';
import { Cache } from '../Cache';
import { getContracts, getContractsFromAliases, storeBuildFile } from '../ContractMap';
import { deploy } from '../Deploy';
import { faucetTokenBuildFile, tokenArgs } from './DeployHelpers';
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
        updateBuildFileABI(faucetTokenBuildFile, [
          {
            anonymous: false,
            inputs: [],
            name: 'cool',
            type: 'function',
            stateMutability: 'view',
          },
        ])
      );

      // No proxy
      let aliases = new Map([['token', '0x0000000000000000000000000000000000000000']]);
      let proxies = new Map();
      let contractMap = await getContractsFromAliases(cache, aliases, proxies, hre);
      expect([...contractMap.keys()]).to.eql(['token']);
      expect(await contractMap.get('token').address).to.eql(
        '0x0000000000000000000000000000000000000000'
      );
      expect(Object.keys(await contractMap.get('token').populateTransaction)).to.eql([
        'cool()',
        'cool',
      ]);

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
        'cool()',
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
        'cool',
      ]);

      // With double proxy
      await storeBuildFile(
        cache,
        '0x0000000000000000000000000000000000000002',
        updateBuildFileABI(faucetTokenBuildFile, [
          {
            anonymous: false,
            inputs: [],
            name: 'cooler',
            type: 'function',
            stateMutability: 'view',
          },
        ])
      );

      proxies.set('token:implementation', '0x0000000000000000000000000000000000000002');
      contractMap = await getContractsFromAliases(cache, aliases, proxies, hre);

      expect([...contractMap.keys()]).to.eql(['token']);
      expect(await contractMap.get('token').address).to.eql(
        '0x0000000000000000000000000000000000000000'
      );
      expect(Object.keys(await contractMap.get('token').populateTransaction)).to.eql([
        'cooler()',
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
        'cool()',
        'cooler',
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
        'cool',
      ]);
    });

    it('retains the contract\'s constructor when building contract with proxy', async () => {
      let cache = new Cache('test', false, tempDir());

      await storeBuildFile(
        cache,
        '0x0000000000000000000000000000000000000000',
        updateBuildFileABI(faucetTokenBuildFile, [
          {
            type: 'constructor',
            stateMutability: 'payable',
            inputs: [
              {
                name: 'TokenConstructorInput',
                type: 'address'
              }
            ]
          },
          {
            name: 'tokenFunction',
            type: 'function',
            stateMutability: 'view'
          }
        ])
      );

      await storeBuildFile(
        cache,
        '0x0000000000000000000000000000000000000001',
        updateBuildFileABI(faucetTokenBuildFile, [
          {
            type: 'constructor',
            stateMutability: 'payable',
            inputs: [
              {
                name: 'TokenImplementationConstructorInput',
                type: 'address'
              }
            ]
          },
          {
            name: 'tokenImplementationFunction',
            type: 'function',
            stateMutability: 'view'
          }
        ])
      );

      await storeBuildFile(
        cache,
        '0x0000000000000000000000000000000000000002',
        updateBuildFileABI(faucetTokenBuildFile, [
          {
            type: 'constructor',
            stateMutability: 'payable',
            inputs: [
              {
                name: 'TokenImplementationImplementationConstructorInput',
                type: 'address'
              }
            ]
          },
          {
            name: 'tokenImplementationImplementationFunction',
            type: 'function',
            stateMutability: 'view'
          }
        ])
      );

      let aliases = new Map([
        ['token', '0x0000000000000000000000000000000000000000'],
        ['token:implementation', '0x0000000000000000000000000000000000000001'],
        ['token:implementation:implementation', '0x0000000000000000000000000000000000000002']
      ]);
      let proxies = new Map([
        ['token', '0x0000000000000000000000000000000000000001'],
        ['token:implementation', '0x0000000000000000000000000000000000000002'],
      ]);

      let contractMap = await getContractsFromAliases(cache, aliases, proxies, hre);

      // builds up each contract's ABI correctly
      expect(Object.keys(contractMap.get('token').populateTransaction)).to.eql([
        'tokenImplementationImplementationFunction()',
        'tokenImplementationFunction()',
        'tokenFunction()',
        'tokenImplementationImplementationFunction',
        'tokenImplementationFunction',
        'tokenFunction',
      ]);

      expect(Object.keys(contractMap.get('token:implementation').populateTransaction)).to.eql([
        'tokenImplementationImplementationFunction()',
        'tokenImplementationFunction()',
        'tokenImplementationImplementationFunction',
        'tokenImplementationFunction',
      ]);

      expect(Object.keys(contractMap.get('token:implementation:implementation').populateTransaction)).to.eql([
        'tokenImplementationImplementationFunction()',
        'tokenImplementationImplementationFunction',
      ]);

      // but maintains each contract's correct constructor
      expect(await contractMap.get('token').interface.deploy.inputs[0].name).to.eq('TokenConstructorInput');
      expect(await contractMap.get('token:implementation').interface.deploy.inputs[0].name).to.eq('TokenImplementationConstructorInput');
      expect(await contractMap.get('token:implementation:implementation').interface.deploy.inputs[0].name).to.eq('TokenImplementationImplementationConstructorInput');
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
