import { APP_CONFIG, INITIAL_BUILDINGS_CONFIG, OCCUPANCY_PROFILES } from './config.js';
import { deepClone, formatSimTime, calculateSolarPosition, calculateIrradiance, createSeededRandom, storage, auditLog } from './utils.js';

export function getInitialState() {
  const buildings = {};
  Object.keys(INITIAL_BUILDINGS_CONFIG).forEach(id => {
    const config = INITIAL_BUILDINGS_CONFIG[id];
    buildings[id] = {
      ...config,
      currentTemp: config.initialTemp,
      load: config.baseLoad,
      occupancyRatio: 0.0,
      state: 'normal',
    };
  });

  // Initial state - pre-simulated 24h history will be generated
  const initialState = {
    timeOfDay: 10.0,
    weather: 'sunny',
    temperature: 28,
    occupancy: 80,
    smartGridActive: true,
    accumulatedCarbonSaved: 0.0,
    accumulatedDailyKwh: 0.0,
    batteryCharge: 65.0,
    batteryCapacityKwh: APP_CONFIG.battery.capacityKwh,
    batteryCurrentKwh: APP_CONFIG.battery.capacityKwh * 0.65,
    batteryCarbonIntensity: 0.0,
    batteryEfficiency: APP_CONFIG.battery.defaultEfficiency,
    alertThresholdTemp: APP_CONFIG.alertThresholds.thermalStressTemp,
    alertThresholdEngLoad: APP_CONFIG.alertThresholds.engineeringOverloadRatio,
    alerts: [
      {
        id: 'alert-library-hvac',
        buildingId: 'building-library',
        level: 'warning',
        title: 'High Idle Load',
        desc: 'Library HVAC system is operating at 85% capacity with low occupancy.',
        time: '02:15 AM',
        actionId: 'optimize-library-hvac',
        actionLabel: 'Optimize HVAC',
        resolved: false,
      },
    ],
    buildings,
    solarGeneration: 0.0,
    gridDemand: 0.0,
    liveGridCarbon: null,
    // Pre-populated 24h history for charts
    _history: {
      timeOffset: 0,
      lastHourInt: 9,
      hourlyAccumulator: { solar: [], grid: [] },
      solarHistory: [],
      gridHistory: [],
      hourlySolarHistory: [],
      hourlyGridHistory: [],
    },
    // Tariff tracking
    tariff: {
      accumulatedEnergyCost: 0.0,
      maxDemandKva: 0.0,
      currentMonthDemandPeak: 0.0,
    },
  };

  // Generate 24 hours of simulated history
  const history = simulateHistory(initialState);
  initialState._history = history;
  initialState.accumulatedCarbonSaved = history.totalCarbonSaved;
  initialState.accumulatedDailyKwh = history.totalKwh;

  return initialState;
}

function simulateHistory(initialState) {
  const state = deepClone(initialState);
  const stepSize = 0.05; // hours
  const historyLength = 24; // hours
  const steps = Math.floor(historyLength / stepSize);

  const solarHistory = [];
  const gridHistory = [];
  const hourlySolarHistory = [];
  const hourlyGridHistory = [];
  let hourlyAccumulator = { solar: [], grid: [] };
  let lastHourInt = 9;
  let totalCarbonSaved = 0;
  let totalKwh = 0;

  // Seed for deterministic weather noise
  const random = createSeededRandom(42);

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * historyLength;
    state.timeOfDay = (10 - historyLength + t) % 24;

    runTickInternal(state, stepSize, random);
    totalCarbonSaved += state.accumulatedCarbonSaved;
    totalKwh += state.accumulatedDailyKwh;

    const xVal = state.timeOfDay;
    solarHistory.push({ x: xVal, y: state.solarGeneration });
    gridHistory.push({ x: xVal, y: state.gridDemand });

    const currentHourInt = Math.floor(state.timeOfDay);
    hourlyAccumulator.solar.push(state.solarGeneration);
    hourlyAccumulator.grid.push(state.gridDemand);

    if (currentHourInt !== lastHourInt) {
      const avgSolar = hourlyAccumulator.solar.reduce((a, b) => a + b, 0) / hourlyAccumulator.solar.length;
      const avgGrid = hourlyAccumulator.grid.reduce((a, b) => a + b, 0) / hourlyAccumulator.grid.length;
      hourlySolarHistory.push({ x: lastHourInt, y: avgSolar });
      hourlyGridHistory.push({ x: lastHourInt, y: avgGrid });
      lastHourInt = currentHourInt;
      hourlyAccumulator = { solar: [state.solarGeneration], grid: [state.gridDemand] };
    }
  }

  return {
    timeOffset: 0,
    lastHourInt: 9,
    hourlyAccumulator: { solar: [], grid: [] },
    solarHistory: solarHistory.slice(-40),
    gridHistory: gridHistory.slice(-40),
    hourlySolarHistory,
    hourlyGridHistory,
    totalCarbonSaved: state.accumulatedCarbonSaved,
    totalKwh: state.accumulatedDailyKwh,
  };
}

