import axios from 'axios';

const chainId = 1;
const apiBaseUrl = 'https://api.1inch.io/v5.0/' + chainId;

function apiRequestUrl(methodName, queryParams) {
  return apiBaseUrl + methodName + '?' + (new URLSearchParams(queryParams)).toString();
}

async function main() {
  const [
    _nodeCmd,
    _filename,
    liquidatorAddress,
    fromTokenAddress,
    toTokenAddress,
    assetAmount
  ] = process.argv;

  const swapParams = {
    fromTokenAddress,
    toTokenAddress,
    amount: assetAmount,
    fromAddress: liquidatorAddress,
    slippage: 2,
    disableEstimate: true,
    allowPartialFill: false,
  };
  const url = apiRequestUrl('/swap', swapParams);
  const { data } = await axios.get(url);

  process.stdout.write(JSON.stringify({
    target: data.tx.to,
    tx: data.tx.data
  }));
}

main();