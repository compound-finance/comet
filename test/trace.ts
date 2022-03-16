import { ethers, TransactionResponseExt } from './helpers';

type OpcodeCount = {
  calls: number;
  totalGasCost: number;
}

export async function opCodesForTransaction(tx: TransactionResponseExt) {
  const trace = await ethers.provider.send("debug_traceTransaction", [tx.hash]);
  const { structLogs } = trace;
  let opcodeCounts: {[opcode: string]: OpcodeCount} = {};

  structLogs.forEach(structLog => {
    if (opcodeCounts[structLog.op]) {
      opcodeCounts[structLog.op].calls += 1;
      opcodeCounts[structLog.op].totalGasCost += structLog.gasCost;
    } else {
      opcodeCounts[structLog.op] = {
        calls: 1,
        totalGasCost: structLog.gasCost
      }
    };
  });

  return {
    totalGasCost: trace.gas,
    opcodeCounts: opcodeCounts,
    orderedOpcodeCounts: Object.entries(opcodeCounts).sort((a, b) => b[1].totalGasCost - a[1].totalGasCost)
  };
}