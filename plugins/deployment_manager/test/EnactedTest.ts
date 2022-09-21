import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { addEnactedToMigration } from '../Enacted';
import * as ts from 'typescript';

use(chaiAsPromised);

const migrationWithoutEnacted = `import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

interface Vars {};

export default migration('1_cool', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    // No governance changes
  },
});
`;

const migrationWithoutEnactedWithoutTrailingComma = `import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

interface Vars {};

export default migration('1_cool', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    // No governance changes
  }
});
`;

const migrationWithoutEnactedWithTrailingComment = `import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

interface Vars {};

export default migration('1_cool', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    // No governance changes
  }, // Trailing comment
});
`;

const migrationWithoutEnactedWithoutTrailingCommaWithTrailingComment = `import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

interface Vars {};

export default migration('1_cool', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    // No governance changes
  } // Trailing comment without trailing comma
});
`;

const migrationWithEnacted = `import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

interface Vars {};

export default migration('1_cool', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    // No governance changes
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },
});
`;

const migrationWithEnactedWithoutTrailingComma = `import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

interface Vars {};

export default migration('1_cool', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    // No governance changes
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  }
});
`;

const migrationWithEnactedWithTrailingComment = `import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

interface Vars {};

export default migration('1_cool', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    // No governance changes
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  }, // Trailing comment
});
`;

const migrationWithEnactedWithoutTrailingCommaWithTrailingComment = `import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

interface Vars {};

export default migration('1_cool', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    // No governance changes
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  }, // Trailing comment without trailing comma
});
`;

describe('Enacted', () => {
  it('writes enacted to migration', async () => {
    const startingSourceFile = ts.createSourceFile('test', migrationWithoutEnacted, ts.ScriptTarget.Latest);
    expect(addEnactedToMigration(startingSourceFile)).to.equal(migrationWithEnacted);
  });

  it('handles no trailing comma', async () => {
    const startingSourceFile = ts.createSourceFile('test', migrationWithoutEnactedWithoutTrailingComma, ts.ScriptTarget.Latest);
    expect(addEnactedToMigration(startingSourceFile)).to.equal(migrationWithEnacted);
  });

  it('handles existing enacted', async () => {
    const startingSourceFile = ts.createSourceFile('test', migrationWithEnacted, ts.ScriptTarget.Latest);
    expect(addEnactedToMigration(startingSourceFile)).to.equal(migrationWithEnacted);
  });

  it('handles existing enacted without trailing comma', async () => {
    const startingSourceFile = ts.createSourceFile('test', migrationWithEnactedWithoutTrailingComma, ts.ScriptTarget.Latest);
    expect(addEnactedToMigration(startingSourceFile)).to.equal(migrationWithEnacted);
  });

  it('handles existing enacted with trailing comment', async () => {
    const startingSourceFile = ts.createSourceFile('test', migrationWithoutEnactedWithTrailingComment, ts.ScriptTarget.Latest);
    expect(addEnactedToMigration(startingSourceFile)).to.equal(migrationWithEnactedWithTrailingComment);
  });

  it('handles existing enacted without trailing comma with trailing comment', async () => {
    const startingSourceFile = ts.createSourceFile('test', migrationWithoutEnactedWithoutTrailingCommaWithTrailingComment, ts.ScriptTarget.Latest);
    expect(addEnactedToMigration(startingSourceFile)).to.equal(migrationWithEnactedWithoutTrailingCommaWithTrailingComment);
  });
});
