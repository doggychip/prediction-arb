import React, { useState } from "react";
import { auth } from "../lib/api";

interface Props {
  onLogin: (user: { id: string; name: string; email: string }, token: string) => void;
}

export default function LoginPage({ onLogin }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "register") {
        const res = await auth.register({ name, email, password });
        onLogin(res.user, res.token);
      } else {
        const res = await auth.login({ email, password });
        onLogin(res.user, res.token);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="max-w-md mx-auto mt-16">
      <h1 className="text-3xl font-bold text-white mb-8 text-center">
        {mode === "login" ? "Sign In" : "Create Account"}
      </h1>

      <form
        onSubmit={handleSubmit}
        className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-4"
      >
        {error && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {mode === "register" && (
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-400 mb-1">Email</label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Password</label>
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
            minLength={8}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg font-medium transition disabled:opacity-50"
        >
          {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
        </button>

        <p className="text-center text-sm text-gray-500">
          {mode === "login" ? (
            <>
              Don't have an account?{" "}
              <button
                type="button"
                onClick={() => setMode("register")}
                className="text-indigo-400 hover:underline"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => setMode("login")}
                className="text-indigo-400 hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
