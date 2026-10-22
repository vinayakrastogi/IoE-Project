import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import Navbar from "./components/Navbar";
import { useAuth } from "./context/AuthContext";
import AdminDashboard from "./pages/AdminDashboard";
import BookingHistory from "./pages/BookingHistory";
import Dashboard from "./pages/Dashboard";
import GateTerminal from "./pages/GateTerminal";
import GuestKiosk from "./pages/GuestKiosk";
import Login from "./pages/Login";
import MonitorDashboard from "./pages/MonitorDashboard";
import Signup from "./pages/Signup";

const HardwareLab = lazy(() => import("./pages/HardwareLab"));
const NearbyParking = lazy(() => import("./pages/NearbyParking"));

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="text-center py-20 text-muted">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <Navbar />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/guest" element={<GuestKiosk />} />
        <Route path="/gate" element={<GateTerminal />} />
        <Route path="/monitor" element={<MonitorDashboard />} />
        <Route path="/nearby" element={<Suspense fallback={<div className="text-center py-20 text-muted">Loading map...</div>}><NearbyParking /></Suspense>} />
        <Route
          path="/hardware"
          element={
            <Suspense fallback={<div className="text-center py-20 text-muted">Loading hardware lab...</div>}>
              <HardwareLab />
            </Suspense>
          }
        />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/history"
          element={
            <ProtectedRoute>
              <BookingHistory />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </div>
  );
}
