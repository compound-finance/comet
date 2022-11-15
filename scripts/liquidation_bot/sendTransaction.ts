import hre from 'hardhat';
import { FlashbotsBundleResolution, FlashbotsTransactionResponse, RelayResponseError } from '@flashbots/ethers-provider-bundle';
import { PopulatedTransaction } from 'ethers';
import googleCloudLog, { LogSeverity } from './googleCloudLog';
import {SignerWithFlashbots} from './liquidateUnderwaterBorrowers';

function isFlashbotsTxnResponse(bundleReceipt: FlashbotsTransactionResponse | RelayResponseError): bundleReceipt is FlashbotsTransactionResponse {
  return (bundleReceipt as FlashbotsTransactionResponse).bundleTransactions !== undefined;
}

async function sendFlashbotsBundle(
  txn: PopulatedTransaction,
  signerWithFlashbots: SignerWithFlashbots
): Promise<boolean> {
  const wallet = signerWithFlashbots.signer;
  const flashbotsProvider = signerWithFlashbots.flashbotsProvider;
  const signedBundle = await flashbotsProvider.signBundle(
    [
      {
        signer: wallet, // ethers signer
        transaction: txn // ethers populated transaction object
      }
    ]);
  const bundleReceipt = await flashbotsProvider.sendRawBundle(
    signedBundle, // bundle we signed above
    await hre.ethers.provider.getBlockNumber() + 1, // block number at which this bundle is valid
  );
  let success: boolean;
  if (isFlashbotsTxnResponse(bundleReceipt)) {
    const resolution = await bundleReceipt.wait();
    if (resolution === FlashbotsBundleResolution.BundleIncluded) {
      success = true;
      googleCloudLog(LogSeverity.INFO, 'Bundle included!');
    } else if (resolution === FlashbotsBundleResolution.BlockPassedWithoutInclusion) {
      // XXX alert if too many attempts are not included in a block
      success = false;
      googleCloudLog(LogSeverity.INFO, 'Block passed without inclusion');
    } else if (resolution === FlashbotsBundleResolution.AccountNonceTooHigh) {
      success = false;
      googleCloudLog(LogSeverity.ALERT, 'Account nonce too high');
    }
  } else {
    success = false;
    googleCloudLog(LogSeverity.ALERT, `Error while sending Flashbots bundle: ${bundleReceipt.error}`);
  }

  return success;
}

// XXX Note: Blocking txn, so we probably want to run these methods in separate threads
export async function sendTxn(
  txn: PopulatedTransaction,
  signerWithFlashbots: SignerWithFlashbots
): Promise<boolean> {
  if (signerWithFlashbots.flashbotsProvider) {
    googleCloudLog(LogSeverity.INFO, 'Sending a private txn via Flashbots');
    return await sendFlashbotsBundle(txn, signerWithFlashbots);
  } else {
    googleCloudLog(LogSeverity.INFO, 'Sending a public txn');
    // XXX confirm that txn.wait() throws if the txn reverts
    await (await signerWithFlashbots.signer.sendTransaction(txn)).wait();
    return true;
  }
}
