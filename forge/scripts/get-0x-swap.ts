import axios from 'axios';

const apiBaseUrl = `https://api.0x.org/swap/v1/quote`;

function apiRequestUrl(queryParams) {
  return apiBaseUrl + '?' + (new URLSearchParams(queryParams)).toString();
}

async function main() {
  const [
    _nodeCmd,
    _filename,
    fromTokenAddress,
    toTokenAddress,
    assetAmount
  ] = process.argv;

  const swapParams = {
    sellToken: fromTokenAddress,
    buyToken: toTokenAddress,
    sellAmount: assetAmount
  };

  const url = apiRequestUrl(swapParams);
  const { data } = await axios.get(url);

  // use process.stdout.write instead of console.log to avoid the trailing
  // newline character, which messes with the forge's ffi command
  process.stdout.write(JSON.stringify({
    target: data.to,
    tx: data.data
  }));
}

main();