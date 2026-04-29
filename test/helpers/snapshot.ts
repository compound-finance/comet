import hre from 'hardhat';

export interface SnapshotRestorer {
  /**
   * Resets the state of the blockchain to the point in which the snapshot was
   * taken.
   */
  restore(): Promise<void>;
  snapshotId: string;
}

export async function takeSnapshot(): Promise<SnapshotRestorer> {
  const provider = hre.network.provider;
  let snapshotId = await provider.request({
    method: 'evm_snapshot',
  });

  if (typeof snapshotId !== 'string') {
    throw new Error('EVM_SNAPSHOT_VALUE_NOT_A_STRING');
  }

  return {
    restore: async () => {
      const reverted = await provider.request({
        method: 'evm_revert',
        params: [snapshotId],
      });

      if (typeof reverted !== 'boolean') {
        throw new Error('EVM_REVERT_VALUE_NOT_A_BOOLEAN');
      }

      if (!reverted) {
        throw new Error('INVALID_SNAPSHOT');
      }

      // Re-take the snapshot so that `restore` can be called again
      snapshotId = await provider.request({
        method: 'evm_snapshot',
      });
    },
    snapshotId,
  };
}
