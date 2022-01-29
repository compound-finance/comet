import hre from 'hardhat';
import { expect } from 'chai';

import { Cache } from '../Cache';
import {
  AliasTemplate,
  FieldKey,
  RelationConfigMap,
  RelationInnerConfig,
  aliasTemplateFromAlias,
  getRelationConfig,
  getFieldKey,
  readAlias,
  readField,
} from '../RelationConfig';
import { tempDir } from './TestHelpers';

interface FieldKeyTest {
  name: string;
  alias: string | undefined;
  config: RelationInnerConfig;
  exp: FieldKey;
}

interface ReadFieldTest {
  name: string;
  contract: any;
  fieldKey: FieldKey;
  exp: string[];
}

interface ReadAliasTest {
  name: string;
  contract: any;
  template: AliasTemplate;
  exp: string;
}

let testRelRelations: RelationConfigMap = {
  poochie: {
    relations: {
      name: {},
      age: {},
    },
  },
};

let testBaseRelations: RelationConfigMap = {
  poochie: {
    relations: {
      age: {},
    },
  },
};

describe('RelationConfig', () => {
  it('gets relations config from base and rel', async () => {
    hre.config.deploymentManager = {
      relationConfigMap: testBaseRelations,
      networks: {
        test: testRelRelations,
      },
    };

    expect(await getRelationConfig(hre.config.deploymentManager, 'fuji')).to.eql(testBaseRelations);
    expect(await getRelationConfig(hre.config.deploymentManager, 'test')).to.eql(testRelRelations);
  });

  describe('getFieldKey', () => {
    let getter = (x) => x;
    let fieldKeyTests: FieldKeyTest[] = [
      {
        name: 'simple alias',
        alias: 'simple',
        config: {},
        exp: {
          key: 'simple',
        },
      },
      {
        name: 'simple alias config',
        alias: 'simple',
        config: {
          field: {
            key: 'override',
          },
        },
        exp: {
          key: 'override',
        },
      },
      {
        name: 'simple getter',
        alias: 'simple',
        config: {
          field: {
            getter,
          },
        },
        exp: {
          getter,
        },
      },
    ];

    fieldKeyTests.forEach(({ name, alias, config, exp }) => {
      it(name, async () => {
        expect(getFieldKey(alias, config || {})).to.eql(exp);
      });
    });
  });

  describe('readField', () => {
    let zero = '0x0000000000000000000000000000000000000000';
    let one = '0x0000000000000000000000000000000000000001';
    let two = '0x0000000000000000000000000000000000000002';
    let three = '0x0000000000000000000000000000000000000003';

    let contract = {
      provider: {
        getStorageAt: async (c, x) => {
          return `0x00000000000000000000000000000000000000000000000000000000000000${x.slice(-2)}`;
        },
      },
      callStatic: {
        name: async () => one,
        age: async () => [one, two],
      },
    };

    let readFieldTests: ReadFieldTest[] = [
      {
        name: 'simple key single',
        contract,
        fieldKey: {
          key: 'name',
        },
        exp: [one],
      },
      {
        name: 'simple key multi',
        contract,
        fieldKey: {
          key: 'age',
        },
        exp: [one, two],
      },
      {
        name: 'slot key',
        contract,
        fieldKey: {
          slot: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
        },
        exp: [three],
      },
      {
        name: 'fn call single',
        contract,
        fieldKey: {
          getter: async (contract) => one,
        },
        exp: [one],
      },
      {
        name: 'fn call multi',
        contract,
        fieldKey: {
          getter: async (contract) => [one, two],
        },
        exp: [one, two],
      },
    ];

    readFieldTests.forEach(({ name, contract, fieldKey, exp }) => {
      it(name, async () => {
        expect(await readField(contract, fieldKey)).to.eql(exp);
      });
    });
  });

  describe('readAlias', () => {
    let contractFns = {
      name: async () => 'Bob',
      children: async () => ['Tommy', 'Sue'],
    };
    let contract = {
      ...contractFns,
      callStatic: contractFns,
    };

    let readAliasTests: ReadAliasTest[] = [
      {
        name: 'simple alias',
        contract,
        template: 'Gent',
        exp: 'Gent',
      },
      {
        name: 'simple dot-alias',
        contract,
        template: '.name',
        exp: 'Bob',
      },
      {
        name: 'simple fn',
        contract,
        template: (contract) => contract.name(),
        exp: 'Bob',
      },
    ];

    readAliasTests.forEach(({ name, contract, template, exp }) => {
      it(name, async () => {
        expect(await readAlias(contract, template)).to.eql(exp);
      });
    });
  });

  describe('readAlias', () => {
    it('returns alias template', async () => {
      expect(aliasTemplateFromAlias('bob')).to.eql('bob');
    });
  });
});
