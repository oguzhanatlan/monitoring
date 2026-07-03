import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { applyTheme, getStoredTheme } from './theme.js';
import './styles.css';

// Tema tercihini React render'dan önce uygula (yanıp sönmeyi önler)
applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
