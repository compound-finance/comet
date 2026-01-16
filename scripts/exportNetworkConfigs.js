const fs = require('fs');
const path = require('path');
const dotenv  = require('dotenv');

dotenv.config();

const configPath = path.resolve(__dirname, '../hardhat.config.ts');
const outputPath = path.resolve(__dirname, '../.env.forge-temp');

const fileContent = fs.readFileSync(configPath, 'utf-8');

const match = fileContent.match(/export\s+const\s+networkConfigs\s*:\s*[^\=]+\s*=\s*(\[[\s\S]*?\]);/);
if (!match) {
  console.error('❌ Cannot find `networkConfigs` in hardhat.config.ts');
  process.exit(1);
}

let configs;
try {
  // Replace any variable references (e.g., ANKR_KEY) with their values from process.env
  const replaced = match[1].replace(/\b([A-Z0-9_]+)\b/g, (m) => {
    if (process.env[m] !== undefined) return JSON.stringify(process.env[m]);
    return m;
  });
  configs = eval(replaced);
} catch (e) {
  console.error('❌ Failed to parse networkConfigs:', e);
  process.exit(1);
}

function getUrl(network) {
  const config = configs.find(cfg => cfg.network === network);
  return config ? config.url : '';
}

const envVar = {
  SALT: process.env.SALT || 'comet',
  MAINNET_QUICKNODE_LINK: getUrl('mainnet'),
  POLYGON_QUICKNODE_LINK: getUrl('polygon'),
  ARBITRUM_QUICKNODE_LINK: getUrl('arbitrum'),
  OPTIMISM_QUICKNODE_LINK: getUrl('optimism'),
  SCROLL_RPC_URL: getUrl('scroll'),
  BASE_QUICKNODE_LINK: getUrl('base'),
  SEPOLIA_RPC_URL: getUrl('sepolia'),
  MANTLE_QUICKNODE_LINK: getUrl('mantle'),
};

const envString = Object.entries(envVar)
  .map(([k, v]) => `${k}=${v}`)
  .join('\n');

fs.writeFileSync(outputPath, envString);
console.log('✔ Exported networkConfigs to .env.forge-temp');
