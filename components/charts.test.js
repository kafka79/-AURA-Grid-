// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DashboardCharts } from './charts.js';

describe('DashboardCharts Presentation Layer', () => {
  beforeEach(() => {
    // Setup minimal DOM for charts
    document.body.innerHTML = `
      <div id="chart-live"></div>
      <div id="chart-donut"></div>
    `;
    
    // Mock dynamic import for apexcharts to prevent actual network/resolution
    vi.mock('apexcharts', () => {
      return {
        default: class MockApexCharts {
          constructor(el, options) {}
          render() { return Promise.resolve(); }
          updateSeries() { return Promise.resolve(); }
          destroy() {}
        }
      };
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('should render loading skeletons before ApexCharts loads', () => {
    const charts = new DashboardCharts('#chart-live', '#chart-donut');
    
    // Since init() is async and we just started it, the skeletons should be immediately present
    const liveContainer = document.getElementById('chart-live');
    const donutContainer = document.getElementById('chart-donut');
    
    expect(liveContainer.innerHTML).toContain('chart-skeleton');
    expect(donutContainer.innerHTML).toContain('chart-skeleton');
  });
  
  it('should initialize history buffers with correct lengths', () => {
    const charts = new DashboardCharts('#chart-live', '#chart-donut');
    expect(charts.historyMaxLength).toBe(40);
    expect(charts.solarHistory).toEqual([]);
    expect(charts.gridHistory).toEqual([]);
  });
});
