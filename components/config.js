// Centralized System Configurations for AURA Grid

export const APP_CONFIG = {
  // Battery specifications
  battery: {
    capacityKwh: 1200,
    maxChargeRateKw: 150,
    maxDischargeRateKw: 120,
    defaultEfficiency: 0.88,
    minChargeRatio: 0.15,
    maxOffPeakChargeRatio: 0.90,
    offPeakChargeRateKw: 80,
    dumbMaxChargeRateKw: 100,
    dumbMaxDischargeRateKw: 100
  },

  // Environmental and physics factors
  physics: {
    thermalLossCoeff: 0.18,     // Rate at which indoor temp moves towards outdoor temp
    hvacResponseCoeff: 0.75,    // HVAC capacity to correct temperature
    thermalEffortMult: 11.5,    // Factor for HVAC thermal load calculation
    envLossMult: 3.5,           // Factor for outdoor temp thermal load
    occupancyHVACMult: 0.5      // Impact of occupancy ratio on HVAC load
  },

  // Grid emissions coefficients (kg CO2 per kWh)
  carbonIntensity: {
    peakGrid: 0.65,
    standardGrid: 0.45,
    offPeakGrid: 0.35
  },

  // Weather performance factors
  weather: {
    sunny: { factor: 1.0, noiseFreq: 15, noiseAmp: 0.015 },
    cloudy: { factor: 0.35, noiseFreq: 8, noiseAmp: 0.06 },
    rainy: { factor: 0.08, noiseFreq: 12, noiseAmp: 0.02 }
  },

  // Peak and off-peak hours
  hours: {
    peakStart: 14.0,
    peakEnd: 19.0,
    offPeakStart: 23.0,
    offPeakEnd: 5.0
  },

  // Dynamic alert settings
  alertThresholds: {
    thermalStressTemp: 35.0,
    engineeringOverloadRatio: 0.88
  },

  // Solar farm specifications
  solar: {
    maxPeakKw: 350
  }
};

export const INITIAL_BUILDINGS_CONFIG = {
  'building-engineering': {
    id: 'building-engineering',
    name: 'Engineering Block',
    baseLoad: 50,
    hvacSet: 22,
    initialTemp: 22.0,
    maxCapacity: 400,
    occupancyProfile: 'academic',
    categoryBreakdown: { hvac: 45, lights: 15, equipment: 30, servers: 10 }
  },
  'building-science': {
    id: 'building-science',
    name: 'Science Lab',
    baseLoad: 40,
    hvacSet: 21,
    initialTemp: 21.0,
    maxCapacity: 300,
    occupancyProfile: 'academic',
    categoryBreakdown: { hvac: 40, lights: 10, equipment: 45, servers: 5 }
  },
  'building-library': {
    id: 'building-library',
    name: 'Library',
    baseLoad: 20,
    hvacSet: 20,
    initialTemp: 20.0,
    maxCapacity: 150,
    occupancyProfile: 'library',
    categoryBreakdown: { hvac: 65, lights: 20, equipment: 10, servers: 5 }
  },
  'building-hostels': {
    id: 'building-hostels',
    name: 'Student Hostels',
    baseLoad: 80,
    hvacSet: 23,
    initialTemp: 23.0,
    maxCapacity: 500,
    occupancyProfile: 'hostels',
    categoryBreakdown: { hvac: 35, lights: 40, equipment: 25, servers: 0 }
  },
  'building-admin': {
    id: 'building-admin',
    name: 'Administration',
    baseLoad: 15,
    hvacSet: 22,
    initialTemp: 22.0,
    maxCapacity: 120,
    occupancyProfile: 'admin',
    categoryBreakdown: { hvac: 50, lights: 25, equipment: 20, servers: 5 }
  }
};

export const OCCUPANCY_PROFILES = {
  hostels: (hour) => {
    if (hour >= 23 || hour < 6) return 0.95;
    if (hour >= 6 && hour < 9) return 0.8;
    if (hour >= 18 && hour < 23) return 0.85;
    return 0.2;
  },
  admin: (hour) => {
    if (hour >= 8 && hour < 18) return 0.9;
    return 0.05;
  },
  library: (hour) => {
    if (hour >= 8 && hour < 24) {
      return 0.2 + 0.7 * Math.sin(((hour - 8) / 16) * Math.PI);
    }
    return 0.02;
  },
  academic: (hour) => {
    if (hour >= 9 && hour < 17) return 0.85;
    if (hour >= 17 && hour < 21) return 0.3;
    return 0.05;
  }
};
