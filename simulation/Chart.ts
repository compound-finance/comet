import { ChartJSNodeCanvas, ChartCallback } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import * as fs from 'fs/promises';
import * as nodepath from 'path';

export interface SimulationResults {
  [label: string]: {
    utilization: number,
    totalSupply: number,
    annualProfit: number,
  }
};

// XXX try to convey profitability as well
function createData(simResults: SimulationResults) {
  const colors = [
    'rgba(255, 99, 132, 0.85)',
    'rgba(54, 162, 235, 0.85)',
    'rgba(255, 206, 86, 0.85)',
    'rgba(75, 192, 192, 0.85)',
    'rgba(153, 102, 255, 0.85)',
    'rgba(255, 159, 64, 0.85)'
  ];
  const datasets = Object.keys(simResults).map((label, i) => {
    return {
      label,
      data: [{
        x: simResults[label].totalSupply,
        y: simResults[label].utilization
      }],
      pointRadius: 5,
      backgroundColor: [colors[i]]
    }
  });
  return { datasets };
}

export async function createChart(simResults: SimulationResults, title?: string): Promise<void> {
  const width = 800;
  const height = 600;
  const data = createData(simResults);

  const configuration: ChartConfiguration = {
    type: 'scatter',
    data,
    options: {
      plugins: {
        title: {
          display: title !== undefined,
          text: title ? title : ''
        },
        legend: {
          position: 'right'
        }
      },
      scales: {
        x: {
          type: 'linear',
          position: 'bottom',
          title: {
            display: true,
            text: 'Total Supply (M)'
          }
        },
        y: {
          type: 'linear',
          min: 0.45,
          max: 0.85,
          title: {
            display: true,
            text: 'Utilization'
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
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, chartCallback });
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