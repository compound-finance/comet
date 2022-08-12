import { expect } from 'chai';
import hre from 'hardhat';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import nock from 'nock';

import {
  Dog,
  ProxyAdmin,
  TransparentUpgradeableProxy,
} from '../../../build/types';

import { Cache } from '../Cache';
import { spider } from '../Spider';
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
  const proxyAdmin: ProxyAdmin = await deploy(
    'vendor/proxy/transparent/ProxyAdmin.sol',
    [],
    hre,
    { cache, network: 'test-network' }
  );

  const finnImpl: Dog = await deploy(
    'test/Dog.sol',
    ['finn:implementation', '0x0000000000000000000000000000000000000000', []],
    hre,
    { cache, network: 'test-network' }
  );

  const proxy: TransparentUpgradeableProxy = await deploy(
    'vendor/proxy/transparent/TransparentUpgradeableProxy.sol',
    [
      finnImpl.address,
      proxyAdmin.address,
      (
        await finnImpl.populateTransaction.initializeDog(
          'finn',
          finnImpl.address,
          []
        )
      ).data,
    ],
    hre,
    { cache, network: 'test-network' }
  );

  const molly: Dog = await deploy(
    'test/Dog.sol',
    ['molly', proxy.address, []],
    hre,
    { cache, network: 'test-network' }
  );

  const spot: Dog = await deploy(
    'test/Dog.sol',
    ['spot', proxy.address, []],
    hre,
    { cache, network: 'test-network' }
  );

  const finn = finnImpl.attach(proxy.address);

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
    const cache = new Cache('test-network', 'test-deployment');
    const { finn, molly, spot, finnImpl } = await setupContracts(cache, hre);

    const roots = new Map([['finn', finn.address]]);

    const relationConfig: RelationConfigMap = {
      finn: {
        delegates: {
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

    const { aliases, contracts } = await spider(cache, 'test-network', hre, relationConfig, roots);

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

    const check = {};
    for (const [alias, contract] of contracts) {
      // Just make sure these contracts are working, too.
      const name = contract.hasOwnProperty('name') ? await contract.name() : null;
      check[alias] = name ? name : contract.address;
    }
    expect(check).to.eql({
      finn: 'finn',
      'finn:implementation': 'finn:implementation',
      molly: 'molly',
      spot: 'spot',
    });
  });
});
