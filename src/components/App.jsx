// src/components/App.jsx
import React from 'react';
import KitchenDisplay from './KitchenDisplay';

function App() {
  // If you want this to be the ONLY thing on the screen (for the kitchen iPad):
  return (
    <div className="App">
      <KitchenDisplay />
    </div>
  );
}

export default App;