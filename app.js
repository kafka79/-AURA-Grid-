import { INITIAL_STATE, updateSimulation, resolveAlertAction, formatSimTime } from './components/simulator.js';
import { CampusMap } from './components/map.js';
import { DashboardCharts } from './components/charts.js';
import { AlertManager } from './components/alerts.js';

class AppController {
  constructor() {
    // 1. Clean state management using structured clone to avoid mutability reference bugs
    this.state = structuredClone(INITIAL_STATE);
    this.destroyed = false;

    // Cache of rendered values to eliminate DOM text/HTML reads (prevents layout thrashing/reflow)
    this.renderedCache = new Map();

    this.map = null;
    this.charts = null;
    this.alertsManager = null;
    
    this.selectedBuildingId = null;
    this.simSpeed = 0.08; // fraction of hours to advance per tick
    
    // Self-correcting drift-free loop fields
    this.lastTickTime = Date.now();
    this.tickInterval = 1200; // ms
    
    // Ranks tracker to prevent leaderboard layout thrashing
    this.lastRanksOrder = '';

    // 2. Perform element caching in constructor to eliminate repeat query selectors
    this.cacheDOM();

    // 3. Initialize Components
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
      labelTemp: document.getElementById('label-temp'),
      sliderLabelTemp: document.getElementById('slider-label-temp'),
      labelOccupancy: document.getElementById('label-occupancy'),
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
      weatherBtns: document.querySelectorAll('.weather-btn')
    };
  }

  init() {
    // Initialize components passing callbacks (no global state pollution)
    this.map = new CampusMap('map-container', (id) => this.handleBuildingSelect(id));
    this.charts = new DashboardCharts('live-chart', 'donut-chart');
    this.alertsManager = new AlertManager('alerts-list', (id) => this.handleAlertResolve(id));

    // Bind Event Listeners for cockpit controls
    this.bindCockpitEvents();

    // Start simulation tick loop
    this.startSimulation();

    // Initial rendering tick
    this.tick(true);
  }

  updateState(fn) {
    const nextState = structuredClone(this.state);
    fn(nextState);
    this.state = nextState;
  }

  bindCockpitEvents() {
    this.dom.timeInput.addEventListener('input', (e) => {
      this.updateState(state => {
        state.timeOfDay = parseFloat(e.target.value);
      });
      this.tick(true); // force update, don't advance time
    });

    this.dom.tempInput.addEventListener('input', (e) => {
      this.updateState(state => {
        state.temperature = parseInt(e.target.value);
      });
      this.tick(true);
    });

    this.dom.occupancyInput.addEventListener('input', (e) => {
      this.updateState(state => {
        state.occupancy = parseInt(e.target.value);
      });
      this.tick(true);
    });

    this.dom.weatherBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.weatherBtns.forEach(b => {
          if (b !== btn) b.classList.remove('active');
        });
        btn.classList.add('active');
        this.updateState(state => {
          state.weather = btn.getAttribute('data-weather');
        });
        this.tick(true);
      });
    });

    this.dom.smartGridInput.addEventListener('change', (e) => {
      this.updateState(state => {
        state.smartGridActive = e.target.checked;
      });
      this.tick(true);
    });
  }

  startSimulation() {
    this.lastTickTime = Date.now();
    
    const run = () => {
      if (this.destroyed) return;
      
      const now = Date.now();
      const elapsed = now - this.lastTickTime;
      
      if (elapsed >= this.tickInterval) {
        // self-correcting catchup delta step, capped to 50 intervals to prevent excessive jumps
        const ticks = Math.min(50, Math.floor(elapsed / this.tickInterval));
        this.lastTickTime = now;
        
        // Advance simulation with precise ticks using immutable state assignment
        this.updateState(state => {
          updateSimulation(state, ticks * this.simSpeed);
        });
        this.tick(false);
      }
      
      requestAnimationFrame(run);
    };
    
    requestAnimationFrame(run);
  }

  handleBuildingSelect(id) {
    this.selectedBuildingId = id;
    this.updateBuildingDetailView();
    this.updateCategoryDonut();
  }

  handleAlertResolve(alertId) {
    this.updateState(state => {
      resolveAlertAction(state, alertId);
    });
    this.tick(true);
  }

  // Helper function for dirty-checking DOM string updates via local cache (eliminates forced reflows)
  updateDOMText(element, value) {
    if (element) {
      const cached = this.renderedCache.get(element);
      if (cached !== value) {
        element.textContent = value;
        this.renderedCache.set(element, value);
      }
    }
  }

  // Helper function for HTML dirty-checking to prevent forced layouts
  updateDOMHTML(element, value) {
    if (element) {
      const cached = this.renderedCache.get(element);
      if (cached !== value) {
        element.innerHTML = value;
        this.renderedCache.set(element, value);
      }
    }
  }

  tick(manualIntervention = false) {
    // Sync UI input values to current state
    if (!manualIntervention && this.dom.timeInput) {
      this.dom.timeInput.value = this.state.timeOfDay;
    }
    
    // Update Slider Value Labels with dirty-checking
    const simTimeFormatted = formatSimTime(this.state.timeOfDay);
    this.updateDOMText(this.dom.labelTime, simTimeFormatted);
    this.updateDOMText(this.dom.sliderLabelTime, simTimeFormatted);
    
    const tempText = `${this.state.temperature}°C`;
    this.updateDOMText(this.dom.labelTemp, tempText);
    this.updateDOMText(this.dom.sliderLabelTemp, tempText);
    
    const occupancyText = `${this.state.occupancy}%`;
    this.updateDOMText(this.dom.labelOccupancy, occupancyText);
    this.updateDOMText(this.dom.sliderLabelOccupancy, occupancyText);
    
    if (this.dom.smartGridInput) {
      this.dom.smartGridInput.checked = this.state.smartGridActive;
    }

    // Sync active weather buttons
    this.dom.weatherBtns.forEach(btn => {
      const active = btn.getAttribute('data-weather') === this.state.weather;
      if (active) {
        if (!btn.classList.contains('active')) btn.classList.add('active');
      } else {
        if (btn.classList.contains('active')) btn.classList.remove('active');
      }
    });

    // Compute metrics
    let totalCampusLoad = 0;
    Object.keys(this.state.buildings).forEach(id => {
      const b = this.state.buildings[id];
      if (b) totalCampusLoad += b.load;
    });

    // Update KPI panels using dirty-checking
    this.updateDOMText(this.dom.totalLoad, `${totalCampusLoad.toFixed(1)} kW`);
    this.updateDOMText(this.dom.gridDemand, `${this.state.gridDemand.toFixed(1)} kW`);
    this.updateDOMText(this.dom.solar, `${this.state.solarGeneration.toFixed(1)} kW`);
    this.updateDOMText(this.dom.battery, `${Math.round(this.state.batteryCharge)}%`);
    this.updateDOMText(this.dom.carbon, `${this.state.accumulatedCarbonSaved.toFixed(1)} kg`);
    
    const activeAlerts = this.state.alerts.filter(a => !a.resolved).length;
    this.updateDOMText(this.dom.alertsCount, activeAlerts.toString());
    
    if (this.dom.alertsIconContainer) {
      if (activeAlerts > 0) {
        this.dom.alertsIconContainer.className = 'pulse-dot red';
      } else {
        this.dom.alertsIconContainer.className = 'pulse-dot green';
      }
    }

    // Update battery charge progress style
    if (this.dom.batteryProgress) {
      const widthVal = `${this.state.batteryCharge}%`;
      if (this.dom.batteryProgress.style.width !== widthVal) {
        this.dom.batteryProgress.style.width = widthVal;
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

    // Refresh child map and alert manager
    this.map.updateMapStates(this.state.buildings, this.state.solarGeneration);
    this.alertsManager.render(this.state.alerts);
    
    this.updateBuildingDetailView();
    this.updateLeaderboard();
    
    // Only feed streaming chart historical buffer on simulation clocks, not manual inputs
    if (!manualIntervention) {
      this.charts.updateLiveHistory(
        this.state.solarGeneration,
        this.state.gridDemand,
        this.state.timeOfDay
      );
    }
    
    this.updateCategoryDonut();
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

    // Select status badge template
    let badgeClass = 'normal';
    if (b.state === 'peak') badgeClass = 'peak';
    if (b.state === 'critical') badgeClass = 'warning';

    this.updateDOMText(this.dom.detailTitle, b.name);
    
    const statusBadgeHTML = `<span class="detail-badge ${badgeClass}">${b.state}</span>`;
    this.updateDOMHTML(this.dom.detailStatus, statusBadgeHTML);
    
    this.updateDOMText(this.dom.detailLoad, `${b.load.toFixed(1)} kW`);
    this.updateDOMText(this.dom.detailCapacity, `${b.maxCapacity} kW`);
    this.updateDOMText(this.dom.detailOccupancy, `${Math.round(b.occupancyRatio * 100)}%`);
    this.updateDOMText(this.dom.detailTemp, `${b.currentTemp.toFixed(1)}°C`);
  }

  updateCategoryDonut() {
    // If a building is selected, show its specific breakdown, otherwise show cumulative campus average
    if (this.selectedBuildingId && this.state.buildings[this.selectedBuildingId]) {
      const b = this.state.buildings[this.selectedBuildingId];
      this.charts.updateCategoryData(b.categoryBreakdown);
    } else {
      // Aggregate cumulative campus breakdown
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
    // Calculate efficiency ratio: load / maxCapacity (lower ratio = more efficient)
    const buildingsArr = Object.keys(this.state.buildings).map(id => {
      const b = this.state.buildings[id];
      const ratio = b.load / b.maxCapacity;
      return {
        id: id,
        name: b.name,
        ratio: ratio,
        percentage: Math.round(ratio * 100)
      };
    });

    // Sort by efficiency (increasing ratio)
    buildingsArr.sort((a, b) => a.ratio - b.ratio);

    // Diff-driven DOM update: Only rewrite innerHTML template if order of ranks changed
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
            <div style="display: flex; align-items: center; gap: 10px; flex-grow: 1; max-width: 140px; margin-left: 10px;">
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
      // In-place update of values/styles to avoid DOM rebuilding
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
  }
}

// Instantiate on load
window.addEventListener('DOMContentLoaded', () => {
  new AppController();
});
