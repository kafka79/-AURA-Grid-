export class DashboardCharts {
  constructor(liveChartId, donutChartId) {
    this.liveChartId = liveChartId;
    this.donutChartId = donutChartId;
    
    this.liveChart = null;
    this.donutChart = null;
    
    // Historical buffer for line chart (last 15 data points)
    this.historyMaxLength = 15;
    this.solarHistory = Array(this.historyMaxLength).fill(0);
    this.gridHistory = Array(this.historyMaxLength).fill(0);
    this.timeLabelsHistory = Array(this.historyMaxLength).fill('');
    
    this.init();
  }

  init() {
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
        categories: this.timeLabelsHistory,
        labels: {
          style: {
            fontFamily: 'Inter, sans-serif',
            fontSize: '10px'
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

  updateLiveHistory(solarKW, gridKW, timeStr) {
    // Slide values to left
    this.solarHistory.shift();
    this.solarHistory.push(solarKW);

    this.gridHistory.shift();
    this.gridHistory.push(gridKW);

    this.timeLabelsHistory.shift();
    // Crop time string to display hours:minutes
    const shortTime = timeStr.replace(' AM', '').replace(' PM', '');
    this.timeLabelsHistory.push(shortTime);

    // OPTIMIZATION: Update both categories and series in one single call.
    // This prevents double redraw cycles and layout thrashing in ApexCharts.
    this.liveChart.updateOptions({
      xaxis: {
        categories: this.timeLabelsHistory
      },
      series: [
        {
          name: 'Solar Output',
          data: this.solarHistory
        },
        {
          name: 'Grid Demand',
          data: this.gridHistory
        }
      ]
    }, false, true);
  }

  updateCategoryData(breakdownObj) {
    if (!breakdownObj) return;
    
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
