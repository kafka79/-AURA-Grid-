import { describe, it, expect } from 'vitest';
import { SimulationEngine, getInitialState } from './simulator.js';
import { APP_CONFIG } from './config.js';

function createMockStorage() {
  const store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value); }
  };
}

describe('SimulationEngine Physics and Logic Tests', () => {
  it('should initialize with starting state where carbon savings start at 0', () => {
    const state = getInitialState();
    expect(state.accumulatedCarbonSaved).toBe(0.0);
    expect(state.buildings['building-library'].load).toBeGreaterThan(0);
  });

  it('should compute thermodynamic temperature drift correctly', () => {
    const engine = new SimulationEngine(createMockStorage());
    engine.reset(); // ensure clean state
    
    const initialTemp = engine.state.buildings['building-engineering'].currentTemp;
    
    // Set environmental temp higher and disable smartGrid to see clean thermodynamic drift
    engine.updateState(state => {
      state.temperature = 40; // hot day
      state.smartGridActive = false;
    });

    // Advance simulation by 2.0 hours
    engine.stepSimulation(2.0);

    const resultingTemp = engine.state.buildings['building-engineering'].currentTemp;
    
    // With hvacSet at 22, initial temp at 22, and outdoor temp at 40:
    // T' = - (k_env + k_hvac) * T + (k_env * T_out + k_hvac * T_set)
    expect(resultingTemp).toBeCloseTo(22.0, 1);
  });

  it('should compute solar output adjusted for sunny, cloudy, and rainy weather', () => {
    const engine = new SimulationEngine(createMockStorage());
    
    // Test at noon (13.0 hours) where solar peaks
    engine.updateState(state => {
      state.timeOfDay = 13.0;
      state.weather = 'sunny';
    });
    engine.stepSimulation(0.05);
    const sunnySolar = engine.state.solarGeneration;
    expect(sunnySolar).toBeGreaterThan(150);

    // Test cloudy
    engine.updateState(state => {
      state.timeOfDay = 13.0;
      state.weather = 'cloudy';
    });
    engine.stepSimulation(0.05);
    const cloudySolar = engine.state.solarGeneration;
    expect(cloudySolar).toBeLessThan(sunnySolar);
    expect(cloudySolar).toBeGreaterThan(0);

    // Test rainy
    engine.updateState(state => {
      state.timeOfDay = 13.0;
      state.weather = 'rainy';
    });
    engine.stepSimulation(0.05);
    const rainySolar = engine.state.solarGeneration;
    expect(rainySolar).toBeLessThan(cloudySolar);
  });

  it('should respect battery efficiency roundtrip and charge limits', () => {
    const engine = new SimulationEngine(createMockStorage());
    engine.reset();

    // Force state to noon with massive excess solar
    engine.updateState(state => {
      state.timeOfDay = 13.0;
      state.weather = 'sunny';
      state.batteryCurrentKwh = 100.0; // low charge
      state.batteryCharge = (100.0 / state.batteryCapacityKwh) * 100;
      state.smartGridActive = true;
      // Scale down buildings to ensure excess solar
      Object.keys(state.buildings).forEach(id => {
        state.buildings[id].baseLoad = 0;
        state.buildings[id].maxCapacity = 10;
        state.buildings[id].load = 5;
      });
    });

    const initialKwh = engine.state.batteryCurrentKwh;
    
    // Simulate 1 hour of excess generation charging the battery
    engine.stepSimulation(1.0);

    const finalKwh = engine.state.batteryCurrentKwh;
    expect(finalKwh).toBeGreaterThan(initialKwh);

    // Charge added should account for battery efficiency losses
    const chargeDiff = finalKwh - initialKwh;
    const expectedMaxCharge = APP_CONFIG.battery.maxChargeRateKw * 1.0 * APP_CONFIG.battery.defaultEfficiency;
    expect(chargeDiff).toBeLessThanOrEqual(expectedMaxCharge);
  });

  it('should integrate carbon savings properly over time steps', () => {
    const engine = new SimulationEngine(createMockStorage());
    engine.reset();

    // Set solar generation positive and run a step to see carbon offset accumulate
    engine.updateState(state => {
      state.timeOfDay = 12.0;
      state.weather = 'sunny';
      state.accumulatedCarbonSaved = 0.0;
    });

    engine.stepSimulation(1.0);

    expect(engine.state.accumulatedCarbonSaved).toBeGreaterThan(0.0);
  });

  it('should auto-resolve warnings when Smart Grid automation is active', () => {
    const engine = new SimulationEngine(createMockStorage());
    engine.reset();

    engine.updateState(state => {
      state.smartGridActive = true;
      state.temperature = 42.0; // triggers heatwave alert
    });

    // Run tick to trigger and process auto-resolution
    engine.stepSimulation(0.1);

    const heatwaveAlert = engine.state.alerts.find(a => a.id === 'alert-heatwave');
    expect(heatwaveAlert.resolved).toBe(true);
  });
});