export class SimulationEngine {
  constructor(storageDriver = null, seed = null) {
    this.listeners = new Set();
    this.storage = storageDriver || storage;
    this.random = createSeededRandom(seed ?? Date.now());
    this.pendingWork = null;
    this.loadState();
  }

  async loadState() {
    try {
      const saved = this.storage.get('aura-grid-state');
      if (saved) {
        this.state = JSON.parse(saved);
        if (!this.state.buildings || Object.keys(this.state.buildings).length === 0) {
          this.state = getInitialState();
        }
        // Ensure history structure exists
        if (!this.state._history) {
          const history = simulateHistory(this.state);
          this.state._history = history;
          this.state.accumulatedCarbonSaved = history.totalCarbonSaved;
          this.state.accumulatedDailyKwh = history.totalKwh;
        }
        // Ensure tariff structure exists
        if (!this.state.tariff) {
          this.state.tariff = {
            accumulatedEnergyCost: 0.0,
            maxDemandKva: 0.0,
            currentMonthDemandPeak: 0.0,
          };
        }
      } else {
        this.state = getInitialState();
      }
    } catch (e) {
      console.warn('Storage load error, using defaults:', e);
      this.state = getInitialState();
    }
    // Try to sync live carbon intensity (non-blocking)
    this.syncLiveCarbonIntensity();
  }

  async syncLiveCarbonIntensity() {
    try {
      // Indian grid carbon intensity API (no CORS, requires token)
      // For now, use static Indian grid values from config
      // Future: integrate with co2signal.com or similar with API key
      this.updateState(state => {
        state.liveGridCarbon = null; // Use config fallback
      });
    } catch (e) {
      console.warn('[AURA Grid] Using static carbon intensity coefficients');
    }
  }

  saveState() {
    try {
      // Don't persist history buffers (too large)
      const { _history, ...persistState } = this.state;
      this.storage.set('aura-grid-state', JSON.stringify(persistState));
    } catch (e) {
      // Ignore quota errors
    }
  }

  reset() {
    this.state = getInitialState();
    this.saveState();
    this.notify();
  }

  subscribe(callback) {
    this.listeners.add(callback);
    callback(deepClone(this.state));
    return () => this.listeners.delete(callback);
  }

  notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  updateState(fn) {
    fn(this.state);
    this.saveState();
    this.notify();
  }

