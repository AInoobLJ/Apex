import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Markets } from './pages/Markets';
import { Edges } from './pages/Edges';
import { Execution } from './pages/Execution';
import { Portfolio } from './pages/Portfolio';
import { Settings } from './pages/Settings';
import { System } from './pages/System';
import { MarketDetail } from './pages/MarketDetail';
import { SignalViewer } from './pages/SignalViewer';
import { Backtest } from './pages/Backtest';
import { TradeDetail } from './pages/TradeDetail';
import { Crypto } from './pages/Crypto';

export function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Markets />} />
          <Route path="/markets/:id" element={<MarketDetail />} />
          <Route path="/markets/:id/signals" element={<SignalViewer />} />
          <Route path="/edges" element={<Edges />} />
          <Route path="/execution" element={<Execution />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/crypto" element={<Crypto />} />
          <Route path="/backtest" element={<Backtest />} />
          <Route path="/trades/:id" element={<TradeDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/system" element={<System />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
