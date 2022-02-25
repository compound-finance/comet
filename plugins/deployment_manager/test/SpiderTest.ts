import { expect } from 'chai';
import hre from 'hardhat';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import nock from 'nock';
import { Contract } from 'ethers';

import {
  Dog__factory,
  Dog,
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  TransparentUpgradeableProxy,
} from '../../../build/types';

import { Cache } from '../Cache';
import { getContractsFromAliases } from '../ContractMap';
import { spider } from '../Spider';
import { Address } from '../Types';
import { RelationConfigMap } from '../RelationConfig';
import { objectFromMap } from '../Utils';
import { deploy } from '../Deploy';

interface TestContracts {
  finn: Dog;
  molly: Dog;
  spot: Dog;
  proxy: TransparentUpgradeableProxy;
  finnImpl: Dog;
  proxyAdmin: ProxyAdmin;
}

async function setupContracts(
  cache: Cache,
  hre: HardhatRuntimeEnvironment
): Promise<TestContracts> {
  let proxyAdminArgs: [] = [];
  let proxyAdmin = await deploy<ProxyAdmin, ProxyAdmin__factory, []>(
    'vendor/proxy/ProxyAdmin.sol',
    proxyAdminArgs,
    hre,
    { cache }
  );

  let finnImpl = await deploy<Dog, Dog__factory, [string, string, string[]]>(
    'test/Dog.sol',
    ['', '0x0000000000000000000000000000000000000000', []],
    hre,
    { cache }
  );

  let proxy = await deploy<
    TransparentUpgradeableProxy,
    TransparentUpgradeableProxy__factory,
    [string, string, string]
  >(
    'vendor/proxy/TransparentUpgradeableProxy.sol',
    [
      finnImpl.address,
      proxyAdmin.address,
      (
        await finnImpl.populateTransaction.initializeDog(
          'finn',
          '0x0000000000000000000000000000000000000000',
          []
        )
      ).data,
    ],
    hre,
    { cache }
  );

  let molly = await deploy<Dog, Dog__factory, [string, string, string[]]>(
    'test/Dog.sol',
    ['molly', proxy.address, []],
    hre,
    { cache }
  );

  let spot = await deploy<Dog, Dog__factory, [string, string, string[]]>(
    'test/Dog.sol',
    ['spot', proxy.address, []],
    hre,
    { cache }
  );

  let finn = finnImpl.attach(proxy.address);

  await finn.addPup(molly.address);
  await finn.addPup(spot.address);

  return {
    finn,
    molly,
    spot,
    proxy,
    finnImpl,
    proxyAdmin,
  };
}

describe('Spider', () => {
  beforeEach(async () => {
    nock.disableNetConnect();
  });

  it('runs valid spider', async () => {
    let cache = new Cache('test');
    let { finn, molly, spot, proxy, finnImpl, proxyAdmin } = await setupContracts(cache, hre);

    let roots = new Map([['finn', finn.address]]);

    let relationConfig: RelationConfigMap = {
      finn: {
        proxy: {
          field: {
            slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
          },
        },
        relations: {
          father: {
            alias: '.name',
          },
          pups: {
            field: async (dog) => (await dog.callStatic.puppers()).map(({ pup }) => pup),
            alias: ['.name'],
          },
        },
      },
    };

    let {
      cache: newCache,
      aliases,
      proxies,
    } = await spider(cache, 'avalanche', hre, relationConfig, roots, 0);

    expect(objectFromMap(aliases)).to.eql({
      finn: finn.address,
      'finn:implementation': finnImpl.address,
      molly: molly.address,
      spot: spot.address,
      // TODO: Dictionary?
      // pups: [
      //   '0x0000000000000000000000000000000000000003',
      //   '0x0000000000000000000000000000000000000004',
      // ],
    });

    expect(objectFromMap(proxies)).to.eql({
      finn: finnImpl.address,
    });

    let check = {};
    for (let [alias, contract] of await getContractsFromAliases(cache, aliases, proxies, hre)) {
      // Just make sure these contracts are working, too.
      let name = contract.hasOwnProperty('name') ? await contract.name() : null;
      check[alias] = !!name ? name : contract.address;
    }
    expect(check).to.eql({
      finn: 'finn',
      'finn:implementation': finnImpl.address,
      molly: 'molly',
      spot: 'spot',
    });
  });
});