  // Main entry: advance simulation by elapsedHours
  // Uses fixed-step integration internally, schedules work in chunks to avoid blocking
  stepSimulation(elapsedHours) {
    if (elapsedHours <= 0) return;

    const stepSize = APP_CONFIG.simulation.fixedStepHours;
    const totalSteps = Math.ceil(elapsedHours / stepSize);
    const maxStepsPerFrame = 50; // ~2.5h max per frame

    this.updateState(state => {
      let remaining = elapsedHours;
      let stepsDone = 0;

      while (remaining > 0.001 && stepsDone < maxStepsPerFrame) {
        const dt = Math.min(remaining, stepSize);
        runTickInternal(state, dt, this.random);
        remaining -= dt;
        stepsDone++;
      }

      if (remaining > 0.001) {
        // Schedule remaining work in next macrotask
        this.pendingWork = remaining;
        setTimeout(() => this.stepSimulation(this.pendingWork), 0);
        this.pendingWork = null;
      }

      // Auto-resolve alerts when smart grid is active
      if (state.smartGridActive) {
        state.alerts
          .filter(a => !a.resolved)
          .forEach(a => resolveAlertAction(state, a.id));
      }
    });
  }
}

// ============================================
// Pure simulation tick - no side effects
// ============================================
function runTickInternal(state, deltaTimeHours, random) {
  if (!state || !state.buildings) return state;

  // 1. Time advancement
  state.timeOfDay = (state.timeOfDay + deltaTimeHours) % 24;

  // 2. Solar generation with proper atmospheric model
  state.solarGeneration = calculateSolarGeneration(state, random);

  // 3. Building loads with thermodynamic integration
  let totalCampusLoad = 0;
  const kEnv = APP_CONFIG.physics.thermalLossCoeff;
  const kHvac = APP_CONFIG.physics.hvacResponseCoeff;
  const thermalEffortMult = APP_CONFIG.physics.thermalEffortMult;
  const envLossMult = APP_CONFIG.physics.envLossMult;
  const occupancyHVACMult = APP_CONFIG.physics.occupancyHVACMult;

  Object.keys(state.buildings).forEach(id => {
    const b = state.buildings[id];
    if (!b) return;

    const profile = b.occupancyProfile || 'academic';
    const hourlyOccupancy = OCCUPANCY_PROFILES[profile](state.timeOfDay);
    const currentOccupancyRatio = hourlyOccupancy * (state.occupancy / 100);
    b.occupancyRatio = currentOccupancyRatio;

    // Analytical exponential decay integration (unconditionally stable)
    const B = kEnv + kHvac;
    const steadyStateTemp = b.hvacSet;
    b.currentTemp = steadyStateTemp + (b.currentTemp - steadyStateTemp) * Math.exp(-B * deltaTimeHours);

    // HVAC thermal effort -> electrical load
    const hvacThermalEffort = Math.abs(b.hvacSet - b.currentTemp) * kHvac * thermalEffortMult +
                              Math.abs(state.temperature - b.currentTemp) * kEnv * envLossMult;
    const hvacLoad = hvacThermalEffort * (1.0 + currentOccupancyRatio * occupancyHVACMult);

    // Other loads
    const lightingLoad = (b.maxCapacity * 0.15) * (currentOccupancyRatio + (state.weather === 'rainy' ? 0.3 : 0.1));
    const equipmentLoad = (b.maxCapacity * 0.35) * currentOccupancyRatio;

    const calculatedLoad = b.baseLoad + hvacLoad + lightingLoad + equipmentLoad;
    b.load = Math.min(b.maxCapacity, Math.max(b.baseLoad, calculatedLoad));

    // Building state classification
    const loadPercent = b.load / b.maxCapacity;
    if (loadPercent > 0.85) b.state = 'critical';
    else if (loadPercent > 0.65) b.state = 'peak';
    else b.state = 'normal';

    totalCampusLoad += b.load;
  });

  // 4. Battery & Smart Grid management
  const netPower = state.solarGeneration - totalCampusLoad;
  let batteryActivity = 0; // kW (+ charge, - discharge)
  const eff = state.batteryEfficiency || APP_CONFIG.battery.defaultEfficiency;

  // Carbon intensities
  const stdGridCarbon = state.liveGridCarbon || APP_CONFIG.carbonIntensity.standardGrid;
  const peakGridCarbon = state.liveGridCarbon ? state.liveGridCarbon * 1.15 : APP_CONFIG.carbonIntensity.peakGrid;
  const offPeakGridCarbon = state.liveGridCarbon ? state.liveGridCarbon * 0.9 : APP_CONFIG.carbonIntensity.offPeakGrid;

  const hour = state.timeOfDay;
  const isPeakRateHour = hour >= APP_CONFIG.hours.peakStart && hour <= APP_CONFIG.hours.peakEnd;
  const isOffPeakChargingHour = hour >= APP_CONFIG.hours.offPeakStart || hour <= APP_CONFIG.hours.offPeakEnd;

  if (state.smartGridActive) {
    if (netPower > 0) {
      // Excess solar -> charge battery
      const chargeRoom = state.batteryCapacityKwh - state.batteryCurrentKwh;
      const chargeSpeed = Math.min(netPower, APP_CONFIG.battery.maxChargeRateKw);
      const addedEnergyRaw = chargeSpeed * deltaTimeHours;
      const addedEnergyStored = addedEnergyRaw * eff;

      if (chargeRoom > 0 && addedEnergyStored > 0) {
        const prevKwh = state.batteryCurrentKwh;
        state.batteryCurrentKwh = Math.min(state.batteryCapacityKwh, state.batteryCurrentKwh + addedEnergyStored);
        const actualAdded = state.batteryCurrentKwh - prevKwh;
        if (actualAdded > 0) {
          // Battery carbon intensity: weighted average of existing + new solar (zero carbon)
          state.batteryCarbonIntensity = (prevKwh * state.batteryCarbonIntensity) / state.batteryCurrentKwh;
        }
        batteryActivity = actualAdded / (deltaTimeHours * eff);
      }
    } else {
      // Deficit -> discharge or grid import
      if (isPeakRateHour && state.batteryCurrentKwh > (state.batteryCapacityKwh * APP_CONFIG.battery.minChargeRatio)) {
        const drawDemand = Math.abs(netPower);
        const dischargeSpeed = Math.min(drawDemand, APP_CONFIG.battery.maxDischargeRateKw);
        const drawnEnergy = dischargeSpeed * deltaTimeHours;

        const prevKwh = state.batteryCurrentKwh;
        state.batteryCurrentKwh = Math.max(state.batteryCapacityKwh * APP_CONFIG.battery.minChargeRatio, state.batteryCurrentKwh - drawnEnergy);
        const actualDrawn = prevKwh - state.batteryCurrentKwh;
        batteryActivity = -(actualDrawn / deltaTimeHours);
      } else if (isOffPeakChargingHour && state.batteryCharge < (APP_CONFIG.battery.maxOffPeakChargeRatio * 100)) {
        // Off-peak grid charging
        const chargeSpeed = APP_CONFIG.battery.offPeakChargeRateKw;
        const addedEnergyRaw = chargeSpeed * deltaTimeHours;
        const addedEnergyStored = addedEnergyRaw * eff;

        const prevKwh = state.batteryCurrentKwh;
        state.batteryCurrentKwh = Math.min(state.batteryCapacityKwh * APP_CONFIG.battery.maxOffPeakChargeRatio, state.batteryCurrentKwh + addedEnergyStored);
        const actualAdded = state.batteryCurrentKwh - prevKwh;
        if (actualAdded > 0) {
          // Off-peak grid carbon intensity (includes charging losses)
          const chargedIntensity = offPeakGridCarbon / eff;
          state.batteryCarbonIntensity = (prevKwh * state.batteryCarbonIntensity + actualAdded * chargedIntensity) / state.batteryCurrentKwh;
        }
        batteryActivity = actualAdded / (deltaTimeHours * eff);
      }
    }
  } else {
    // Dumb battery: simple charge/discharge
    if (netPower > 0) {
      const chargeRoom = state.batteryCapacityKwh - state.batteryCurrentKwh;
      const chargeSpeed = Math.min(netPower, APP_CONFIG.battery.dumbMaxChargeRateKw);
      const addedEnergyRaw = chargeSpeed * deltaTimeHours;
      const addedEnergyStored = addedEnergyRaw * eff;

      const prevKwh = state.batteryCurrentKwh;
      state.batteryCurrentKwh = Math.min(state.batteryCapacityKwh, state.batteryCurrentKwh + addedEnergyStored);
      const actualAdded = state.batteryCurrentKwh - prevKwh;
      if (actualAdded > 0) {
        state.batteryCarbonIntensity = (prevKwh * state.batteryCarbonIntensity) / state.batteryCurrentKwh;
      }
      batteryActivity = actualAdded / (deltaTimeHours * eff);
    } else if (state.batteryCurrentKwh > (state.batteryCapacityKwh * APP_CONFIG.battery.minChargeRatio)) {
      const drawDemand = Math.abs(netPower);
      const dischargeSpeed = Math.min(drawDemand, APP_CONFIG.battery.dumbMaxDischargeRateKw);
      const drawnEnergy = dischargeSpeed * deltaTimeHours;

      const prevKwh = state.batteryCurrentKwh;
      state.batteryCurrentKwh = Math.max(state.batteryCapacityKwh * APP_CONFIG.battery.minChargeRatio, state.batteryCurrentKwh - drawnEnergy);
      const actualDrawn = prevKwh - state.batteryCurrentKwh;
      batteryActivity = -(actualDrawn / deltaTimeHours);
    }
  }

  state.batteryCharge = (state.batteryCurrentKwh / state.batteryCapacityKwh) * 100;

  // 5. Grid demand calculation
  // Grid demand = campus load + battery charging - solar generation - battery discharging
  state.gridDemand = totalCampusLoad + (batteryActivity > 0 ? batteryActivity : 0) - state.solarGeneration - (batteryActivity < 0 ? Math.abs(batteryActivity) : 0);
  if (state.gridDemand < 0) state.gridDemand = 0;

  // 6. Carbon Savings Integration (properly accounting for round-trip efficiency)
  // Direct solar displacement
  const solarDirectPower = Math.min(state.solarGeneration, totalCampusLoad);
  const solarDirectSavings = solarDirectPower * deltaTimeHours * stdGridCarbon;

  // Battery discharge displacement
  let batteryDischargeSavings = 0;
  if (batteryActivity < 0) {
    const dischargePower = Math.abs(batteryActivity);
    const displacedGridIntensity = isPeakRateHour ? peakGridCarbon : stdGridCarbon;
    // Savings = displaced grid carbon - embedded battery carbon (already accounts for charge losses)
    batteryDischargeSavings = dischargePower * deltaTimeHours * (displacedGridIntensity - state.batteryCarbonIntensity);
  }

  state.accumulatedCarbonSaved += (solarDirectSavings + batteryDischargeSavings);
  state.accumulatedDailyKwh += totalCampusLoad * deltaTimeHours;

  // 7. Tariff tracking (energy cost + demand charge projection)
  updateTariffTracking(state, deltaTimeHours, totalCampusLoad, isPeakRateHour, isOffPeakChargingHour);

  // Daily reset
  if (state.timeOfDay < deltaTimeHours && state.timeOfDay >= 0) {
    state.accumulatedDailyKwh = 0;
    state.tariff.accumulatedEnergyCost = 0.0;
    state.tariff.currentMonthDemandPeak = 0.0;
  }

  // 8. Dynamic alerts
  triggerDynamicAlerts(state);

  return state;
}

