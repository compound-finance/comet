import { expect } from 'chai';
import hre from 'hardhat';
import nock from 'nock';

import {
  Dog__factory,
  Dog,
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  TransparentUpgradeableProxy,
} from '../../../build/types';

import { getAliases } from '../Aliases';
import { getBuildFile } from '../ContractMap';
import { DeploymentManager } from '../DeploymentManager';
import { fiatTokenBuildFile, mockImportSuccess } from './ImportTest';
import { Migration } from '../Migration';
import { expectedTemplate } from './MigrationTemplateTest';
import { getProxies } from '../Proxies';
import { getRoots } from '../Roots';
import { faucetTokenBuildFile, tokenArgs } from './DeployHelpers';
import { tempDir } from './TestHelpers';

export interface TestContracts {
  finn: Dog;
  molly: Dog;
  spot: Dog;
  proxy: TransparentUpgradeableProxy;
  finnImpl: Dog;
  proxyAdmin: ProxyAdmin;
}

export async function setupContracts(deploymentManager: DeploymentManager): Promise<TestContracts> {
  let proxyAdminArgs: [] = [];
  let proxyAdmin = await deploymentManager.deploy<ProxyAdmin, ProxyAdmin__factory, []>(
    'vendor/proxy/transparent/ProxyAdmin.sol',
    proxyAdminArgs
  );

  let finnImpl = await deploymentManager.deploy<Dog, Dog__factory, [string, string, string[]]>(
    'test/Dog.sol',
    ['', '0x0000000000000000000000000000000000000000', []]
  );

  let proxy = await deploymentManager.deploy<
    TransparentUpgradeableProxy,
    TransparentUpgradeableProxy__factory,
    [string, string, string]
  >('vendor/proxy/transparent/TransparentUpgradeableProxy.sol', [
    finnImpl.address,
    proxyAdmin.address,
    (
      await finnImpl.populateTransaction.initializeDog(
        'finn',
        '0x0000000000000000000000000000000000000000',
        []
      )
    ).data,
  ]);

  let molly = await deploymentManager.deploy<Dog, Dog__factory, [string, string, string[]]>(
    'test/Dog.sol',
    ['molly', proxy.address, []]
  );

  let spot = await deploymentManager.deploy<Dog, Dog__factory, [string, string, string[]]>(
    'test/Dog.sol',
    ['spot', proxy.address, []]
  );

  let finn = finnImpl.attach(proxy.address);

  await finn.addPup(molly.address);
  await finn.addPup(spot.address);

  deploymentManager.putRoots(new Map([['finn', finn.address]]));

  return {
    finn,
    molly,
    spot,
    proxy,
    finnImpl,
    proxyAdmin,
  };
}

