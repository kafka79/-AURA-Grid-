export const INITIAL_STATE = {
  timeOfDay: 10.0, // Float, 0.0 to 24.0 (10 AM)
  weather: 'sunny', // 'sunny', 'cloudy', 'rainy'
  temperature: 28, // °C
  occupancy: 80, // %
  smartGridActive: true,
  
  // Accumulated statistics
  accumulatedCarbonSaved: 1450.4, // kg CO2
  accumulatedDailyKwh: 4280.0,
  
  batteryCharge: 65, // %
  batteryCapacityKwh: 1200,
  batteryCurrentKwh: 780, // 65% of 1200
  batteryCarbonIntensity: 0.0, // kg CO2 / kWh of stored energy
  batteryEfficiency: 0.88, // 88% charge efficiency roundtrip (charging loss)
  
  // Configurable Alert Thresholds
  alertThresholdTemp: 35.0, // °C
  alertThresholdEngLoad: 0.88, // ratio
  
  // Alerts and logs list
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
      resolved: false
    }
  ],

  // Buildings details
  buildings: {
    'building-engineering': {
      id: 'building-engineering',
      name: 'Engineering Block',
      load: 180,
      baseLoad: 50,
      hvacSet: 22,
      currentTemp: 22.0, // Thermodynamic inertia tracking
      maxCapacity: 400,
      occupancyRatio: 0.8,
      state: 'normal', // 'normal', 'peak', 'critical'
      categoryBreakdown: { hvac: 45, lights: 15, equipment: 30, servers: 10 } // percentage
    },
    'building-science': {
      id: 'building-science',
      name: 'Science Lab',
      load: 140,
      baseLoad: 40,
      hvacSet: 21,
      currentTemp: 21.0, // Thermodynamic inertia tracking
      maxCapacity: 300,
      occupancyRatio: 0.7,
      state: 'normal',
      categoryBreakdown: { hvac: 40, lights: 10, equipment: 45, servers: 5 }
    },
    'building-library': {
      id: 'building-library',
      name: 'Library',
      load: 95,
      baseLoad: 20,
      hvacSet: 20,
      currentTemp: 20.0, // Thermodynamic inertia tracking
      maxCapacity: 150,
      occupancyRatio: 0.3,
      state: 'peak',
      categoryBreakdown: { hvac: 65, lights: 20, equipment: 10, servers: 5 }
    },
    'building-hostels': {
      id: 'building-hostels',
      name: 'Student Hostels',
      load: 210,
      baseLoad: 80,
      hvacSet: 23,
      currentTemp: 23.0, // Thermodynamic inertia tracking
      maxCapacity: 500,
      occupancyRatio: 0.6,
      state: 'normal',
      categoryBreakdown: { hvac: 35, lights: 40, equipment: 25, servers: 0 }
    },
    'building-admin': {
      id: 'building-admin',
      name: 'Administration',
      load: 55,
      baseLoad: 15,
      hvacSet: 22,
      currentTemp: 22.0, // Thermodynamic inertia tracking
      maxCapacity: 120,
      occupancyRatio: 0.9,
      state: 'normal',
      categoryBreakdown: { hvac: 50, lights: 25, equipment: 20, servers: 5 }
    }
  },
  
  // Power grids totals
  solarGeneration: 220,
  gridDemand: 460
};