// ============================================
// Tariff Cost Tracking
// ============================================
function updateTariffTracking(state, deltaTimeHours, totalCampusLoad, isPeakRateHour, isOffPeakChargingHour) {
  const tariff = APP_CONFIG.tariff;
  let energyRate = tariff.energyCharge.standard;

  if (isPeakRateHour) energyRate = tariff.energyCharge.peak;
  else if (isOffPeakChargingHour) energyRate = tariff.energyCharge.offPeak;

  // Energy cost for this interval (₹)
  const energyCost = state.gridDemand * deltaTimeHours * energyRate;
  state.tariff.accumulatedEnergyCost += energyCost;

  // Track max demand for demand charge (kVA, dynamic PF based on campus inductive loads)
  let totalKvar = 0;
  if (state.buildings) {
    Object.keys(state.buildings).forEach(id => {
      const b = state.buildings[id];
      if (!b || b.load <= 0 || !b.categoryBreakdown) return;
      
      const bd = b.categoryBreakdown;
      const hvacKw = b.load * (bd.hvac / 100);
      const lightsKw = b.load * (bd.lights / 100);
      const equipKw = b.load * (bd.equipment / 100);
      const serversKw = b.load * (bd.servers / 100);

      // kVAR = kW * tan(acos(PF)). Typical PFs: HVAC 0.85, Lights 0.98, Equipment 0.90, Servers 0.95
      totalKvar += hvacKw * Math.tan(Math.acos(0.85));
      totalKvar += lightsKw * Math.tan(Math.acos(0.98));
      totalKvar += equipKw * Math.tan(Math.acos(0.90));
      totalKvar += serversKw * Math.tan(Math.acos(0.95));
    });
  }

  const demandKva = Math.sqrt(state.gridDemand * state.gridDemand + totalKvar * totalKvar);

  if (demandKva > state.tariff.currentMonthDemandPeak) {
    state.tariff.currentMonthDemandPeak = demandKva;
  }
  if (demandKva > state.tariff.maxDemandKva) {
    state.tariff.maxDemandKva = demandKva;
  }
}

