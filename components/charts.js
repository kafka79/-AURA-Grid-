export class DashboardCharts {
  constructor(liveChartId, donutChartId) {
    this.liveChartId = liveChartId;
    this.donutChartId = donutChartId;

    this.liveChart = null;
    this.donutChart = null;

    // Historical buffer for live trend line chart
    this.historyMaxLength = 40;
    this.solarHistory = [];
    this.gridHistory = [];
    this.timeOffset = 0;

    // Rolling 24-hour log buffer for hourly averages
    this.hourlySolarHistory = [];
    this.hourlyGridHistory = [];
    this.currentMode = 'live';
    this.lastHourInt = null;
    this.hourlyAccumulator = { solar: [], grid: [] };

    this.init();
  }

  async init() {
    try {
      // Add loading skeleton
      const liveContainer = document.querySelector(this.liveChartId);
      const donutContainer = document.querySelector(this.donutChartId);
      if (liveContainer) liveContainer.innerHTML = '<div class="chart-skeleton">Loading...</div>';
      if (donutContainer) donutContainer.innerHTML = '<div class="chart-skeleton">Loading...</div>';

      const module = await import('apexcharts');
      const ApexCharts = module.default || module;

      // Clear skeleton
      if (liveContainer) liveContainer.innerHTML = '';
      if (donutContainer) donutContainer.innerHTML = '';


      // Initialize Live Energy Trend Chart
    const liveChartOptions = {
      series: [
        {
          name: 'Solar Output',
          data: this.solarHistory,
          color: '#06b6d4',
        },
        {
          name: 'Grid Demand',
          data: this.gridHistory,
          color: '#3b82f6',
        },
      ],
      chart: {
        type: 'area',
        height: 240,
        toolbar: { show: false },
        animations: {
          enabled: true,
          easing: 'linear',
          dynamicAnimation: { speed: 800 },
        },
        background: 'transparent',
        foreColor: '#9ca3af',
      },
      dataLabels: { enabled: false },
      stroke: {
        curve: 'smooth',
        width: 2.5,
      },
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.35,
          opacityTo: 0.02,
          stops: [0, 95, 100],
        },
      },
      grid: {
        borderColor: 'rgba(255, 255, 255, 0.05)',
        strokeDashArray: 4,
        xaxis: { lines: { show: false } },
        yaxis: { lines: { show: true } },
      },
      xaxis: {
        type: 'numeric',
        tickAmount: 4,
        labels: {
          style: {
            fontFamily: 'Inter, sans-serif',
            fontSize: '10px',
          },
          formatter: (value) => {
            if (value === undefined || value === null) return '';
            const normalized = ((parseFloat(value) % 24) + 24) % 24;
            const hours = Math.floor(normalized);
            const minutes = Math.floor((normalized - hours) * 60);
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 === 0 ? 12 : hours % 12;
            const minStr = minutes < 10 ? '0' + minutes : minutes;
            return `${displayHours}:${minStr} ${ampm}`;
          },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          formatter: (value) => `${value.toFixed(0)} kW`,
          style: {
            fontFamily: 'Inter, sans-serif',
            fontSize: '10px',
          },
        },
      },
      tooltip: {
        theme: 'dark',
        x: { show: true },
        y: {
          formatter: (value) => `${value.toFixed(1)} kW`,
        },
      },
      legend: {
        position: 'top',
        horizontalAlign: 'right',
        labels: { colors: '#f9fafb' },
        fontFamily: 'Space Grotesk, sans-serif',
        fontSize: '12px',
      },
    };

    const liveChartEl = document.getElementById(this.liveChartId);
    if (liveChartEl) {
      this.liveChart = new ApexCharts(liveChartEl, liveChartOptions);
      this.liveChart.render();
    }

    // Initialize Category Breakdown Donut Chart
    const donutChartOptions = {
      series: [40, 20, 30, 10],
      labels: ['HVAC Cooling/Heating', 'Lighting Systems', 'Equipment & Labs', 'Servers & Infrastructure'],
      chart: {
        type: 'donut',
        height: 220,
        background: 'transparent',
        foreColor: '#9ca3af',
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
                offsetY: -5,
              },
              value: {
                show: true,
                fontSize: '18px',
                fontFamily: 'Space Grotesk, sans-serif',
                fontWeight: 600,
                color: '#f9fafb',
                offsetY: 5,
                formatter: (val) => `${val}%`,
              },
              total: {
                show: true,
                label: 'System Load',
                color: '#9ca3af',
                formatter: () => '100%',
              },
            },
          },
        },
      },
      colors: ['#06b6d4', '#10b981', '#f59e0b', '#3b82f6'],
      dataLabels: { enabled: false },
      legend: { show: false },
      stroke: {
        show: true,
        colors: ['rgba(15, 23, 42, 0.9)'],
        width: 2,
      },
      tooltip: {
        theme: 'dark',
        y: {
          formatter: (value) => `${value}% of total`,
        },
      },
    };

    const donutChartEl = document.getElementById(this.donutChartId);
    if (donutChartEl) {
      this.donutChart = new ApexCharts(donutChartEl, donutChartOptions);
      this.donutChart.render();
    }

    // Render any data that accumulated while the library was downloading
    this.renderCurrentModeSeries();

    } catch(e) {
      console.error("[AURA Grid] Failed to load ApexCharts:", e);
    }
  }

  // Initialize history buffers from pre-simulated state
  initializeHistory(history) {
    if (!history) return;

    this.solarHistory = history.solarHistory || [];
    this.gridHistory = history.gridHistory || [];
    this.hourlySolarHistory = history.hourlySolarHistory || [];
    this.hourlyGridHistory = history.hourlyGridHistory || [];
    this.timeOffset = history.timeOffset || 0;
    this.lastHourInt = history.lastHourInt ?? null;
    this.hourlyAccumulator = history.hourlyAccumulator || { solar: [], grid: [] };

    this.renderCurrentModeSeries();
  }

  updateLiveHistory(solarKW, gridKW, decimalTime) {
    if (!this.liveChart) return;

    let isDiscontinuity = false;
    if (this.solarHistory.length > 0) {
      const prevX = this.solarHistory[this.solarHistory.length - 1].x;
      const prevTimeOfDay = prevX - this.timeOffset;
      const diff = decimalTime - prevTimeOfDay;

      if (diff < 0) {
        if (prevTimeOfDay > 23.0 && decimalTime < 1.0) {
          this.timeOffset += 24;
        } else {
          isDiscontinuity = true;
        }
      } else if (diff > 1.0) {
        isDiscontinuity = true;
      }
    }

    if (isDiscontinuity) {
      this.reset(decimalTime);
    } else {
      const xVal = decimalTime + this.timeOffset;
      this.solarHistory.push({ x: xVal, y: solarKW });
      this.gridHistory.push({ x: xVal, y: gridKW });

      if (this.solarHistory.length > this.historyMaxLength) {
        this.solarHistory.shift();
        this.gridHistory.shift();
      }

      // Hourly accumulation - use wall-clock hour, not simulation time
      // Track by integer hour of simulation time
      const currentHourInt = Math.floor(decimalTime);
      if (this.lastHourInt === null) {
        this.lastHourInt = currentHourInt;
        this.hourlyAccumulator = { solar: [], grid: [] };
      }

      this.hourlyAccumulator.solar.push(solarKW);
      this.hourlyAccumulator.grid.push(gridKW);

      if (currentHourInt !== this.lastHourInt) {
        if (this.hourlyAccumulator.solar.length > 0) {
          const avgSolar = this.hourlyAccumulator.solar.reduce((a, b) => a + b, 0) / this.hourlyAccumulator.solar.length;
          const avgGrid = this.hourlyAccumulator.grid.reduce((a, b) => a + b, 0) / this.hourlyAccumulator.grid.length;

          const xHourVal = this.lastHourInt + this.timeOffset;
          this.hourlySolarHistory.push({ x: xHourVal, y: avgSolar });
          this.hourlyGridHistory.push({ x: xHourVal, y: avgGrid });

          if (this.hourlySolarHistory.length > 24) {
            this.hourlySolarHistory.shift();
            this.hourlyGridHistory.shift();
          }
        }

        this.lastHourInt = currentHourInt;
        this.hourlyAccumulator = { solar: [solarKW], grid: [gridKW] };
      }

      this.renderCurrentModeSeries();
    }
  }

  renderCurrentModeSeries() {
    if (!this.liveChart) return;
    const isLive = this.currentMode === 'live';
    const solarData = isLive ? this.solarHistory : this.hourlySolarHistory;
    const gridData = isLive ? this.gridHistory : this.hourlyGridHistory;

    this.liveChart.updateSeries([
      {
        name: isLive ? 'Solar Output' : 'Avg Solar Output',
        data: solarData,
      },
      {
        name: isLive ? 'Grid Demand' : 'Avg Grid Demand',
        data: gridData,
      },
    ], true);
  }

  setMode(mode) {
    if (mode === 'live' || mode === '24h') {
      this.currentMode = mode;
      this.renderCurrentModeSeries();
    }
  }

  reset(startHour = 10.0) {
    this.solarHistory = [];
    this.gridHistory = [];
    this.hourlySolarHistory = [];
    this.hourlyGridHistory = [];
    this.timeOffset = 0;
    this.lastHourInt = null;
    this.hourlyAccumulator = { solar: [], grid: [] };

    const interval = 0.08;
    for (let i = 0; i < this.historyMaxLength; i++) {
      const x = startHour - (this.historyMaxLength - 1 - i) * interval;
      this.solarHistory.push({ x: x, y: 0 });
      this.gridHistory.push({ x: x, y: 0 });
    }

    for (let i = 0; i < 24; i++) {
      const x = startHour - (24 - 1 - i) * 1.0;
      this.hourlySolarHistory.push({ x: x, y: 0 });
      this.hourlyGridHistory.push({ x: x, y: 0 });
    }

    this.renderCurrentModeSeries();
  }

  updateCategoryData(breakdownObj) {
    if (!this.donutChart || !breakdownObj) return;

    const hvacVal = Math.round(breakdownObj.hvac);
    const lightsVal = Math.round(breakdownObj.lights);
    const equipVal = Math.round(breakdownObj.equipment);
    const servVal = Math.round(breakdownObj.servers);

    const currentSeries = this.donutChart.w.config.series;
    if (
      currentSeries &&
      currentSeries[0] === hvacVal &&
      currentSeries[1] === lightsVal &&
      currentSeries[2] === equipVal &&
      currentSeries[3] === servVal
    ) {
      return;
    }

    this.donutChart.updateSeries([hvacVal, lightsVal, equipVal, servVal]);
  }
}