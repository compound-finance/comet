type MulticallAddressesConfig = {
    [network: string]: string; // address of multicall contract
}

export const multicallAddresses: MulticallAddressesConfig = {
  mainnet: '0xeefBa1e63905eF1D7ACbA5a8513c70307C1cE441',
  arbitrum: '0x7eCfBaa8742fDf5756DAC92fbc8b90a19b8815bF'
};