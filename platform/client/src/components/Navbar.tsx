import React from "react";

interface Props {
  user: { id: string; name: string } | null;
  onNavigate: (page: any) => void;
  onLogout: () => void;
}

export default function Navbar({ user, onNavigate, onLogout }: Props) {
  return (
    <nav className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <button
          onClick={() => onNavigate({ name: "home" })}
          className="text-xl font-bold text-white hover:text-indigo-400 transition"
        >
          AgentForge
        </button>

        <div className="flex items-center gap-4">
          <button
            onClick={() => onNavigate({ name: "home" })}
            className="text-sm text-gray-400 hover:text-white transition"
          >
            Explore
          </button>

          {user ? (
            <>
              <button
                onClick={() => onNavigate({ name: "publish" })}
                className="text-sm text-gray-400 hover:text-white transition"
              >
                Publish
              </button>
              <button
                onClick={() => onNavigate({ name: "dashboard" })}
                className="text-sm text-gray-400 hover:text-white transition"
              >
                Dashboard
              </button>
              <span className="text-sm text-indigo-400">{user.name}</span>
              <button
                onClick={onLogout}
                className="text-sm text-gray-500 hover:text-red-400 transition"
              >
                Logout
              </button>
            </>
          ) : (
            <button
              onClick={() => onNavigate({ name: "login" })}
              className="text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition"
            >
              Sign In
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