export function updateSimulation(state, deltaTimeHours = 0.05) {
  // Guard clause against empty states
  if (!state || !state.buildings) return state;

  // 1. Update Time of Day (wrap at 24.0)
  state.timeOfDay = (state.timeOfDay + deltaTimeHours) % 24;

  // 2. Solar Farm generation calculation
  // Solar curve peaks at 13:00 (1 PM)
  const maxSolarPeak = 350; // kW max capacity
  let solarMultiplier = 0;
  
  if (state.timeOfDay >= 6.0 && state.timeOfDay <= 18.0) {
    // Sinusoidal curve for daylight solar intensity
    const angle = (state.timeOfDay - 6.0) / 12.0 * Math.PI;
    solarMultiplier = Math.sin(angle);
  }

  // Adjust for weather
  let weatherFactor = 1.0;
  if (state.weather === 'cloudy') weatherFactor = 0.35;
  if (state.weather === 'rainy') weatherFactor = 0.08;

  state.solarGeneration = maxSolarPeak * solarMultiplier * weatherFactor;
  if (state.solarGeneration < 0) state.solarGeneration = 0;

  // 3. Compute each building's live load
  let totalCampusLoad = 0;
  
  Object.keys(state.buildings).forEach(id => {
    const b = state.buildings[id];
    if (!b) return;
    
    // Hourly occupancy curve for building type
    let hourlyOccupancy = 0;
    const hour = state.timeOfDay;
    
    if (id === 'building-hostels') {
      if (hour >= 23 || hour < 6) hourlyOccupancy = 0.95;
      else if (hour >= 6 && hour < 9) hourlyOccupancy = 0.8;
      else if (hour >= 18 && hour < 23) hourlyOccupancy = 0.85;
      else hourlyOccupancy = 0.2;
    } else if (id === 'building-admin') {
      if (hour >= 8 && hour < 18) hourlyOccupancy = 0.9;
      else hourlyOccupancy = 0.05;
    } else if (id === 'building-library') {
      if (hour >= 8 && hour < 24) {
        hourlyOccupancy = 0.2 + 0.7 * Math.sin((hour - 8) / 16 * Math.PI);
      } else {
        hourlyOccupancy = 0.02;
      }
    } else {
      if (hour >= 9 && hour < 17) {
        hourlyOccupancy = 0.85;
      } else if (hour >= 17 && hour < 21) {
        hourlyOccupancy = 0.3;
      } else {
        hourlyOccupancy = 0.05;
      }
    }

    // Blend user slider occupancy settings
    const currentOccupancyRatio = hourlyOccupancy * (state.occupancy / 100);
    b.occupancyRatio = currentOccupancyRatio;

    // --- Thermodynamic Inertia Model ---
    // In nature, internal temp drifts towards outdoor temperature.
    // HVAC counteracts this and pulls internal temp towards hvacSet.
    const thermalLossCoeff = 0.18; // environment exchange speed per hour
    const hvacResponseCoeff = 0.75; // HVAC correction speed per hour
    
    const envDrift = (state.temperature - b.currentTemp) * thermalLossCoeff * deltaTimeHours;
    const hvacCorrection = (b.hvacSet - b.currentTemp) * hvacResponseCoeff * deltaTimeHours;
    
    b.currentTemp += envDrift + hvacCorrection;
    
    // HVAC work load is proportional to the correction effort & weather leak counteraction
    const hvacThermalEffort = Math.abs(hvacCorrection) * 11.5 + Math.abs(envDrift) * 3.5;
    const hvacLoad = hvacThermalEffort * (1.0 + currentOccupancyRatio * 0.5);

    // Equipment and Lighting loads
    const lightingLoad = (b.maxCapacity * 0.15) * (currentOccupancyRatio + (state.weather === 'rainy' ? 0.3 : 0.1));
    const equipmentLoad = (b.maxCapacity * 0.35) * currentOccupancyRatio;

    // Sum base load + HVAC + Lighting + Equipment
    let calculatedLoad = b.baseLoad + hvacLoad + lightingLoad + equipmentLoad;

    // Dampen if optimization alerts have been resolved
    const libraryHvacAlert = state.alerts.find(a => a.id === 'alert-library-hvac');
    if (id === 'building-library' && libraryHvacAlert && libraryHvacAlert.resolved) {
      calculatedLoad -= 35; // HVAC setback optimization savings
    }

    // Cap the building load to max capacity
    b.load = Math.min(b.maxCapacity, Math.max(b.baseLoad, calculatedLoad));

    // Determine state threshold
    const loadPercent = b.load / b.maxCapacity;
    if (loadPercent > 0.85) b.state = 'critical';
    else if (loadPercent > 0.65) b.state = 'peak';
    else b.state = 'normal';

    totalCampusLoad += b.load;
  });

  // 4. Battery Charge & Smart Grid management
  const netPower = state.solarGeneration - totalCampusLoad;
  let batteryActivity = 0; // kW flowing into (+) or out of (-) battery
  const eff = state.batteryEfficiency || 0.88;

  // Track carbon intensities
  const PEAK_GRID_CARBON = 0.65; // kg CO2 per kWh
  const STD_GRID_CARBON = 0.45;
  const OFFPEAK_GRID_CARBON = 0.35;

  const hour = state.timeOfDay;
  const isPeakRateHour = hour >= 14.0 && hour <= 19.0;
  const isOffPeakChargingHour = hour >= 23.0 || hour <= 5.0;

  if (state.smartGridActive) {
    if (netPower > 0) {
      // Solar charging (zero carbon added)
      const chargeRoom = state.batteryCapacityKwh - state.batteryCurrentKwh;
      const chargeSpeed = Math.min(netPower, 150); // max 150kW
      const addedEnergyRaw = chargeSpeed * deltaTimeHours;
      const addedEnergyStore = addedEnergyRaw * eff; // efficiency loss
      
      if (chargeRoom > 0 && addedEnergyStore > 0) {
        const prevKwh = state.batteryCurrentKwh;
        state.batteryCurrentKwh = Math.min(state.batteryCapacityKwh, state.batteryCurrentKwh + addedEnergyStore);
        const actualAdded = state.batteryCurrentKwh - prevKwh;
        if (actualAdded > 0) {
          // Solar has 0 carbon footprint
          state.batteryCarbonIntensity = (prevKwh * state.batteryCarbonIntensity) / state.batteryCurrentKwh;
        }
        batteryActivity = chargeSpeed;
      }
    } else {
      // Power deficit
      if (isPeakRateHour && state.batteryCurrentKwh > (state.batteryCapacityKwh * 0.15)) {
        // Discharge battery to displace expensive peak grid power
        const drawDemand = Math.abs(netPower);
        const dischargeSpeed = Math.min(drawDemand, 120); // max discharge 120kW
        const drawnEnergy = dischargeSpeed * deltaTimeHours;
        
        state.batteryCurrentKwh = Math.max(state.batteryCapacityKwh * 0.15, state.batteryCurrentKwh - drawnEnergy);
        batteryActivity = -dischargeSpeed;
      } else if (isOffPeakChargingHour && state.batteryCharge < 85) {
        // Grid off-peak charging (lower rate carbon profile)
        const chargeSpeed = 80; // 80kW rate
        const addedEnergyRaw = chargeSpeed * deltaTimeHours;
        const addedEnergyStore = addedEnergyRaw * eff;
        
        const prevKwh = state.batteryCurrentKwh;
        state.batteryCurrentKwh = Math.min(state.batteryCapacityKwh * 0.9, state.batteryCurrentKwh + addedEnergyStore);
        const actualAdded = state.batteryCurrentKwh - prevKwh;
        if (actualAdded > 0) {
          // Off-peak grid power footprint factored in, adjusted for charging efficiency loss
          const chargedIntensity = OFFPEAK_GRID_CARBON / eff;
          state.batteryCarbonIntensity = (prevKwh * state.batteryCarbonIntensity + actualAdded * chargedIntensity) / state.batteryCurrentKwh;
        }
        batteryActivity = chargeSpeed;
      }
    }
  } else {
    // Dumb Battery Mode: Only charge with excess solar, never discharge/offpeak charge
    if (netPower > 0) {
      const chargeRoom = state.batteryCapacityKwh - state.batteryCurrentKwh;
      const chargeSpeed = Math.min(netPower, 100);
      const addedEnergyRaw = chargeSpeed * deltaTimeHours;
      const addedEnergyStore = addedEnergyRaw * eff;
      
      const prevKwh = state.batteryCurrentKwh;
      state.batteryCurrentKwh = Math.min(state.batteryCapacityKwh, state.batteryCurrentKwh + addedEnergyStore);
      const actualAdded = state.batteryCurrentKwh - prevKwh;
      if (actualAdded > 0) {
        state.batteryCarbonIntensity = (prevKwh * state.batteryCarbonIntensity) / state.batteryCurrentKwh;
      }
      batteryActivity = chargeSpeed;
    }
  }

  // Calculate percentage
  state.batteryCharge = (state.batteryCurrentKwh / state.batteryCapacityKwh) * 100;

  // 5. Grid Demand total calculation
  state.gridDemand = totalCampusLoad + (batteryActivity > 0 ? batteryActivity : 0) - state.solarGeneration - (batteryActivity < 0 ? Math.abs(batteryActivity) : 0);
  if (state.gridDemand < 0) state.gridDemand = 0;

  // 6. First-Principles Carbon Savings Offset
  // Carbon offset by direct solar powering:
  const solarDirectPower = Math.min(state.solarGeneration, totalCampusLoad);
  const solarDirectSavings = solarDirectPower * deltaTimeHours * STD_GRID_CARBON;

  // Carbon offset by battery discharging during peak/standard hours:
  let batteryDischargeSavings = 0;
  if (batteryActivity < 0) {
    const dischargePower = Math.abs(batteryActivity);
    const displacedGridIntensity = isPeakRateHour ? PEAK_GRID_CARBON : STD_GRID_CARBON;
    // Savings = displaced grid emissions minus emissions originally embedded in stored power
    batteryDischargeSavings = dischargePower * deltaTimeHours * (displacedGridIntensity - state.batteryCarbonIntensity);
  }

  // Carbon penalty when grid charging during off-peak (captured inside state.batteryCarbonIntensity when charged)
  state.accumulatedCarbonSaved += (solarDirectSavings + batteryDischargeSavings);
  state.accumulatedDailyKwh += totalCampusLoad * deltaTimeHours;

  // Reset daily accumulations at midnight
  if (state.timeOfDay < deltaTimeHours && state.timeOfDay >= 0) {
    state.accumulatedDailyKwh = 0;
  }

  // 7. Dynamic Alert Generator
  triggerDynamicAlerts(state);

  return state;
}

