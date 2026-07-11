import { SimulationEngine } from './components/simulator.js';
import { CampusMap } from './components/map.js';
import { DashboardCharts } from './components/charts.js';
import { AlertManager } from './components/alerts.js';

class AppController {
  constructor() {
    this.engine = new SimulationEngine();
    this.destroyed = false;

    // Cache of rendered values to eliminate DOM reads
    this.renderedCache = new Map();

    this.map = null;
    this.charts = null;
    this.alertsManager = null;
    
    this.selectedBuildingId = null;
    this.simSpeed = 0.08; // Fraction of hours to advance per tick
    
    // Timer details
    this.tickInterval = 1200; // ms
    this.lastTickTime = performance.now();
    this.timer = null;
    
    // Ranks tracker to prevent leaderboard layout thrashing
    this.lastRanksOrder = '';

    // Cache elements
    this.cacheDOM();

    // Initialize Components and state subscriptions
    this.init();
  }

  cacheDOM() {
    this.dom = {
      timeInput: document.getElementById('input-time'),
      tempInput: document.getElementById('input-temp'),
      occupancyInput: document.getElementById('input-occupancy'),
      smartGridInput: document.getElementById('input-smart-grid'),
      
      labelTime: document.getElementById('label-time'),
      sliderLabelTime: document.getElementById('slider-label-time'),
      labelTemp: document.getElementById('label-temp'), // null or slider label
      sliderLabelTemp: document.getElementById('slider-label-temp'),
      labelOccupancy: document.getElementById('label-occupancy'), // null or slider label
      sliderLabelOccupancy: document.getElementById('slider-label-occupancy'),
      
      totalLoad: document.getElementById('metric-total-load'),
      gridDemand: document.getElementById('metric-grid-demand'),
      solar: document.getElementById('metric-solar'),
      battery: document.getElementById('metric-battery'),
      carbon: document.getElementById('metric-carbon'),
      alertsCount: document.getElementById('metric-alerts'),
      alertsIconContainer: document.getElementById('metric-alerts-container'),
      batteryProgress: document.getElementById('battery-charge-progress'),
      
      overlay: document.getElementById('detail-overlay'),
      detailTitle: document.getElementById('detail-title'),
      detailStatus: document.getElementById('detail-status'),
      detailLoad: document.getElementById('detail-load'),
      detailCapacity: document.getElementById('detail-capacity'),
      detailOccupancy: document.getElementById('detail-occupancy'),
      detailTemp: document.getElementById('detail-temp'),
      
      leaderboardList: document.getElementById('leaderboard-list'),
      weatherBtns: document.querySelectorAll('.weather-btn'),
      resetBtn: document.getElementById('btn-reset-grid'),
      gridStatusText: document.getElementById('grid-status-text'),
      chartLiveBtn: document.getElementById('btn-chart-live'),
      chart24hBtn: document.getElementById('btn-chart-24h')
    };
  }

  init() {
    this.map = new CampusMap('map-container', (id) => this.handleBuildingSelect(id));
    this.charts = new DashboardCharts('live-chart', 'donut-chart');
    this.alertsManager = new AlertManager('alerts-list', (id) => this.handleAlertResolve(id));

    this.bindCockpitEvents();

    // Subscribe to engine state notifications
    this.unsubscribe = this.engine.subscribe((state) => {
      this.state = state;
      this.tick();
    });

    // Start Simulation Loop
    this.startSimulation();
  }

