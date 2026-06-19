import React from 'react';
import ReactDOM from 'react-dom/client';
import { providerDisplayName } from '@repel/enums';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div>Repel — coming soon ({providerDisplayName('gmail')})</div>
  </React.StrictMode>
);