function triggerDynamicAlerts(state) {
  const thresholdTemp = state.alertThresholdTemp !== undefined ? state.alertThresholdTemp : 35;
  const thresholdEng = state.alertThresholdEngLoad !== undefined ? state.alertThresholdEngLoad : 0.88;

  // Thermal Grid Stress alert trigger
  if (state.temperature >= thresholdTemp && !state.alerts.find(a => a.id === 'alert-heatwave')) {
    state.alerts.unshift({
      id: 'alert-heatwave',
      buildingId: 'building-engineering',
      level: 'critical',
      title: 'Grid Thermal Stress',
      desc: `High temperatures (>=${thresholdTemp}°C) causing heavy HVAC draw in laboratories.`,
      time: formatSimTime(state.timeOfDay),
      actionId: 'optimize-temp-limit',
      actionLabel: 'Increase HVAC Setpoint',
      resolved: false
    });
  }

  // Lab Overload Warning alert trigger
  const eng = state.buildings['building-engineering'];
  if (eng && (eng.load / eng.maxCapacity >= thresholdEng) && !state.alerts.find(a => a.id === 'alert-engineering-overload')) {
    state.alerts.unshift({
      id: 'alert-engineering-overload',
      buildingId: 'building-engineering',
      level: 'critical',
      title: 'Lab Overload Warning',
      desc: `Engineering Block load has crossed warning limit of ${Math.round(thresholdEng * 100)}%.`,
      time: formatSimTime(state.timeOfDay),
      actionId: 'shed-engineering-labs',
      actionLabel: 'Shed Secondary Labs',
      resolved: false
    });
  }
}

