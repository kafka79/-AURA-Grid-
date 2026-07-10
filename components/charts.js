export class DashboardCharts {
  constructor(liveChartId, donutChartId) {
    this.liveChartId = liveChartId;
    this.donutChartId = donutChartId;
    
    this.liveChart = null;
    this.donutChart = null;
    
    // Historical buffer for line chart (last 15 data points)
    this.historyMaxLength = 15;
    this.solarHistory = [];
    this.gridHistory = [];
    this.timeOffset = 0;

    // Pre-populate buffer with empty coordinates so the chart has initial axes
    const startHour = 10.0;
    const interval = 0.08;
    for (let i = 0; i < this.historyMaxLength; i++) {
      const x = startHour - (this.historyMaxLength - 1 - i) * interval;
      this.solarHistory.push({ x: x, y: 0 });
      this.gridHistory.push({ x: x, y: 0 });
    }
    
    this.init();
  }

  init() {
    // Graceful fallback if ApexCharts library failed to load (e.g. offline or CDN outage)
    if (typeof window.ApexCharts === 'undefined') {
      console.warn("ApexCharts library not found. Rendering fallback container.");
      
      const setupFallback = (containerId, title) => {
        const container = document.getElementById(containerId);
        if (container) {
          container.innerHTML = `
            <div class="chart-fallback-placeholder" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 180px; color: var(--text-secondary); text-align: center; border: 1px dashed var(--border-light); border-radius: 8px; padding: 20px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-amber)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 8px;"><path d="m19 12-5 5-4-4-3 3"/><path d="M3 3v18h18"/></svg>
              <span style="font-family: var(--font-display); font-size: 0.9rem; font-weight: 500; color: var(--text-primary);">${title} Offline</span>
              <span style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Could not load charting library. Live updates simulated in stats panel.</span>
            </div>
          `;
        }
      };

      setupFallback(this.liveChartId, 'Live Energy Trend Chart');
      setupFallback(this.donutChartId, 'System Load Breakdown Donut');

      this.liveChart = null;
      this.donutChart = null;
      return;
    }

    // 1. Initialize Live Energy Trend Chart
    const liveChartOptions = {
      series: [
        {
          name: 'Solar Output',
          data: this.solarHistory,
          color: '#06b6d4'
        },
        {
          name: 'Grid Demand',
          data: this.gridHistory,
          color: '#3b82f6'
        }
      ],
      chart: {
        type: 'area',
        height: 240,
        toolbar: { show: false },
        animations: {
          enabled: true,
          easing: 'linear',
          dynamicAnimation: { speed: 800 }
        },
        background: 'transparent',
        foreColor: '#9ca3af'
      },
      dataLabels: { enabled: false },
      stroke: {
        curve: 'smooth',
        width: 2.5
      },
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.35,
          opacityTo: 0.02,
          stops: [0, 95, 100]
        }
      },
      grid: {
        borderColor: 'rgba(255, 255, 255, 0.05)',
        strokeDashArray: 4,
        xaxis: { lines: { show: false } },
        yaxis: { lines: { show: true } }
      },
      xaxis: {
        type: 'numeric',
        tickAmount: 4,
        labels: {
          style: {
            fontFamily: 'Inter, sans-serif',
            fontSize: '10px'
          },
          formatter: (value) => {
            if (value === undefined || value === null) return '';
            // Wrap decimal time back into 24 hour range
            const normalized = ((parseFloat(value) % 24) + 24) % 24;
            const hours = Math.floor(normalized);
            const minutes = Math.floor((normalized - hours) * 60);
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 === 0 ? 12 : hours % 12;
            const minStr = minutes < 10 ? '0' + minutes : minutes;
            return `${displayHours}:${minStr} ${ampm}`;
          }
        },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      yaxis: {
        labels: {
          formatter: (value) => `${value.toFixed(0)} kW`,
          style: {
            fontFamily: 'Inter, sans-serif',
            fontSize: '10px'
          }
        }
      },
      tooltip: {
        theme: 'dark',
        x: { show: true },
        y: {
          formatter: (value) => `${value.toFixed(1)} kW`
        }
      },
      legend: {
        position: 'top',
        horizontalAlign: 'right',
        labels: { colors: '#f9fafb' },
        fontFamily: 'Space Grotesk, sans-serif',
        fontSize: '12px'
      }
    };

    this.liveChart = new ApexCharts(document.getElementById(this.liveChartId), liveChartOptions);
    this.liveChart.render();

    // 2. Initialize Category Breakdown Donut Chart
    const donutChartOptions = {
      series: [40, 20, 30, 10], // Initial values
      labels: ['HVAC Cooling/Heating', 'Lighting Systems', 'Equipment & Labs', 'Servers & Infrastructure'],
      chart: {
        type: 'donut',
        height: 220,
        background: 'transparent',
        foreColor: '#9ca3af'
      },
      plotOptions: {
        pie: {
          donut: {
            size: '72%',
            labels: {
              show: true,
              name: {
                show: true,
                fontSize: '12px',
                fontFamily: 'Space Grotesk, sans-serif',
                color: '#9ca3af',
                offsetY: -5
              },
              value: {
                show: true,
                fontSize: '18px',
                fontFamily: 'Space Grotesk, sans-serif',
                fontWeight: 600,
                color: '#f9fafb',
                offsetY: 5,
                formatter: (val) => `${val}%`
              },
              total: {
                show: true,
                label: 'System Load',
                color: '#9ca3af',
                formatter: function (w) {
                  return '100%';
                }
              }
            }
          }
        }
      },
      colors: ['#06b6d4', '#10b981', '#f59e0b', '#3b82f6'],
      dataLabels: { enabled: false },
      legend: {
        show: false
      },
      stroke: {
        show: true,
        colors: ['rgba(15, 23, 42, 0.9)'],
        width: 2
      },
      tooltip: {
        theme: 'dark',
        y: {
          formatter: (value) => `${value}% of total`
        }
      }
    };

    this.donutChart = new ApexCharts(document.getElementById(this.donutChartId), donutChartOptions);
    this.donutChart.render();
  }

  updateLiveHistory(solarKW, gridKW, decimalTime) {
    if (!this.liveChart) return; // ponytail: check if chart initialized
    
    let isDiscontinuity = false;
    if (this.solarHistory.length > 0) {
      const prevX = this.solarHistory[this.solarHistory.length - 1].x;
      const prevTimeOfDay = prevX - this.timeOffset;
      const diff = decimalTime - prevTimeOfDay;
      
      if (diff < 0) {
        if (prevTimeOfDay > 23.0 && decimalTime < 1.0) {
          // Wrapped around midnight! Offset to prevent reverse line tracing
          this.timeOffset += 24;
        } else {
          isDiscontinuity = true;
        }
      } else if (diff > 1.0) {
        // Large forward jump
        isDiscontinuity = true;
      }
    }

    if (isDiscontinuity) {
      // ponytail: reset chart history on manual time jump to prevent graph corruption
      this.solarHistory = [];
      this.gridHistory = [];
      this.timeOffset = 0;
      const startHour = decimalTime;
      const interval = 0.08;
      for (let i = 0; i < this.historyMaxLength; i++) {
        const x = startHour - (this.historyMaxLength - 1 - i) * interval;
        this.solarHistory.push({ x: x, y: 0 });
        this.gridHistory.push({ x: x, y: 0 });
      }
    }

    const xVal = decimalTime + this.timeOffset;
    this.solarHistory.push({ x: xVal, y: solarKW });
    this.gridHistory.push({ x: xVal, y: gridKW });

    if (this.solarHistory.length > this.historyMaxLength) {
      this.solarHistory.shift();
      this.gridHistory.shift();
    }

    // High-performance direct updateSeries invocation (completely bypasses updateOptions rebuilding)
    this.liveChart.updateSeries([
      {
        name: 'Solar Output',
        data: this.solarHistory
      },
      {
        name: 'Grid Demand',
        data: this.gridHistory
      }
    ], true);
  }

  updateCategoryData(breakdownObj) {
    if (!this.donutChart || !breakdownObj) return; // ponytail: check if chart initialized
    
    const hvacVal = Math.round(breakdownObj.hvac);
    const lightsVal = Math.round(breakdownObj.lights);
    const equipVal = Math.round(breakdownObj.equipment);
    const servVal = Math.round(breakdownObj.servers);

    // Compare with current values to avoid unnecessary DOM/chart updates
    const currentSeries = this.donutChart.w.config.series;
    if (
      currentSeries &&
      currentSeries[0] === hvacVal &&
      currentSeries[1] === lightsVal &&
      currentSeries[2] === equipVal &&
      currentSeries[3] === servVal
    ) {
      return; // No change, skip update
    }

    this.donutChart.updateSeries([hvacVal, lightsVal, equipVal, servVal]);
  }
}