// ============================================
// Solar Generation with Atmospheric Physics
// ============================================
function calculateSolarGeneration(state, random) {
  const maxSolarPeak = APP_CONFIG.solar.maxPeakKw;
  let solarMultiplier = 0;

  // Calculate accurate solar position using SPA algorithm
  const date = new Date(); // Current date for declination
  const solarPos = calculateSolarPosition(
    date,
    APP_CONFIG.campus.latitude,
    APP_CONFIG.campus.longitude,
    APP_CONFIG.campus.timezoneOffset
  );

  // Only generate during daylight
  if (solarPos.isDaylight) {
    solarMultiplier = Math.sin(solarPos.elevation); // elevation 0 to pi/2 -> sin 0 to 1
  }

  const weatherProfile = APP_CONFIG.weather[state.weather] || APP_CONFIG.weather.sunny;
  const weatherFactor = weatherProfile.factor;
  // Deterministic "noise" using seeded PRNG
  const weatherNoise = Math.sin(state.timeOfDay * weatherProfile.noiseFreq) * weatherProfile.noiseAmp +
                       (random() - 0.5) * 0.02; // small additional variance

  // PV temperature derating
  // Cell temp = ambient + (NOCT - 20) * (irradiance / 800)
  const irradianceProxy = solarMultiplier * weatherFactor * 1000; // W/m² approx
  const cellTemp = state.temperature + (APP_CONFIG.solar.panel.noct - 20) * (irradianceProxy / 800);
  const tempDerating = 1 + APP_CONFIG.solar.panel.tempCoeff * (cellTemp - APP_CONFIG.solar.panel.stcTemp);

  let generation = maxSolarPeak * solarMultiplier * Math.max(0, weatherFactor + weatherNoise) * tempDerating;
  if (generation < 0) generation = 0;
  return generation;
}

