import { expect } from 'chai';
import { 
  ContractAction, 
  TargetAction, 
  ProposalAction, 
  ProposalData, 
  ProposalStack, 
  ProposalStackAction,
  ProposalExecutionResult 
} from '../../../src/governor/types/proposalTypes';

describe('ProposalTypes', () => {
  describe('ContractAction', () => {
    it('should create valid ContractAction', () => {
      const mockContract = {
        address: '0x1234567890123456789012345678901234567890'
      } as any;

      const action: ContractAction = {
        contract: mockContract,
        value: 1000,
        signature: 'setValue',
        args: ['newValue', 42]
      };

      expect(action.contract).to.equal(mockContract);
      expect(action.value).to.equal(1000);
      expect(action.signature).to.equal('setValue');
      expect(action.args).to.deep.equal(['newValue', 42]);
    });

    it('should create ContractAction without value', () => {
      const mockContract = {
        address: '0x1234567890123456789012345678901234567890'
      } as any;

      const action: ContractAction = {
        contract: mockContract,
        signature: 'getValue',
        args: []
      };

      expect(action.contract).to.equal(mockContract);
      expect(action.value).to.be.undefined;
      expect(action.signature).to.equal('getValue');
      expect(action.args).to.deep.equal([]);
    });
  });

  describe('TargetAction', () => {
    it('should create valid TargetAction', () => {
      const action: TargetAction = {
        target: '0xabcdef1234567890123456789012345678901234',
        value: 0,
        signature: 'deploy',
        calldata: '0x1234567890abcdef'
      };

      expect(action.target).to.equal('0xabcdef1234567890123456789012345678901234');
      expect(action.value).to.equal(0);
      expect(action.signature).to.equal('deploy');
      expect(action.calldata).to.equal('0x1234567890abcdef');
    });

    it('should create TargetAction without value', () => {
      const action: TargetAction = {
        target: '0xabcdef1234567890123456789012345678901234',
        signature: 'execute',
        calldata: '0x1234567890abcdef'
      };

      expect(action.target).to.equal('0xabcdef1234567890123456789012345678901234');
      expect(action.value).to.be.undefined;
      expect(action.signature).to.equal('execute');
      expect(action.calldata).to.equal('0x1234567890abcdef');
    });
  });

  describe('ProposalAction Union Type', () => {
    it('should accept ContractAction', () => {
      const mockContract = {
        address: '0x1234567890123456789012345678901234567890'
      } as any;

      const action: ProposalAction = {
        contract: mockContract,
        value: 1000,
        signature: 'setValue',
        args: ['newValue']
      };

      expect('contract' in action).to.be.true;
      expect('target' in action).to.be.false;
    });

    it('should accept TargetAction', () => {
      const action: ProposalAction = {
        target: '0xabcdef1234567890123456789012345678901234',
        value: 0,
        signature: 'deploy',
        calldata: '0x1234567890abcdef'
      };

      expect('target' in action).to.be.true;
      expect('contract' in action).to.be.false;
    });
  });

  describe('ProposalData', () => {
    it('should create valid ProposalData', () => {
      const proposalData: ProposalData = {
        targets: [
          '0x1234567890123456789012345678901234567890',
          '0xabcdef1234567890123456789012345678901234'
        ],
        values: [0, 1000],
        calldatas: [
          '0x1234567890abcdef',
          '0xabcdef1234567890'
        ],
        description: 'Test proposal',
        governor: '0xgovernor1234567890123456789012345678901234',
        metadata: {
          version: '1.0.0',
          author: 'test-script'
        }
      };

      expect(proposalData.targets).to.have.length(2);
      expect(proposalData.values).to.deep.equal([0, 1000]);
      expect(proposalData.calldatas).to.have.length(2);
      expect(proposalData.description).to.equal('Test proposal');
      expect(proposalData.governor).to.equal('0xgovernor1234567890123456789012345678901234');
      expect(proposalData.metadata?.version).to.equal('1.0.0');
    });

    it('should create ProposalData without optional fields', () => {
      const proposalData: ProposalData = {
        targets: ['0x1234567890123456789012345678901234567890'],
        values: [0],
        calldatas: ['0x1234567890abcdef'],
        description: 'Minimal proposal'
      };

      expect(proposalData.targets).to.have.length(1);
      expect(proposalData.values).to.deep.equal([0]);
      expect(proposalData.calldatas).to.have.length(1);
      expect(proposalData.description).to.equal('Minimal proposal');
      expect(proposalData.governor).to.be.undefined;
      expect(proposalData.metadata).to.be.undefined;
    });
  });

  describe('ProposalStackAction', () => {
    it('should create valid contract ProposalStackAction', () => {
      const action: ProposalStackAction = {
        id: 'action_1234567890_abc123',
        type: 'contract',
        target: '0x1234567890123456789012345678901234567890',
        value: 1000,
        signature: 'setValue',
        args: ['newValue'],
        contractAddress: '0x1234567890123456789012345678901234567890',
        description: 'Set new value'
      };

      expect(action.id).to.equal('action_1234567890_abc123');
      expect(action.type).to.equal('contract');
      expect(action.target).to.equal('0x1234567890123456789012345678901234567890');
      expect(action.value).to.equal(1000);
      expect(action.signature).to.equal('setValue');
      expect(action.args).to.deep.equal(['newValue']);
      expect(action.contractAddress).to.equal('0x1234567890123456789012345678901234567890');
      expect(action.description).to.equal('Set new value');
    });

    it('should create valid target ProposalStackAction', () => {
      const action: ProposalStackAction = {
        id: 'action_1234567890_def456',
        type: 'target',
        target: '0xabcdef1234567890123456789012345678901234',
        value: 0,
        signature: 'deploy',
        calldata: '0x1234567890abcdef',
        description: 'Deploy contract'
      };

      expect(action.id).to.equal('action_1234567890_def456');
      expect(action.type).to.equal('target');
      expect(action.target).to.equal('0xabcdef1234567890123456789012345678901234');
      expect(action.value).to.equal(0);
      expect(action.signature).to.equal('deploy');
      expect(action.calldata).to.equal('0x1234567890abcdef');
      expect(action.description).to.equal('Deploy contract');
    });
  });

  describe('ProposalStack', () => {
    it('should create valid ProposalStack', () => {
      const stack: ProposalStack = {
        actions: [
          {
            id: 'action_1',
            type: 'contract',
            target: '0x1234567890123456789012345678901234567890',
            value: 0,
            signature: 'function1',
            args: [],
            contractAddress: '0x1234567890123456789012345678901234567890'
          }
        ],
        description: 'Test proposal stack',
        metadata: {
          version: '1.0.0',
          author: 'test-script'
        }
      };

      expect(stack.actions).to.have.length(1);
      expect(stack.description).to.equal('Test proposal stack');
      expect(stack.metadata?.version).to.equal('1.0.0');
    });

    it('should create empty ProposalStack', () => {
      const stack: ProposalStack = {
        actions: [],
        description: '',
        metadata: {}
      };

      expect(stack.actions).to.have.length(0);
      expect(stack.description).to.equal('');
      expect(stack.metadata).to.deep.equal({});
    });
  });

  describe('ProposalExecutionResult', () => {
    it('should create valid ProposalExecutionResult', () => {
      const result: ProposalExecutionResult = {
        proposalId: '123',
        transactionHash: '0xabcdef1234567890123456789012345678901234567890abcdef1234567890123456',
        targets: ['0x1234567890123456789012345678901234567890'],
        values: [0],
        calldatas: ['0x1234567890abcdef'],
        description: 'Test proposal execution'
      };

      expect(result.proposalId).to.equal('123');
      expect(result.transactionHash).to.equal('0xabcdef1234567890123456789012345678901234567890abcdef1234567890123456');
      expect(result.targets).to.have.length(1);
      expect(result.values).to.deep.equal([0]);
      expect(result.calldatas).to.have.length(1);
      expect(result.description).to.equal('Test proposal execution');
    });
  });

  describe('Type Guards', () => {
    it('should identify ContractAction correctly', () => {
      const mockContract = {
        address: '0x1234567890123456789012345678901234567890'
      } as any;

      const contractAction: ProposalAction = {
        contract: mockContract,
        signature: 'test',
        args: []
      };

      const targetAction: ProposalAction = {
        target: '0x1234567890123456789012345678901234567890',
        signature: 'test',
        calldata: '0x1234'
      };

      expect('contract' in contractAction).to.be.true;
      expect('target' in contractAction).to.be.false;
      expect('contract' in targetAction).to.be.false;
      expect('target' in targetAction).to.be.true;
    });

    it('should identify ProposalStackAction type correctly', () => {
      const contractAction: ProposalStackAction = {
        id: 'test',
        type: 'contract',
        target: '0x1234567890123456789012345678901234567890',
        value: 0,
        signature: 'test',
        args: [],
        contractAddress: '0x1234567890123456789012345678901234567890'
      };

      const targetAction: ProposalStackAction = {
        id: 'test',
        type: 'target',
        target: '0x1234567890123456789012345678901234567890',
        value: 0,
        signature: 'test',
        calldata: '0x1234'
      };

      expect(contractAction.type).to.equal('contract');
      expect(targetAction.type).to.equal('target');
    });
  });
});
