import React, { useEffect, useState, useRef } from "react";
import { notificationsApi } from "../lib/api";

interface Props {
  user: { id: string; name: string } | null;
  onNavigate: (page: any) => void;
  onLogout: () => void;
}

export default function Navbar({ user, onNavigate, onLogout }: Props) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    loadNotifications();
    const interval = setInterval(loadNotifications, 30_000); // poll every 30s
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function loadNotifications() {
    try {
      const data = await notificationsApi.list({ limit: 5 });
      setUnreadCount(data.unreadCount);
      setNotifications(data.notifications);
    } catch {}
  }

  async function markAllRead() {
    try {
      await notificationsApi.markAllRead();
      setUnreadCount(0);
      setNotifications(notifications.map((n) => ({ ...n, read: true })));
    } catch {}
  }

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
              <button
                onClick={() => onNavigate({ name: "billing" })}
                className="text-sm text-gray-400 hover:text-white transition"
              >
                Billing
              </button>

              {/* Notification Bell */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="relative text-gray-400 hover:text-white transition p-1"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>

                {showDropdown && (
                  <div className="absolute right-0 mt-2 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                      <span className="text-sm font-medium text-white">Notifications</span>
                      {unreadCount > 0 && (
                        <button
                          onClick={markAllRead}
                          className="text-xs text-indigo-400 hover:text-indigo-300 transition"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <p className="text-sm text-gray-500 px-4 py-6 text-center">No notifications yet</p>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            className={`px-4 py-3 border-b border-gray-800/50 last:border-0 ${
                              !n.read ? "bg-indigo-950/20" : ""
                            }`}
                          >
                            <p className="text-sm text-white">{n.title}</p>
                            {n.body && <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>}
                            <p className="text-[10px] text-gray-600 mt-1">
                              {n.createdAt ? new Date(n.createdAt).toLocaleString() : ""}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => onNavigate({ name: "profile" })}
                className="text-sm text-indigo-400 hover:text-indigo-300 transition"
              >
                {user.name}
              </button>
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
