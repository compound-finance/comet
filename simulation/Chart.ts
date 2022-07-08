import { ChartJSNodeCanvas, ChartCallback } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import * as fs from 'fs/promises';
import * as nodepath from 'path';

const RED = 'rgba(237, 105, 104, 0.85)';
const YELLOW = 'rgba(247, 213, 100, 0.85)';
const GREEN = 'rgba(194, 213, 100, 0.85)';

export interface SimulationResults {
  [label: string]: {
    utilization: number;
    totalSupply: number;
    annualProfit: number;
  };
}

function getProfitibilityColor(profitability: number, neutralRange: number) {
  if (profitability > neutralRange) {
    return GREEN;
  } else if (profitability < -neutralRange) {
    return RED;
  } else {
    return YELLOW;
  }
}

function createData(simResults: SimulationResults) {
  const labels = [];
  const dataObject = { data: [], pointRadius: 5, backgroundColor: [] };
  Object.keys(simResults).map(label => {
    labels.push(label);
    dataObject.data.push({
      x: simResults[label].totalSupply,
      y: simResults[label].utilization
    });
    dataObject.backgroundColor.push(getProfitibilityColor(simResults[label].annualProfit, 500_000));
  });
  return { datasets: [dataObject], labels };
}

export async function createChart(simResults: SimulationResults, title?: string): Promise<void> {
  const width = 900;
  const height = 700;

  const totalSupplies = Object.values(simResults).map(result => result.totalSupply);
  const minTotalSupply = Math.min(...totalSupplies);
  const maxTotalSupply = Math.max(...totalSupplies);

  const data = createData(simResults);
  const configuration: ChartConfiguration = {
    type: 'scatter',
    data,
    options: {
      plugins: {
        title: {
          display: title !== undefined,
          text: title ? title : '',
          font: {
            size: 20
          }
        },
        legend: {
          position: 'right',
          labels: {
            generateLabels: function (_chart) {
              return [{
                text: 'Profitable',
                fillStyle: GREEN,
              }, {
                text: 'Neutral (±500K)',
                fillStyle: YELLOW,
              }, {
                text: 'Unprofitable',
                fillStyle: RED,
              }];
            }
          }
        },
        datalabels: {
          align: 'top',
          formatter: function (_value, context) {
            return context.chart.data.labels[context.dataIndex];
          },
          font: {
            weight: 'bold'
          }
        },
      } as any,
      scales: {
        x: {
          type: 'linear',
          position: 'bottom',
          min: Math.floor((minTotalSupply - 50) / 50) * 50,
          max: Math.ceil((maxTotalSupply + 50) / 50) * 50,
          title: {
            display: true,
            text: 'Total Supply (M)',
            font: {
              weight: 'bold',
              size: 16
            },
            padding: 6
          }
        },
        y: {
          type: 'linear',
          min: 0.45,
          max: 0.85,
          title: {
            display: true,
            text: 'Utilization',
            font: {
              weight: 'bold',
              size: 16
            },
            padding: 6
          }
        }
      }
    },
    plugins: [{
      id: 'background-colour',
      beforeDraw: (chart) => {
        const ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      },
    }]
  };
  const chartCallback: ChartCallback = (ChartJS) => {
    ChartJS.defaults.responsive = true;
    ChartJS.defaults.maintainAspectRatio = false;
  };
  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width, height, chartCallback, plugins: {
      requireLegacy: ['chartjs-plugin-datalabels']
    }
  });
  const buffer = await chartJSNodeCanvas.renderToBuffer(configuration);
  const fileName = title ? `${title}.png` : 'chart.png';
  const path = nodepath.join(process.cwd(), 'simulation', 'charts', fileName);
  const dir = nodepath.dirname(path);
  if (!(await fileExists(dir))) {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(path, buffer, 'base64');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch (e) {
    return false;
  }
}