// ============================================
// Dynamic Alert System
// ============================================
function triggerDynamicAlerts(state) {
  const thresholdTemp = state.alertThresholdTemp;
  const thresholdEng = state.alertThresholdEngLoad;

  // Heatwave alert
  if (state.temperature >= thresholdTemp) {
    if (!state.alerts.find(a => a.id === 'alert-heatwave')) {
      state.alerts.unshift({
        id: 'alert-heatwave',
        buildingId: 'building-engineering',
        level: 'critical',
        title: 'Grid Thermal Stress',
        desc: `High temperatures (>=${thresholdTemp}°C) causing heavy HVAC draw in laboratories.`,
        time: formatSimTime(state.timeOfDay),
        actionId: 'optimize-temp-limit',
        actionLabel: 'Increase HVAC Setpoint',
        resolved: false,
      });
    }
  } else {
    state.alerts = state.alerts.filter(a => a.id !== 'alert-heatwave');
  }

  // Engineering overload
  const eng = state.buildings['building-engineering'];
  if (eng && (eng.load / eng.maxCapacity >= thresholdEng)) {
    if (!state.alerts.find(a => a.id === 'alert-engineering-overload')) {
      state.alerts.unshift({
        id: 'alert-engineering-overload',
        buildingId: 'building-engineering',
        level: 'critical',
        title: 'Lab Overload Warning',
        desc: `Engineering Block load has crossed warning limit of ${Math.round(thresholdEng * 100)}%.`,
        time: formatSimTime(state.timeOfDay),
        actionId: 'shed-engineering-labs',
        actionLabel: 'Shed Secondary Labs',
        resolved: false,
      });
    }
  } else {
    state.alerts = state.alerts.filter(a => a.id !== 'alert-engineering-overload');
  }

  // Low battery alert
  if (state.batteryCharge < 20 && state.smartGridActive) {
    if (!state.alerts.find(a => a.id === 'alert-low-battery')) {
      state.alerts.unshift({
        id: 'alert-low-battery',
        buildingId: 'substation',
        level: 'warning',
        title: 'Battery Reserve Low',
        desc: `Smart battery at ${Math.round(state.batteryCharge)}%. Peak shaving capacity reduced.`,
        time: formatSimTime(state.timeOfDay),
        actionId: 'conserve-battery',
        actionLabel: 'Limit Discharge',
        resolved: false,
      });
    }
  } else {
    state.alerts = state.alerts.filter(a => a.id !== 'alert-low-battery');
  }
}

