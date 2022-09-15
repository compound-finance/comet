import { NonceManager } from '@ethersproject/experimental';
import { TransactionRequest, TransactionResponse } from '@ethersproject/abstract-provider';
import { TypedDataDomain, TypedDataField, TypedDataSigner } from '@ethersproject/abstract-signer';
import { _TypedDataEncoder } from '@ethersproject/hash';
import { Deferrable } from '@ethersproject/properties';
import { providers } from 'ethers';

// NonceManager does not implement `_signTypedData`, which is needed for the EIP-712 functions
export class ExtendedNonceManager extends NonceManager implements TypedDataSigner {
  async _reset() {
    return this.setTransactionCount(await this.getTransactionCount());
  }

  async _signTypedData(domain: TypedDataDomain, types: Record<string, Array<TypedDataField>>, value: Record<string, any>): Promise<string> {
    const provider = this.provider as providers.JsonRpcProvider;

    // Populate any ENS names (in-place)
    const populated = await _TypedDataEncoder.resolveNames(domain, types, value, (name: string) => {
      return provider.resolveName(name);
    });

    const address = await this.getAddress();

    return await provider.send('eth_signTypedData_v4', [
      address.toLowerCase(),
      JSON.stringify(_TypedDataEncoder.getPayload(populated.domain, types, populated.value))
    ]);
  }

  async sendTransaction(transaction: Deferrable<TransactionRequest>): Promise<TransactionResponse> {
    return super.sendTransaction(transaction).catch((e) => {
      this._reset();
      throw(e);
    });
  }
}