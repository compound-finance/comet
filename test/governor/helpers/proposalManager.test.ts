import { expect } from 'chai';
import { ethers } from 'hardhat';
import { DeploymentManager } from '../../../plugins/deployment_manager';
import { ProposalManager, createProposalManager } from '../../../src/governor/helpers/proposalManager';
import { ProposalAction, ProposalStack } from '../../../src/governor/types/proposalTypes';

import * as fs from 'fs';
import * as path from 'path';

describe('ProposalManager', () => {
  let deploymentManager: DeploymentManager;
  let proposalManager: ProposalManager;
  const testNetwork = 'test';
  const testDeployment = 'dai';
  const testProposalStackPath = path.join(
    process.cwd(),
    'deployments',
    testNetwork,
    testDeployment,
    'proposalStack.json'
  );

  beforeEach(async () => {
    // Create a mock deployment manager
    deploymentManager = new DeploymentManager(ethers as any, testNetwork, {} as any);
    proposalManager = createProposalManager(deploymentManager, testNetwork, testDeployment);
    
    // Clean up any existing test files and ensure directory exists
    const testDir = path.dirname(testProposalStackPath);
    if (fs.existsSync(testProposalStackPath)) {
      fs.unlinkSync(testProposalStackPath);
    }
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Clear any existing proposal stack to ensure test isolation
    await proposalManager.clearProposalStack();
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testProposalStackPath)) {
      fs.unlinkSync(testProposalStackPath);
    }
    const testDir = path.dirname(testProposalStackPath);
    if (fs.existsSync(testDir) && fs.readdirSync(testDir).length === 0) {
      fs.rmdirSync(testDir);
    }
  });

  describe('File Operations', () => {
    it('should create proposal stack file when adding first action', async () => {
      const mockContract = {
        address: '0x1234567890123456789012345678901234567890',
        interface: {
          encodeFunctionData: (_signature: string, _args: any[]) => '0x' + '0'.repeat(64)
        }
      } as any;

      const action: ProposalAction = {
        contract: mockContract,
        value: 0,
        signature: 'testFunction',
        args: ['arg1', 'arg2']
      };

      await proposalManager.addAction(action);

      expect(fs.existsSync(testProposalStackPath)).to.be.true;
      
      const stack = JSON.parse(fs.readFileSync(testProposalStackPath, 'utf8'));
      expect(stack.actions).to.have.length(1);
      // ProposalStackAction doesn't have type property
      expect(stack.actions[0].target).to.equal(mockContract.address);
    });

    it('should load existing proposal stack', async () => {
      // Ensure directory exists
      const testDir = path.dirname(testProposalStackPath);
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      // Create a test proposal stack file
      const testStack: ProposalStack = {
        actions: [
          {
            id: 'test-action-1',
            target: '0x1234567890123456789012345678901234567890',
            value: 0,
            calldata: '0x1234567890abcdef',
            args: ['arg1'],
            description: 'Test action'
          }
        ],
        description: 'Test proposal',
        metadata: { version: '1.0.0' }
      };

      fs.writeFileSync(testProposalStackPath, JSON.stringify(testStack, null, 2));

      const loadedStack = await proposalManager.loadProposalStack();
      expect(loadedStack.actions).to.have.length(1);
      expect(loadedStack.description).to.equal('Test proposal');
      expect(loadedStack.metadata?.version).to.equal('1.0.0');
    });

    it('should return empty stack if file does not exist', async () => {
      const stack = await proposalManager.loadProposalStack();
      expect(stack.actions).to.have.length(0);
      expect(stack.description).to.equal('');
      expect(stack.metadata).to.deep.equal({});
    });

    it('should clear proposal stack', async () => {
      // Add an action first
      const mockContract = {
        address: '0x1234567890123456789012345678901234567890',
        interface: {
          encodeFunctionData: (_signature: string, _args: any[]) => '0x' + '0'.repeat(64)
        }
      } as any;

      await proposalManager.addAction({
        contract: mockContract,
        value: 0,
        signature: 'testFunction',
        args: []
      });

      // Clear the stack
      await proposalManager.clearProposalStack();

      const stack = await proposalManager.loadProposalStack();
      expect(stack.actions).to.have.length(0);
      expect(stack.description).to.equal('');
    });
  });

  describe('Action Management', () => {
    it('should add contract action', async () => {
      const mockContract = {
        address: '0x1234567890123456789012345678901234567890',
        interface: {
          encodeFunctionData: (_signature: string, _args: any[]) => '0x' + '0'.repeat(64)
        }
      } as any;

      const action: ProposalAction = {
        contract: mockContract,
        value: 1000,
        signature: 'setValue',
        args: ['newValue']
      };

      await proposalManager.addAction(action, 'Set new value');

      const stack = await proposalManager.loadProposalStack();
      expect(stack.actions).to.have.length(1);
      
      const addedAction = stack.actions[0];
      expect(addedAction.target).to.equal(mockContract.address);
      expect(addedAction.value).to.equal(1000);
      expect(addedAction.calldata).to.equal('0x' + '0'.repeat(64));
      expect(addedAction.description).to.equal('Set new value');
    });

    it('should add target action', async () => {
      const action: ProposalAction = {
        target: '0xabcdef1234567890123456789012345678901234',
        value: 0,
        calldata: '0x1234567890abcdef'
      };

      await proposalManager.addAction(action, 'Deploy contract');

      const stack = await proposalManager.loadProposalStack();
      expect(stack.actions).to.have.length(1);
      
      const addedAction = stack.actions[0];
      expect(addedAction.target).to.equal('0xabcdef1234567890123456789012345678901234');
      expect(addedAction.value).to.equal(0);
      expect(addedAction.calldata).to.equal('0x1234567890abcdef');
      expect(addedAction.description).to.equal('Deploy contract');
    });

    it('should add multiple actions', async () => {
      const mockContract = {
        address: '0x1234567890123456789012345678901234567890',
        interface: {
          encodeFunctionData: (_signature: string, _args: any[]) => '0x' + '0'.repeat(64)
        }
      } as any;

      const actions: ProposalAction[] = [
        {
          contract: mockContract,
          value: 0,
          signature: 'function1',
          args: ['arg1']
        },
        {
          target: '0xabcdef1234567890123456789012345678901234',
          value: 1000,
          calldata: '0x1234567890abcdef'
        }
      ];

      const descriptions = ['First action', 'Second action'];

      await proposalManager.addActions(actions, descriptions);

      const stack = await proposalManager.loadProposalStack();
      expect(stack.actions).to.have.length(2);
      expect(stack.actions[0].description).to.equal('First action');
      expect(stack.actions[1].description).to.equal('Second action');
    });

    it('should generate unique action IDs', async () => {
      const mockContract = {
        address: '0x1234567890123456789012345678901234567890',
        interface: {
          encodeFunctionData: (_signature: string, _args: any[]) => '0x' + '0'.repeat(64)
        }
      } as any;

      await proposalManager.addAction({
        contract: mockContract,
        value: 0,
        signature: 'function1',
        args: []
      });

      await proposalManager.addAction({
        contract: mockContract,
        value: 0,
        signature: 'function2',
        args: []
      });

      const stack = await proposalManager.loadProposalStack();
      expect(stack.actions[0].id).to.not.equal(stack.actions[1].id);
    });
  });

  describe('Description and Metadata', () => {
    it('should set proposal description', async () => {
      await proposalManager.setDescription('Test proposal description');
      
      const stack = await proposalManager.loadProposalStack();
      expect(stack.description).to.equal('Test proposal description');
    });

    it('should add metadata', async () => {
      await proposalManager.addMetadata('version', '1.0.0');
      await proposalManager.addMetadata('author', 'test-script');
      
      const stack = await proposalManager.loadProposalStack();
      expect(stack.metadata?.version).to.equal('1.0.0');
      expect(stack.metadata?.author).to.equal('test-script');
    });

    it('should update existing metadata', async () => {
      await proposalManager.addMetadata('version', '1.0.0');
      await proposalManager.addMetadata('version', '2.0.0');
      
      const stack = await proposalManager.loadProposalStack();
      expect(stack.metadata?.version).to.equal('2.0.0');
    });
  });

  describe('Proposal Data Conversion', () => {
    it('should convert proposal stack to proposal data', async () => {
      const mockContract = {
        address: '0x1234567890123456789012345678901234567890',
        interface: {
          encodeFunctionData: (_signature: string, _args: any[]) => '0x' + '0'.repeat(64)
        }
      } as any;

      // Mock the contract retrieval
      (deploymentManager as any).contract = async (address: string) => {
        if (address === mockContract.address) {
          return mockContract;
        }
        return null;
      };

      await proposalManager.addAction({
        contract: mockContract,
        value: 1000,
        signature: 'setValue',
        args: ['newValue']
      });

      await proposalManager.setDescription('Test proposal');

      const proposalData = await proposalManager.toProposalData();
      
      expect(proposalData.targets).to.have.length(1);
      expect(proposalData.targets[0]).to.equal(mockContract.address);
      expect(proposalData.values).to.deep.equal([1000]);
      expect(proposalData.calldatas).to.have.length(1);
      expect(proposalData.description).to.equal('Test proposal');
    });

    it('should throw error when converting empty proposal stack', async () => {
      try {
        await proposalManager.toProposalData();
        expect.fail('Should have thrown error for empty proposal stack');
      } catch (error) {
        expect(error.message).to.include('No actions in proposal stack');
      }
    });

    it('should convert proposal stack with any target address', async () => {
      // Add action with any target address - toProposalData doesn't validate contracts
      const stack = await proposalManager.loadProposalStack();
      stack.actions.push({
        id: 'test-action',
        target: '0xinvalid',
        value: 0,
        calldata: '0x1234567890abcdef',
        args: [],
        description: 'Test'
      });
      await proposalManager['saveProposalStack'](stack);

      // toProposalData should work with any target address
      const proposalData = await proposalManager.toProposalData();
      
      expect(proposalData.targets).to.have.length(1);
      expect(proposalData.targets[0]).to.equal('0xinvalid');
      expect(proposalData.values).to.deep.equal([0]);
      expect(proposalData.calldatas).to.deep.equal(['0x1234567890abcdef']);
    });
  });

  describe('Utility Methods', () => {
    it('should check if proposal has actions', async () => {
      expect(await proposalManager.hasActions()).to.be.false;

      const mockContract = {
        address: '0x1234567890123456789012345678901234567890',
        interface: {
          encodeFunctionData: (_signature: string, _args: any[]) => '0x' + '0'.repeat(64)
        }
      } as any;

      await proposalManager.addAction({
        contract: mockContract,
        value: 0,
        signature: 'testFunction',
        args: []
      });

      expect(await proposalManager.hasActions()).to.be.true;
    });

    it('should get action count', async () => {
      expect(await proposalManager.getActionCount()).to.equal(0);

      const mockContract = {
        address: '0x1234567890123456789012345678901234567890',
        interface: {
          encodeFunctionData: (_signature: string, _args: any[]) => '0x' + '0'.repeat(64)
        }
      } as any;

      await proposalManager.addAction({
        contract: mockContract,
        value: 0,
        signature: 'testFunction1',
        args: []
      });

      expect(await proposalManager.getActionCount()).to.equal(1);

      await proposalManager.addAction({
        contract: mockContract,
        value: 0,
        signature: 'testFunction2',
        args: []
      });

      expect(await proposalManager.getActionCount()).to.equal(2);
    });

    it('should return correct proposal stack path', () => {
      const expectedPath = path.join(
        process.cwd(),
        'deployments',
        testNetwork,
        testDeployment,
        'proposalStack.json'
      );
      expect(proposalManager.getProposalStackPath()).to.equal(expectedPath);
    });
  });

  describe('Error Handling', () => {
    it('should handle file read errors gracefully', async () => {
      // Ensure directory exists
      const testDir = path.dirname(testProposalStackPath);
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      // Create invalid JSON file
      fs.writeFileSync(testProposalStackPath, 'invalid json');
      
      const stack = await proposalManager.loadProposalStack();
      expect(stack.actions).to.have.length(0);
      expect(stack.description).to.equal('');
    });

    it('should handle missing directory creation', async () => {
      // Remove parent directory to test directory creation
      const parentDir = path.dirname(testProposalStackPath);
      if (fs.existsSync(parentDir)) {
        // Remove all files in the directory first
        const files = fs.readdirSync(parentDir);
        for (const file of files) {
          fs.unlinkSync(path.join(parentDir, file));
        }
        fs.rmdirSync(parentDir);
      }

      const mockContract = {
        address: '0x1234567890123456789012345678901234567890',
        interface: {
          encodeFunctionData: (_signature: string, _args: any[]) => '0x' + '0'.repeat(64)
        }
      } as any;

      await proposalManager.addAction({
        contract: mockContract,
        value: 0,
        signature: 'testFunction',
        args: []
      });

      expect(fs.existsSync(testProposalStackPath)).to.be.true;
    });
  });

  describe('BigInt Serialization', () => {
    let mockDeploymentManager: any;
    let mockContract: any;

    beforeEach(() => {
      // Create mock deployment manager
      mockDeploymentManager = {
        tracer: () => (msg: string) => console.log(msg),
        contract: () => mockContract
      };

      // Create mock contract
      mockContract = {
        address: '0x1234567890123456789012345678901234567890',
        interface: {
          encodeFunctionData: (_signature: string, _args: any[]) => '0x1234'
        }
      };
    });
    it('should handle BigInt values in contract actions', async () => {
      const proposalManager = new ProposalManager(mockDeploymentManager, 'test-network', 'test-deployment');
      
      // Clear any existing stack
      await proposalManager.clearProposalStack();
    
      // This should not throw an error - test the async function properly
      await expect(proposalManager.addAction({
        contract: mockContract,
        value: BigInt('1000000000000000000'), // 1 ETH in wei
        signature: 'testFunction',
        args: [BigInt('2000000000000000000')] // 2 ETH in wei
      })).to.not.be.rejected;
    });

    it('should handle BigInt values in target actions', async () => {
      const proposalManager = new ProposalManager(mockDeploymentManager, 'test-network', 'test-deployment');
      
      // Clear any existing stack
      await proposalManager.clearProposalStack();
      
      // This should not throw an error - test the async function properly
      await expect(proposalManager.addAction({
        target: '0x1234567890123456789012345678901234567890',
        value: BigInt('5000000000000000000'), // 5 ETH in wei
        calldata: '0x1234'
      })).to.not.be.rejected;
    });
  });
});