// ============================================
// Alert Resolution Actions
// ============================================
export function resolveAlertAction(state, alertId) {
  const alert = state.alerts.find(a => a.id === alertId);
  if (alert && !alert.resolved) {
    alert.resolved = true;
    const actionId = alert.actionId;

    if (actionId === 'optimize-library-hvac') {
      if (state.buildings['building-library']) {
        state.buildings['building-library'].hvacSet = 23; // Raise setpoint to reduce cooling load
      }
      auditLog.add('auto_resolve', {
        alertId,
        action: 'optimize-library-hvac',
        description: 'Raised Library HVAC setpoint from 20°C to 23°C',
        building: 'building-library',
      }, 'info');
    } else if (actionId === 'optimize-temp-limit') {
      Object.keys(state.buildings).forEach(id => {
        if (state.buildings[id]) {
          state.buildings[id].hvacSet += 2; // Global setback
        }
      });
      auditLog.add('auto_resolve', {
        alertId,
        action: 'optimize-temp-limit',
        description: 'Raised all HVAC setpoints by 2°C for thermal stress relief',
        buildingsAffected: Object.keys(state.buildings),
      }, 'warning');
    } else if (actionId === 'shed-engineering-labs') {
      if (state.buildings['building-engineering']) {
        state.buildings['building-engineering'].baseLoad = 35; // Shed non-critical loads
      }
      auditLog.add('auto_resolve', {
        alertId,
        action: 'shed-engineering-labs',
        description: 'Reduced Engineering Block baseload from 50kW to 35kW (shed secondary labs)',
        building: 'building-engineering',
      }, 'critical');
    } else if (actionId === 'conserve-battery') {
      // Signal to battery logic to limit discharge (handled in smart grid logic)
      state.batteryCurrentKwh = Math.max(state.batteryCurrentKwh, state.batteryCapacityKwh * 0.3);
      auditLog.add('auto_resolve', {
        alertId,
        action: 'conserve-battery',
        description: 'Limited battery discharge to maintain 30% reserve',
        batteryChargeBefore: state.batteryCharge,
      }, 'warning');
    }
  }
}