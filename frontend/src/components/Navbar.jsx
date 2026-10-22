import { Cpu, LogOut, MapPin, Radar, ShieldAlert } from "lucide-react";
import { NavLink } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import Logo from "./Logo";

const linkClass = ({ isActive }) =>
  `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive ? "bg-surface2 text-ink" : "text-muted hover:text-ink hover:bg-surface2"
  }`;

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <nav className="bg-surface/80 backdrop-blur border-b border-line px-4 py-3 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <NavLink to="/dashboard">
          <Logo />
        </NavLink>
        <div className="flex items-center gap-1">
          <NavLink to="/dashboard" className={linkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/history" className={linkClass}>
            History
          </NavLink>
          <NavLink to="/guest" className={linkClass}>
            Guest Kiosk
          </NavLink>
          <NavLink to="/nearby" className={linkClass}>
            <span className="inline-flex items-center gap-1.5"><MapPin size={15} /> Nearby</span>
          </NavLink>
          <NavLink to="/gate" className={linkClass}>
            Gate Terminal
          </NavLink>
          <NavLink to="/monitor" className={linkClass}>
            <span className="inline-flex items-center gap-1.5">
              <Radar size={15} />
              Monitor
            </span>
          </NavLink>
          <NavLink to="/hardware" className={linkClass}>
            <span className="inline-flex items-center gap-1.5">
              <Cpu size={15} />
              Hardware
            </span>
          </NavLink>
          <NavLink to="/admin/dashboard" title="Admin" className="px-2 py-2 rounded-md text-muted/60 hover:text-muted hover:bg-surface2 transition-colors">
            <ShieldAlert size={15} />
          </NavLink>
          {user ? (
            <div className="flex items-center gap-3 ml-3 pl-3 border-l border-line">
              <span className="text-sm text-muted">{user.full_name}</span>
              <button
                onClick={logout}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-red-400 hover:text-red-300"
              >
                <LogOut size={15} />
                Logout
              </button>
            </div>
          ) : (
            <NavLink to="/login" className={linkClass}>
              Login
            </NavLink>
          )}
        </div>
      </div>
    </nav>
  );
}
