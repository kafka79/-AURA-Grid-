import { SimulationEngine, resolveAlertAction } from './simulator.js';

const engine = new SimulationEngine();

engine.subscribe((state) => {
  postMessage({ type: 'STATE_UPDATE', state });
});

// Immediately send initial state
postMessage({ type: 'STATE_UPDATE', state: engine.state });

onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'UPDATE_STATE') {
    engine.updateState((state) => {
      Object.assign(state, msg.payload);
    });
  } else if (msg.type === 'STEP_SIMULATION') {
    engine.stepSimulation(msg.elapsedHours);
  } else if (msg.type === 'RESET') {
    engine.reset();
  } else if (msg.type === 'RESOLVE_ALERT') {
    engine.updateState((state) => {
      resolveAlertAction(state, msg.alertId);
    });
  }
};