export function formatSimTime(decimalTime) {
  const hours = Math.floor(decimalTime);
  const minutes = Math.floor((decimalTime - hours) * 60);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  const displayMinutes = minutes < 10 ? '0' + minutes : minutes;
  return `${displayHours}:${displayMinutes} ${ampm}`;
}

export function resolveAlertAction(state, alertId) {
  const alertIndex = state.alerts.findIndex(a => a.id === alertId);
  if (alertIndex !== -1) {
    state.alerts[alertIndex].resolved = true;
    
    // Perform simulated correction shifts immediately
    if (alertId === 'optimize-library-hvac') {
      if (state.buildings['building-library']) {
        state.buildings['building-library'].hvacSet = 23; // shift temp upward
      }
    } else if (alertId === 'optimize-temp-limit') {
      Object.keys(state.buildings).forEach(id => {
        if (state.buildings[id]) {
          state.buildings[id].hvacSet += 2; // offset setpoints for massive grid relief
        }
      });
      // Remove alert
      state.alerts = state.alerts.filter(a => a.id !== alertId);
    } else if (alertId === 'shed-engineering-labs') {
      if (state.buildings['building-engineering']) {
        state.buildings['building-engineering'].baseLoad = 35; // lower base line load
      }
      state.alerts = state.alerts.filter(a => a.id !== alertId);
    }
  }
}