describe('DeploymentManager', () => {
  beforeEach(async () => {
    nock.disableNetConnect();
  });

  describe('import', () => {
    it('should import succesfully', async () => {
      mockImportSuccess(hre, '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e');
      let deploymentManager = new DeploymentManager('test', hre, {
        importRetries: 0,
        writeCacheToDisk: true,
        baseDir: tempDir(),
      });
      let importResult = await deploymentManager.import(
        '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
        'avalanche'
      );
      expect(importResult).to.eql(fiatTokenBuildFile);
    });
  });

  describe('deploy', () => {
    it('should deploy succesfully', async () => {
      let deploymentManager = new DeploymentManager('test', hre, {
        importRetries: 0,
        writeCacheToDisk: true,
        baseDir: tempDir(),
      });
      let spot = await deploymentManager.deploy<Dog, Dog__factory, [string, string, string[]]>(
        'test/Dog.sol',
        ['spot', '0x0000000000000000000000000000000000000000', []]
      );
      // Check that we've cached the build file
      expect((await getBuildFile(deploymentManager.cache, spot.address)).contract).to.eql('Dog');
    });
  });

  describe('deployBuild', () => {
    it('should deployBuild succesfully', async () => {
      let deploymentManager = new DeploymentManager('test', hre, {
        importRetries: 0,
        writeCacheToDisk: true,
        baseDir: tempDir(),
      });
      let token = await deploymentManager.deployBuild(faucetTokenBuildFile, tokenArgs);
      expect(await token.symbol()).to.equal('TEST');
    });
  });

  describe('putAlias', () => {
    it('should putAlias succesfully', async () => {
      let deploymentManager = new DeploymentManager('test', hre, {
        importRetries: 0,
        writeCacheToDisk: true,
        baseDir: tempDir(),
      });
      await deploymentManager.putAlias('finn', '0x0000000000000000000000000000000000000000');
      let aliases = await getAliases(deploymentManager.cache);
      expect(aliases.get('finn')).to.equal('0x0000000000000000000000000000000000000000');
    });

    it('should invalidate contract cache', async () => {
      let deploymentManager = new DeploymentManager('test', hre, {
        importRetries: 0,
        writeCacheToDisk: true,
        baseDir: tempDir(),
      });
      let spot = await deploymentManager.deploy<Dog, Dog__factory, [string, string, string[]]>(
        'test/Dog.sol',
        ['spot', '0x0000000000000000000000000000000000000000', []]
      );
      let molly = await deploymentManager.deploy<Dog, Dog__factory, [string, string, string[]]>(
        'test/Dog.sol',
        ['molly', '0x0000000000000000000000000000000000000000', []]
      );
      await deploymentManager.putAlias('pet', spot.address);
      expect(await (await deploymentManager.contract('pet')).name()).to.equal('spot');
      await deploymentManager.putAlias('pet', molly.address);
      expect(await (await deploymentManager.contract('pet')).name()).to.equal('molly');
    });
  });

  describe('putProxy', () => {
    it('should putProxy succesfully', async () => {
      let deploymentManager = new DeploymentManager('test', hre, {
        importRetries: 0,
        writeCacheToDisk: true,
        baseDir: tempDir(),
      });
      await deploymentManager.putProxy('finn', '0x0000000000000000000000000000000000000000');
      let proxies = await getProxies(deploymentManager.cache);
      expect(proxies.get('finn')).to.equal('0x0000000000000000000000000000000000000000');
    });

    // TODO: Test cache invalidation?
  });

  describe('putRoots', () => {
    it('should putRoots succesfully', async () => {
      let deploymentManager = new DeploymentManager('test', hre, {
        importRetries: 0,
        writeCacheToDisk: true,
        baseDir: tempDir(),
      });
      await deploymentManager.putRoots(
        new Map([['finn', '0x0000000000000000000000000000000000000000']])
      );
      let roots = await getRoots(deploymentManager.cache);
      expect(roots.get('finn')).to.equal('0x0000000000000000000000000000000000000000');
    });
  });

  describe('spider', () => {
    it('should spider succesfully', async () => {
      let deploymentManager = new DeploymentManager('test', hre, {
        importRetries: 0,
        writeCacheToDisk: true,
        baseDir: tempDir(),
      });

      let { finnImpl } = await setupContracts(
        deploymentManager
      );

      hre.config.deploymentManager.networks = {
        test: {
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
        },
      };

      await deploymentManager.spider();

      let check = {};
      for (let [alias, contract] of await deploymentManager.contracts()) {
        // Just make sure these contracts are working, too.
        let name = contract.hasOwnProperty('name') ? await contract.name() : null;
        check[alias] = name ? name : contract.address;
      }
      expect(check).to.eql({
        finn: 'finn',
        'finn:implementation': finnImpl.address,
        molly: 'molly',
        spot: 'spot',
      });
    });
  });

  describe('contracts', () => {
    it('should get contracts succesfully', async () => {
      let deploymentManager = new DeploymentManager('test', hre, {
        importRetries: 0,
        writeCacheToDisk: true,
        baseDir: tempDir(),
      });

      let { finn, finnImpl } = await setupContracts(
        deploymentManager
      );

      // TODO: Is this using the proxy correctly?
      await deploymentManager.putAlias('mydog', finn.address);
      await deploymentManager.putProxy('mydog', finnImpl.address);
      let contracts = await deploymentManager.contracts();

      expect(await contracts.get('mydog').name()).to.eql('finn');
    });
  });

  describe('contract', () => {
    it('should get contract succesfully', async () => {
      let deploymentManager = new DeploymentManager('test', hre, {
        importRetries: 0,
        writeCacheToDisk: true,
        baseDir: tempDir(),
      });

      let { finn, finnImpl } = await setupContracts(
        deploymentManager
      );

      await deploymentManager.putAlias('mydog', finn.address);
      await deploymentManager.putProxy('mydog', finnImpl.address);
      let contract = await deploymentManager.contract('mydog');
      expect(await contract.name()).to.eql('finn');
    });
  });

  describe('generateMigration', () => {
    it('should generate expected migration', async () => {
      let deploymentManager = new DeploymentManager('test', hre, {
        importRetries: 0,
        writeCacheToDisk: true,
        baseDir: tempDir(),
      });

      expect(await deploymentManager.generateMigration('cool', 1)).to.equal('1_cool.ts');

      expect(
        await deploymentManager.cache.readCache({ rel: ['migrations', '1_cool.ts'] })
      ).to.equal(expectedTemplate);
    });
  });
});
