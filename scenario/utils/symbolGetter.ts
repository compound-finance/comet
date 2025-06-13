import 'dotenv/config';
const {
  INFURA_KEY,
  QUICKNODE_KEY
} = process.env;

const configs = {
  mainnet: {
    url: 'https://mainnet.infura.io/v3/' + INFURA_KEY,
  },
  sepolia: {
    url: 'https://sepolia.infura.io/v3/' + INFURA_KEY,
  },
  polygon: {
    url: 'https://polygon-mainnet.infura.io/v3/' + INFURA_KEY,
  },
  optimism: {
    url: 'https://optimism-mainnet.infura.io/v3/' + INFURA_KEY,
  },
  base: {
    url: 'https://fluent-prettiest-scion.base-mainnet.quiknode.pro/' + QUICKNODE_KEY,
  },
  arbitrum: {
    url: 'https://arbitrum-mainnet.infura.io/v3/' + INFURA_KEY,
  },
  avalanche: {
    url: 'https://api.avax.network/ext/bc/C/rpc',
  },
  fuji: {
    url: 'https://api.avax-test.network/ext/bc/C/rpc',
  },
  mumbai: {
    url: 'https://polygon-mumbai.infura.io/v3/' + INFURA_KEY,
  },
  arbitrumGoerli: {
    url: 'https://arbitrum-goerli.infura.io/v3/' + INFURA_KEY,
  },
  baseGoerli: {
    url: 'https://goerli.base.org/',
  },
  lineaGoerli: {
    url: 'https://linea-goerli.infura.io/v3/' + INFURA_KEY,
  },
  scrollGoerli: {
    url: 'https://alpha-rpc.scroll.io/l2',
  },
  scroll: {
    url: 'https://rpc.scroll.io',
  }
};

export async function getSymbol(
  address: string,
  network: string
) : Promise<string> {
  const link = configs[network].url;
  try {
    const response = await fetch(link, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            to: address,
            data: '0x95d89b41'
          },
          'latest'
        ],
        id: 1
      })
    });

    const data = await response.json();
    if(data.result.length <= 2) {
      throw new Error('Error fetching symbol from address: ' + address);
    }
    const hexString = data.result.slice(2);
    const relevantHex = hexString.slice(64);
    const lengthHex = relevantHex.slice(0, 64);
    const length = parseInt(lengthHex, 16);
    const stringHex = relevantHex.slice(64, 64 + length * 2);
    const bytes = new Uint8Array(stringHex.match(/.{1,2}/g).map((byte: string) => parseInt(byte, 16)));
    const symbol = new TextDecoder().decode(bytes);
    return(symbol);
  } catch (error) {
    throw new Error('Error fetching symbol: ' + error);
  }
}
