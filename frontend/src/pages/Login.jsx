import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import Logo from "../components/Logo";
import { useAuth } from "../context/AuthContext";

const inputClass =
  "w-full bg-bg border border-line rounded-md px-3 py-2 text-sm mb-4 text-ink focus:outline-none focus:ring-2 focus:ring-accent/60";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-4">
      <div className="mb-6">
        <Logo size={40} />
      </div>
      <form
        onSubmit={handleSubmit}
        className="bg-surface rounded-xl border border-line p-8 w-full max-w-sm animate-fade-in"
      >
        <h1 className="text-xl font-bold text-ink mb-1">Welcome back</h1>
        <p className="text-sm text-muted mb-6">Log in to book a parking slot.</p>

        <label className="block text-xs font-medium text-muted mb-1">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />

        <label className="block text-xs font-medium text-muted mb-1">Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-accent hover:bg-sky-400 disabled:opacity-50 text-bg rounded-md py-2 text-sm font-semibold transition-colors"
        >
          {submitting ? "Logging in..." : "Log in"}
        </button>

        <p className="text-sm text-muted mt-4 text-center">
          No account?{" "}
          <Link to="/signup" className="text-accent font-medium hover:underline">
            Sign up
          </Link>
        </p>
      </form>
    </div>
  );
}