  bindCockpitEvents() {
    this.dom.timeInput.addEventListener('input', (e) => {
      this.engine.updateState(state => {
        state.timeOfDay = parseFloat(e.target.value);
      });
    });

    this.dom.tempInput.addEventListener('input', (e) => {
      this.engine.updateState(state => {
        state.temperature = parseInt(e.target.value);
      });
    });

    this.dom.occupancyInput.addEventListener('input', (e) => {
      this.engine.updateState(state => {
        state.occupancy = parseInt(e.target.value);
      });
    });

    this.dom.weatherBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.weatherBtns.forEach(b => {
          if (b !== btn) b.classList.remove('active');
        });
        btn.classList.add('active');
        this.engine.updateState(state => {
          state.weather = btn.getAttribute('data-weather');
        });
      });
    });

    this.dom.smartGridInput.addEventListener('change', (e) => {
      this.engine.updateState(state => {
        state.smartGridActive = e.target.checked;
      });
    });

    this.dom.resetBtn.addEventListener('click', () => {
      this.engine.reset();
      if (this.charts) {
        this.charts.reset(this.state.timeOfDay);
      }
    });

    if (this.dom.chartLiveBtn && this.dom.chart24hBtn) {
      this.dom.chartLiveBtn.addEventListener('click', () => {
        this.dom.chartLiveBtn.classList.add('active');
        this.dom.chart24hBtn.classList.remove('active');
        if (this.charts) this.charts.setMode('live');
      });

      this.dom.chart24hBtn.addEventListener('click', () => {
        this.dom.chart24hBtn.classList.add('active');
        this.dom.chartLiveBtn.classList.remove('active');
        if (this.charts) this.charts.setMode('24h');
      });
    }
  }

  startSimulation() {
    this.lastTickTime = performance.now();
    this.timer = setInterval(() => {
      if (this.destroyed) return;
      const now = performance.now();
      const elapsedMs = now - this.lastTickTime;
      this.lastTickTime = now;
      
      // Calculate hours advanced, ensuring exact physics mapping over the interval
      const elapsedHours = (elapsedMs / this.tickInterval) * this.simSpeed;
      this.engine.stepSimulation(elapsedHours);
    }, this.tickInterval);
  }

  handleBuildingSelect(id) {
    this.selectedBuildingId = id;
    this.updateBuildingDetailView();
    this.updateCategoryDonut();
  }

  handleAlertResolve(alertId) {
    this.engine.updateState(state => {
      const alert = state.alerts.find(a => a.id === alertId);
      if (alert && !alert.resolved) {
        alert.resolved = true;
        // Perform simulated correction shifts physically
        const actionId = alert.actionId;
        if (actionId === 'optimize-library-hvac') {
          if (state.buildings['building-library']) {
            state.buildings['building-library'].hvacSet = 23;
          }
        } else if (actionId === 'optimize-temp-limit') {
          Object.keys(state.buildings).forEach(id => {
            if (state.buildings[id]) {
              state.buildings[id].hvacSet += 2;
            }
          });
        } else if (actionId === 'shed-engineering-labs') {
          if (state.buildings['building-engineering']) {
            state.buildings['building-engineering'].baseLoad = 35;
          }
        }
      }
    });
  }

  updateDOMText(element, value) {
    if (element) {
      const cached = this.renderedCache.get(element);
      if (cached !== value) {
        element.textContent = value;
        this.renderedCache.set(element, value);
      }
    }
  }

  updateDOMHTML(element, value) {
    if (element) {
      const cached = this.renderedCache.get(element);
      if (cached !== value) {
        element.innerHTML = value;
        this.renderedCache.set(element, value);
      }
    }
  }

  tick() {
    if (!this.state) return;

    // Sync input sliders to state
    if (this.dom.timeInput && parseFloat(this.dom.timeInput.value).toFixed(1) !== this.state.timeOfDay.toFixed(1)) {
      this.dom.timeInput.value = this.state.timeOfDay;
    }
    if (this.dom.tempInput && parseInt(this.dom.tempInput.value) !== this.state.temperature) {
      this.dom.tempInput.value = this.state.temperature;
    }
    if (this.dom.occupancyInput && parseInt(this.dom.occupancyInput.value) !== this.state.occupancy) {
      this.dom.occupancyInput.value = this.state.occupancy;
    }
    if (this.dom.smartGridInput) {
      this.dom.smartGridInput.checked = this.state.smartGridActive;
    }

    // Sync weather button classes
    this.dom.weatherBtns.forEach(btn => {
      const active = btn.getAttribute('data-weather') === this.state.weather;
      if (active) {
        if (!btn.classList.contains('active')) btn.classList.add('active');
      } else {
        if (btn.classList.contains('active')) btn.classList.remove('active');
      }
    });

    // Format simulation times
    const hours = Math.floor(this.state.timeOfDay);
    const minutes = Math.floor((this.state.timeOfDay - hours) * 60);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    const minStr = minutes < 10 ? '0' + minutes : minutes;
    const timeText = `${displayHours}:${minStr} ${ampm}`;

    this.updateDOMText(this.dom.labelTime, timeText);
    this.updateDOMText(this.dom.sliderLabelTime, timeText);

    this.updateDOMText(this.dom.sliderLabelTemp, `${this.state.temperature}°C`);
    this.updateDOMText(this.dom.sliderLabelOccupancy, `${this.state.occupancy}%`);

    // Sum building loads dynamically
    let totalCampusLoad = 0;
    Object.keys(this.state.buildings).forEach(id => {
      const b = this.state.buildings[id];
      if (b) totalCampusLoad += b.load;
    });

    // Update main KPI statistics
    this.updateDOMText(this.dom.totalLoad, `${totalCampusLoad.toFixed(1)} kW`);
    this.updateDOMText(this.dom.gridDemand, `${this.state.gridDemand.toFixed(1)} kW`);
    this.updateDOMText(this.dom.solar, `${this.state.solarGeneration.toFixed(1)} kW`);
    this.updateDOMText(this.dom.battery, `${Math.round(this.state.batteryCharge)}%`);
    this.updateDOMText(this.dom.carbon, `${this.state.accumulatedCarbonSaved.toFixed(1)} kg`);

    const activeAlertsList = this.state.alerts.filter(a => !a.resolved);
    const activeAlertsCount = activeAlertsList.length;
    this.updateDOMText(this.dom.alertsCount, activeAlertsCount.toString());

    // Update header status badge dynamically based on warnings/alerts
    if (this.dom.gridStatusText) {
      const hasCritical = activeAlertsList.some(a => a.level === 'critical');
      const hasWarning = activeAlertsList.some(a => a.level === 'warning');
      if (hasCritical) {
        this.dom.gridStatusText.textContent = 'Grid Status: Critical Stress';
        this.dom.gridStatusText.style.color = 'var(--color-red)';
      } else if (hasWarning) {
        this.dom.gridStatusText.textContent = 'Grid Status: Stressed';
        this.dom.gridStatusText.style.color = 'var(--color-amber)';
      } else {
        this.dom.gridStatusText.textContent = 'Grid Status: Nominal';
        this.dom.gridStatusText.style.color = 'var(--text-secondary)';
      }
    }

    if (this.dom.alertsIconContainer) {
      if (activeAlertsCount > 0) {
        const hasCritical = activeAlertsList.some(a => a.level === 'critical');
        this.dom.alertsIconContainer.className = hasCritical ? 'pulse-dot red' : 'pulse-dot amber';
      } else {
        this.dom.alertsIconContainer.className = 'pulse-dot green';
      }
    }

    // Battery progress styling updates
    if (this.dom.batteryProgress) {
      const chargePct = `${this.state.batteryCharge}%`;
      if (this.dom.batteryProgress.style.width !== chargePct) {
        this.dom.batteryProgress.style.width = chargePct;
      }

      let colorVal = 'var(--color-green)';
      if (this.state.batteryCharge < 20) {
        colorVal = 'var(--color-red)';
      } else if (this.state.batteryCharge < 45) {
        colorVal = 'var(--color-amber)';
      }
      
      if (this.dom.batteryProgress.style.backgroundColor !== colorVal) {
        this.dom.batteryProgress.style.backgroundColor = colorVal;
      }
    }

    // Render alerts list and map states
    this.map.updateMapStates(this.state.buildings, this.state.solarGeneration);
    this.alertsManager.render(this.state.alerts);

    this.updateBuildingDetailView();
    this.updateLeaderboard();
    this.updateCategoryDonut();

    // Stream charts historical buffer
    this.charts.updateLiveHistory(
      this.state.solarGeneration,
      this.state.gridDemand,
      this.state.timeOfDay
    );
  }

  updateBuildingDetailView() {
    if (!this.selectedBuildingId || this.selectedBuildingId === 'solar-farm' || this.selectedBuildingId === 'substation') {
      if (this.dom.overlay.classList.contains('active')) {
        this.dom.overlay.classList.remove('active');
      }
      return;
    }

    const b = this.state.buildings[this.selectedBuildingId];
    if (!b) return;

    if (!this.dom.overlay.classList.contains('active')) {
      this.dom.overlay.classList.add('active');
    }

    let badgeClass = 'normal';
    if (b.state === 'peak') badgeClass = 'peak';
    if (b.state === 'critical') badgeClass = 'warning';

    this.updateDOMText(this.dom.detailTitle, b.name);
    
    const badgeHTML = `<span class="detail-badge ${badgeClass}">${b.state}</span>`;
    this.updateDOMHTML(this.dom.detailStatus, badgeHTML);
    
    this.updateDOMText(this.dom.detailLoad, `${b.load.toFixed(1)} kW`);
    this.updateDOMText(this.dom.detailCapacity, `${b.maxCapacity} kW`);
    this.updateDOMText(this.dom.detailOccupancy, `${Math.round(b.occupancyRatio * 100)}%`);
    this.updateDOMText(this.dom.detailTemp, `${b.currentTemp.toFixed(1)}°C`);
  }

  updateCategoryDonut() {
    if (this.selectedBuildingId && this.state.buildings[this.selectedBuildingId]) {
      const b = this.state.buildings[this.selectedBuildingId];
      this.charts.updateCategoryData(b.categoryBreakdown);
    } else {
      let tHvac = 0, tLights = 0, tEquip = 0, tServ = 0, tLoad = 0;
      Object.keys(this.state.buildings).forEach(id => {
        const b = this.state.buildings[id];
        if (!b) return;
        const bd = b.categoryBreakdown;
        tHvac += b.load * (bd.hvac / 100);
        tLights += b.load * (bd.lights / 100);
        tEquip += b.load * (bd.equipment / 100);
        tServ += b.load * (bd.servers / 100);
        tLoad += b.load;
      });

      if (tLoad > 0) {
        this.charts.updateCategoryData({
          hvac: (tHvac / tLoad) * 100,
          lights: (tLights / tLoad) * 100,
          equipment: (tEquip / tLoad) * 100,
          servers: (tServ / tLoad) * 100
        });
      }
    }
  }

  updateLeaderboard() {
    const buildingsArr = Object.keys(this.state.buildings).map(id => {
      const b = this.state.buildings[id];
      const ratio = b.load / b.maxCapacity;
      return {
        id,
        name: b.name,
        ratio,
        percentage: Math.round(ratio * 100)
      };
    });

    buildingsArr.sort((a, b) => a.ratio - b.ratio);

    const currentOrderStr = buildingsArr.map(b => b.id).join(',');
    
    if (currentOrderStr !== this.lastRanksOrder) {
      this.lastRanksOrder = currentOrderStr;
      
      this.dom.leaderboardList.innerHTML = buildingsArr.map((b, idx) => {
        let colorClass = 'var(--color-green)';
        if (b.percentage > 80) colorClass = 'var(--color-red)';
        else if (b.percentage > 60) colorClass = 'var(--color-amber)';

        return `
          <div class="leaderboard-item" data-building-id="${b.id}">
            <div class="leaderboard-name-group">
              <span class="rank-num">#${idx + 1}</span>
              <span>${b.name}</span>
            </div>
            <div class="leaderboard-progress-container" style="display: flex; align-items: center; gap: 10px; flex-grow: 1; max-width: 140px; margin-left: 10px;">
              <div style="height: 6px; width: 100%; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden;">
                <div class="leaderboard-bar" style="height: 100%; width: ${b.percentage}%; background: ${colorClass}; border-radius: 3px;"></div>
              </div>
            </div>
            <span class="leaderboard-score ${b.percentage > 65 ? 'score-down' : ''}">
              ${b.percentage}%
            </span>
          </div>
        `;
      }).join('');
    } else {
      buildingsArr.forEach(b => {
        const itemEl = this.dom.leaderboardList.querySelector(`[data-building-id="${b.id}"]`);
        if (!itemEl) return;
        
        const barEl = itemEl.querySelector('.leaderboard-bar');
        const scoreEl = itemEl.querySelector('.leaderboard-score');
        
        let colorClass = 'var(--color-green)';
        if (b.percentage > 80) colorClass = 'var(--color-red)';
        else if (b.percentage > 60) colorClass = 'var(--color-amber)';
        
        if (barEl) {
          barEl.style.width = `${b.percentage}%`;
          barEl.style.backgroundColor = colorClass;
        }
        
        if (scoreEl) {
          const textVal = `${b.percentage}%`;
          if (scoreEl.textContent !== textVal) {
            scoreEl.textContent = textVal;
          }
          if (b.percentage > 65) {
            scoreEl.classList.add('score-down');
          } else {
            scoreEl.classList.remove('score-down');
          }
        }
      });
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.unsubscribe) this.unsubscribe();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new AppController();
});
